"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/auth";
import { normalizeRoles, OWNER_TEAM_ROLES, ROLES } from "@/lib/roles";
import { siteUrl } from "@/lib/site";

export interface TeamState {
  error?: string;
  success?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Owner-only context. Returns the caller's org id (derived server-side from
 * their own profile via current_org_id) or null if they aren't an Owner. Every
 * write below re-validates targets against this org — an owner can only ever
 * manage staff/outlets WITHIN their own tenant.
 */
async function ownerOrgId(): Promise<string | null> {
  if (!(await isOwner())) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_org_id");
  return (data as string | null) ?? null;
}

/**
 * Invite a team member to ONE of the owner's existing outlets. Owners cannot
 * create outlets (operator-only, billing control) — only staff them.
 */
export async function inviteTeamMember(
  _prev: TeamState | undefined,
  formData: FormData,
): Promise<TeamState> {
  const orgId = await ownerOrgId();
  if (!orgId) return { error: "Only owners can manage the team." };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const outletId = String(formData.get("outlet_id") ?? "").trim();
  const roles = normalizeRoles(formData.getAll("roles").map((r) => Number(r)));

  if (!fullName || !email || !outletId) {
    return { error: "Name, email and outlet are all required." };
  }
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email." };
  if (roles.length === 0) return { error: "Select at least one role." };
  const allowed = new Set(OWNER_TEAM_ROLES.map((r) => r.id));
  if (roles.some((r) => !allowed.has(r))) {
    return { error: "You can't assign one or more of the selected roles." };
  }

  const admin = createAdminClient();

  // The outlet must belong to the owner's own org.
  const { data: outlet } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", outletId)
    .maybeSingle();
  if (!outlet || outlet.organization_id !== orgId) {
    return { error: "That outlet isn't in your organization." };
  }

  let createdUserId: string | null = null;
  try {
    const { data: invited, error: invErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, location_id: outletId },
        redirectTo: `${siteUrl()}/auth/set-password`,
      });
    if (invErr || !invited?.user) {
      throw new Error(invErr?.message ?? "Could not send the invite.");
    }
    const uid = invited.user.id;

    // Guard against an email that already belongs to another tenant.
    const { data: existing } = await admin
      .from("profiles")
      .select("location_id")
      .eq("id", uid)
      .maybeSingle();
    if (existing && existing.location_id !== outletId) {
      throw new Error("That email already belongs to another account.");
    }
    // Only ever delete an auth user WE created on rollback. A brand-new invite
    // has no profile yet (the trigger creates one only when it runs here); a
    // re-invited existing member already has one — never delete them, a failed
    // upsert just leaves a recoverable account in your own org.
    if (existing == null) createdUserId = uid;

    const { error: pErr } = await admin.from("profiles").upsert({
      id: uid,
      full_name: fullName,
      roles,
      location_id: outletId,
    });
    if (pErr) throw new Error(pErr.message);
  } catch (e) {
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    }
    return {
      error: e instanceof Error ? e.message : "Could not invite the team member.",
    };
  }

  revalidatePath("/dashboard/portfolio/team");
  return { success: `Invited ${email}.` };
}

/**
 * Set which outlets an Area Manager covers (writes profile_locations — the only
 * way to widen a role-5 user's read scope beyond their home outlet). Both the
 * target staff member AND every outlet must be inside the owner's org.
 */
export async function setAreaManagerOutlets(
  _prev: TeamState | undefined,
  formData: FormData,
): Promise<TeamState> {
  const orgId = await ownerOrgId();
  if (!orgId) return { error: "Only owners can manage the team." };

  const profileId = String(formData.get("profile_id") ?? "").trim();
  const outletIds = formData
    .getAll("outlet_ids")
    .map((v) => String(v))
    .filter(Boolean);
  if (!profileId) return { error: "Missing staff member." };

  const admin = createAdminClient();

  // Target staff member must be in the owner's org (via their home outlet) AND
  // actually be an Area Manager (coverage is inert for other roles — refuse it
  // so no stale coverage can silently activate if they're later made an AM).
  const { data: prof } = await admin
    .from("profiles")
    .select("location_id, roles")
    .eq("id", profileId)
    .maybeSingle();
  if (!prof) return { error: "Staff member not found." };
  if (!normalizeRoles(prof.roles).includes(ROLES.AREA_MANAGER)) {
    return { error: "Outlet coverage applies only to Area Managers." };
  }
  const { data: home } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", prof.location_id)
    .maybeSingle();
  if (!home || home.organization_id !== orgId) {
    return { error: "That staff member isn't in your organization." };
  }

  // Every selected outlet must be in the owner's org.
  if (outletIds.length > 0) {
    const { data: locs } = await admin
      .from("locations")
      .select("id")
      .eq("organization_id", orgId)
      .in("id", outletIds);
    const valid = new Set((locs ?? []).map((l) => l.id as string));
    if (outletIds.some((id) => !valid.has(id))) {
      return { error: "One or more outlets aren't in your organization." };
    }
  }

  // Replace the coverage set. Non-atomic (delete then insert): on the rare
  // insert failure the coverage is left empty and the owner re-saves — a
  // recoverable availability case, not data loss (the mapping is rebuildable).
  await admin.from("profile_locations").delete().eq("profile_id", profileId);
  if (outletIds.length > 0) {
    const { error: insErr } = await admin
      .from("profile_locations")
      .insert(outletIds.map((location_id) => ({ profile_id: profileId, location_id })));
    if (insErr) return { error: insErr.message };
  }

  revalidatePath("/dashboard/portfolio/team");
  return { success: "Outlet coverage updated." };
}
