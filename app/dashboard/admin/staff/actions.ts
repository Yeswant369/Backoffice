"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin, isOwner } from "@/lib/auth";
import {
  normalizeRoles,
  ASSIGNABLE_ROLES,
  OWNER_ASSIGNABLE_ROLES,
} from "@/lib/roles";
import { siteUrl } from "@/lib/site";

export interface InviteState {
  error?: string;
  success?: string;
}

/**
 * Invite a staff member by email using the Supabase Admin API (service role).
 *
 * full name + roles + the inviting admin's location_id are passed in
 * `user_metadata`, so the multi-tenant `handle_new_user` trigger provisions the
 * new account's profile in the SAME tenant (location) as the inviter.
 */
export async function inviteUser(
  _prevState: InviteState | undefined,
  formData: FormData,
): Promise<InviteState> {
  // Server Actions are directly invocable — re-verify the caller is an admin.
  if (!(await isAdmin())) {
    return { error: "Only administrators can invite staff." };
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const roles = normalizeRoles(
    formData.getAll("roles").map((r) => Number(r)),
  );

  if (!email) return { error: "Email is required." };
  if (!fullName) return { error: "Full name is required." };
  if (roles.length === 0) return { error: "Select at least one role." };
  // The action is directly invocable — enforce the assignable set server-side,
  // not just in the form UI. An Owner may grant Owner (org-wide read); a plain
  // location Admin may only grant location roles (1-4), so an Admin cannot
  // self-escalate by minting an Owner. Area Manager (5) is not UI-assignable yet.
  const allowed = new Set(
    ((await isOwner()) ? OWNER_ASSIGNABLE_ROLES : ASSIGNABLE_ROLES).map(
      (r) => r.id,
    ),
  );
  if (roles.some((r) => !allowed.has(r))) {
    return { error: "You aren't allowed to assign one or more of those roles." };
  }

  // Resolve the inviting admin's tenant (RLS-scoped to their own profile).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("location_id")
    .eq("id", user.id)
    .single();

  if (!profile?.location_id) {
    return { error: "Your account isn't assigned to a location yet." };
  }

  const admin = createAdminClient();
  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: { full_name: fullName, roles, location_id: profile.location_id },
      redirectTo: `${siteUrl()}/auth/set-password`,
    },
  );

  if (error) {
    return { error: error.message };
  }

  // Authoritatively provision the profile via the service role — the source of
  // truth for authorization. This bypasses the signup-trigger clamp (so a
  // service-role-granted Owner actually takes effect) and never trusts the
  // client-writable user_metadata for roles/location.
  const newUserId = invited.user?.id;
  if (!newUserId) {
    // Don't silently leave the trigger's clamped (Store) role in place.
    return { error: "Invite succeeded but no user id was returned — aborting." };
  }
  const { error: pErr } = await admin.from("profiles").upsert({
    id: newUserId,
    full_name: fullName,
    roles,
    location_id: profile.location_id,
  });
  if (pErr) {
    // Roll back the half-provisioned account so it can't be used at the wrong role.
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    return { error: pErr.message };
  }

  revalidatePath("/dashboard/admin/staff");
  return { success: `Invitation sent to ${email}.` };
}
