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
  /** Shareable set-password link — copy/WhatsApp it; no email delivery needed. */
  link?: string;
}

/**
 * Build the robust set-password link through OUR /auth/confirm route (session
 * cookie set server-side — no fragile #hash hop through Supabase's verify
 * redirect, and no dependency on email templates/custom SMTP).
 */
function confirmLink(hashedToken: string): string {
  return `${siteUrl()}/auth/confirm?token_hash=${hashedToken}&type=recovery&next=/auth/set-password`;
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

  // Also mint a SHAREABLE set-password link (copy/WhatsApp) — the built-in
  // Supabase mailer is rate-limited and its template can't be edited without
  // custom SMTP, so the email alone may land users on the login page.
  let link: string | undefined;
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${siteUrl()}/auth/set-password` },
  });
  if (linkData?.properties?.hashed_token) {
    link = confirmLink(linkData.properties.hashed_token);
  }

  revalidatePath("/dashboard/admin/staff");
  return {
    success: `Invitation created for ${email}. Share the link below (WhatsApp works) — the email may not arrive without custom SMTP.`,
    link,
  };
}

/**
 * Fresh set-password link for an ALREADY-invited staff member (links are
 * single-use and expire). Admin-only; the target must belong to the caller's
 * own location.
 */
export async function getInviteLink(email: string): Promise<InviteState> {
  if (!(await isAdmin())) {
    return { error: "Only administrators can generate invite links." };
  }
  const target = email.trim().toLowerCase();
  if (!target) return { error: "Missing email." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  const { data: me } = await supabase
    .from("profiles")
    .select("location_id")
    .eq("id", user.id)
    .single();
  if (!me?.location_id) return { error: "Your account isn't assigned to a location." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: target,
    options: { redirectTo: `${siteUrl()}/auth/set-password` },
  });
  if (error) return { error: error.message };

  // The link must only be handed out for the caller's OWN outlet's staff.
  const targetId = data.user?.id;
  if (!targetId) return { error: "Could not resolve that account." };
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("location_id")
    .eq("id", targetId)
    .maybeSingle();
  if (targetProfile?.location_id !== me.location_id) {
    return { error: "That account isn't part of your location." };
  }

  const hashed = data.properties?.hashed_token;
  if (!hashed) return { error: "Could not generate a link." };
  return { success: `Fresh link for ${target} — single-use, expires soon.`, link: confirmLink(hashed) };
}
