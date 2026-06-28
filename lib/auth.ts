import { createClient } from "@/lib/supabase/server";
import { normalizeRoles, ROLES, type RoleId } from "@/lib/roles";
import type { User } from "@supabase/supabase-js";

/**
 * Resolve the current user and their role array (from `profiles`, the source of
 * truth). Used by Server Components and Server Actions for authorization —
 * Server Actions can be invoked directly, so they must re-check, never trust
 * the Proxy alone.
 */
export async function getCurrentUserAndRoles(): Promise<{
  user: User | null;
  roles: RoleId[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, roles: [] };

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();

  return { user, roles: normalizeRoles(profile?.roles) };
}

/** True when the current user holds the Admin role. */
export async function isAdmin(): Promise<boolean> {
  const { roles } = await getCurrentUserAndRoles();
  return roles.includes(ROLES.ADMIN);
}

/** True when the current user holds any of the given roles. */
export async function hasAnyRole(allowed: RoleId[]): Promise<boolean> {
  const { roles } = await getCurrentUserAndRoles();
  return roles.some((r) => allowed.includes(r));
}

/** True when the current user is an Owner (cross-outlet, org-wide read). */
export async function isOwner(): Promise<boolean> {
  const { roles } = await getCurrentUserAndRoles();
  return roles.includes(ROLES.OWNER);
}

/**
 * True when the current user may manage org-level config (Admin or Owner).
 * Mirrors the DB `can_manage_org()` used by RLS — keep the two in lockstep.
 */
export async function canManageOrg(): Promise<boolean> {
  const { roles } = await getCurrentUserAndRoles();
  return roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OWNER);
}
