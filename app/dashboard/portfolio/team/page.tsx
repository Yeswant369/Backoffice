import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserAndRoles } from "@/lib/auth";
import { ROLES, ROLE_LABELS, normalizeRoles, type RoleId } from "@/lib/roles";
import SectionHeader from "../../_components/SectionHeader";
import TeamInviteForm from "./TeamInviteForm";
import AreaManagerOutlets from "./AreaManagerOutlets";

export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  full_name: string | null;
  roles: number[] | null;
  location_id: string;
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  roles: RoleId[];
  homeOutlet: string;
  isAreaManager: boolean;
  covered: string[];
}

export default async function TeamPage() {
  // Owner-only surface (Area Managers see Portfolio but don't manage staff).
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.includes(ROLES.OWNER)) redirect("/dashboard");

  const supabase = await createClient();
  const admin = createAdminClient();

  // Owner's org outlets (RLS scopes this to their org).
  const { data: locData } = await supabase
    .from("locations")
    .select("id, name")
    .order("name", { ascending: true });
  const outlets = (locData ?? []).map((l) => ({
    id: l.id as string,
    name: (l.name as string) ?? "Outlet",
  }));
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const outletIds = outlets.map((o) => o.id);
  // Service-role queries bypass RLS, so never run an empty .in() (which could
  // match everything) — fall back to a non-matching sentinel id.
  const NIL = "00000000-0000-0000-0000-000000000000";

  // Org staff (service role, constrained to the org's outlet ids).
  const { data: profData } = await admin
    .from("profiles")
    .select("id, full_name, roles, location_id")
    .in("location_id", outletIds.length ? outletIds : [NIL]);
  const profiles = (profData ?? []) as ProfileRow[];
  const profileIds = profiles.map((p) => p.id);

  // Area-manager coverage + emails.
  const { data: plData } = await admin
    .from("profile_locations")
    .select("profile_id, location_id")
    .in("profile_id", profileIds.length ? profileIds : [NIL]);
  const coverage = new Map<string, string[]>();
  for (const r of plData ?? []) {
    const arr = coverage.get(r.profile_id as string) ?? [];
    arr.push(r.location_id as string);
    coverage.set(r.profile_id as string, arr);
  }

  const emailEntries = await Promise.all(
    profileIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      return [id, data.user?.email ?? "—"] as const;
    }),
  );
  const emailById = new Map(emailEntries);

  const staff: StaffMember[] = profiles
    .map((p) => {
      const r = normalizeRoles(p.roles);
      return {
        id: p.id,
        name: p.full_name ?? "—",
        email: emailById.get(p.id) ?? "—",
        roles: r,
        homeOutlet: outletName.get(p.location_id) ?? "—",
        isAreaManager: r.includes(ROLES.AREA_MANAGER),
        covered: coverage.get(p.id) ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const areaManagers = staff.filter((s) => s.isAreaManager);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link
          href="/dashboard/portfolio"
          className="transition hover:text-neutral-900"
        >
          Portfolio
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Team</span>
      </div>

      <SectionHeader
        eyebrow="Portfolio"
        title="Team & Access"
        description="Invite staff to your outlets and set which outlets each Area Manager covers. Need a new outlet? Your account manager provisions those."
      />

      <TeamInviteForm outlets={outlets} />

      <div className="mt-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="flex items-center justify-between border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Team <span className="ml-2 text-neutral-500">{staff.length}</span>
          </h2>
        </div>
        {staff.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No team members yet. Invite your first above.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Roles</th>
                <th className="px-5 py-3 font-medium">Home outlet</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr
                  key={m.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {m.name}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">{m.email}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {m.roles.length === 0 ? (
                        <span className="text-neutral-500">—</span>
                      ) : (
                        m.roles.map((r) => (
                          <span
                            key={r}
                            className="rounded-full border border-[#d9d1c1] bg-[#efe9dd] px-2.5 py-0.5 text-[11px] font-medium text-neutral-800"
                          >
                            {ROLE_LABELS[r]}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">{m.homeOutlet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {areaManagers.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900">
            Area Manager coverage
          </h2>
          <p className="mb-4 text-xs text-neutral-500">
            Choose which outlets each Area Manager can see (read-only roll-ups).
          </p>
          <div className="space-y-4">
            {areaManagers.map((m) => (
              <AreaManagerOutlets
                key={m.id}
                profileId={m.id}
                profileName={m.name}
                outlets={outlets}
                covered={m.covered}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
