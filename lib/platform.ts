import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Platform (SaaS-vendor) super-admin gate — distinct from tenant roles.
 *
 * The operator allowlist is configured ONCE via the `PLATFORM_ADMIN_EMAILS`
 * env var (comma-separated), never per-customer. Empty/unset ⇒ the platform
 * console is locked to everyone (safe default).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  return !!email && allow.includes(email);
}
