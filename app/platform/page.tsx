import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { ROLES } from "@/lib/roles";
import { logout } from "../dashboard/actions";
import CreateTenantForm from "./CreateTenantForm";
import AddOutletForm from "./AddOutletForm";
import InviteLinkButton from "./InviteLinkButton";
import DeleteTenantButton from "./DeleteTenantButton";

export const dynamic = "force-dynamic";

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
  locations: { id: string; name: string }[] | null;
}

export default async function PlatformConsole() {
  // Authoritative gate — platform operators only (env allowlist).
  if (!(await isPlatformAdmin())) redirect("/login");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, created_at, locations(id, name)")
    .order("created_at", { ascending: false });
  const orgs = (data ?? []) as OrgRow[];

  // Resolve each tenant's owner (role 6) + email + whether they've accepted, so
  // the operator can re-send a stuck invite.
  const orgByLocation = new Map<string, string>();
  for (const o of orgs) {
    for (const l of o.locations ?? []) orgByLocation.set(l.id, o.id);
  }
  const { data: ownerProfiles } = await admin
    .from("profiles")
    .select("id, location_id, roles")
    .contains("roles", [ROLES.OWNER]);

  const ownerByOrg = new Map<string, { email: string; accepted: boolean }>();
  for (const p of ownerProfiles ?? []) {
    const orgId = orgByLocation.get(p.location_id as string);
    if (!orgId || ownerByOrg.has(orgId)) continue;
    const { data: u } = await admin.auth.admin.getUserById(p.id as string);
    ownerByOrg.set(orgId, {
      email: u.user?.email ?? "—",
      accepted: Boolean(u.user?.last_sign_in_at),
    });
  }

  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      <header className="border-b border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-300 bg-indigo-100">
              <span className="text-xs font-semibold tracking-tight text-indigo-700">
                BOH
              </span>
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Platform Console</p>
              <p className="text-[11px] text-neutral-500">Tenant provisioning</p>
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:bg-[#efe9dd]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Provision a new customer tenant — organization, first outlet, default
          departments and an owner account — with no database access.
        </p>

        <div className="mt-8 space-y-6">
          <CreateTenantForm />
          <AddOutletForm orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
        </div>

        <div className="mt-10 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="flex items-center justify-between border-b border-[#e6e0d3] px-5 py-4">
            <h2 className="text-sm font-semibold">
              Tenants <span className="ml-2 text-neutral-500">{orgs.length}</span>
            </h2>
          </div>
          {error ? (
            <p className="px-5 py-8 text-center text-sm text-amber-700">
              Couldn&apos;t load tenants: {error.message}
            </p>
          ) : orgs.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-500">
              No customers yet. Create your first tenant above.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-3 font-medium">Restaurant</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                  <th className="px-5 py-3 font-medium">Outlets (billable)</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => {
                  const owner = ownerByOrg.get(o.id);
                  return (
                    <tr
                      key={o.id}
                      className="border-t border-[#e6e0d3] align-top transition hover:bg-[#faf7f1]"
                    >
                      <td className="px-5 py-3.5 font-medium text-neutral-900">
                        {o.name}
                      </td>
                      <td className="px-5 py-3.5">
                        {!owner ? (
                          <span className="text-neutral-500">—</span>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-neutral-800">{owner.email}</div>
                            {owner.accepted ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                Active
                              </span>
                            ) : (
                              <div className="space-y-2">
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                  Invited
                                </span>
                                <InviteLinkButton email={owner.email} />
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-neutral-700">
                        {(o.locations ?? []).length === 0 ? (
                          <span className="text-neutral-500">—</span>
                        ) : (
                          <span>
                            {(o.locations ?? []).map((l) => l.name).join(", ")}
                            <span className="ml-2 text-xs text-neutral-500">
                              ({(o.locations ?? []).length})
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-neutral-600">
                        {formatDate(o.created_at)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <DeleteTenantButton orgId={o.id} orgName={o.name} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
