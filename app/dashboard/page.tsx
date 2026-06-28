import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeRouteForRoles, normalizeRoles } from "@/lib/roles";

/** Bare `/dashboard` — forward to the user's highest-privilege section. */
export default async function DashboardIndex() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();

  redirect(homeRouteForRoles(normalizeRoles(profile?.roles)));
}
