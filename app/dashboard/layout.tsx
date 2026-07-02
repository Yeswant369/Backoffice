import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeRoles } from "@/lib/roles";
import { getActiveLocation } from "@/lib/location";
import Sidebar from "./Sidebar";
import AskAiButton from "./_components/AskAiButton";

/**
 * Authoritative dashboard guard. The Proxy performs an optimistic redirect, but
 * this Server Component is the real authorization boundary: it re-validates the
 * session server-side and loads the role array used to render navigation.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Profile + outlet-switcher state run concurrently (independent queries).
  const [{ data: profile }, { activeId, locations }] = await Promise.all([
    supabase.from("profiles").select("full_name, roles").eq("id", user.id).single(),
    getActiveLocation(supabase),
  ]);

  const roles = normalizeRoles(profile?.roles);
  const fullName = profile?.full_name ?? user.email ?? "User";

  return (
    <div className="flex min-h-dvh bg-white text-neutral-900">
      {/* Sidebar reads useSearchParams (catalog ?tab= active state) — a Suspense
          boundary keeps any static page under this layout prerenderable. */}
      <Suspense fallback={<div className="w-72 flex-shrink-0 border-r border-[#e6e0d3] bg-[#f7f3ec]" />}>
        <Sidebar
          roles={roles}
          fullName={fullName}
          email={user.email ?? ""}
          locations={locations}
          activeLocationId={activeId}
        />
      </Suspense>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-10">{children}</div>
      </main>
      <AskAiButton />
    </div>
  );
}
