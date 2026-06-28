import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client using the SERVICE ROLE key. Bypasses RLS — use
 * ONLY in Server Actions / Server Components, never in client code.
 *
 * The `server-only` import above causes a build error if this module is ever
 * imported into a Client Component, protecting the secret key.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
