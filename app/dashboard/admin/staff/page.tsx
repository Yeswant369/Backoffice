import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserAndRoles } from "@/lib/auth";
import {
  normalizeRoles,
  ROLE_LABELS,
  ROLES,
  ASSIGNABLE_ROLES,
  OWNER_ASSIGNABLE_ROLES,
  type RoleId,
} from "@/lib/roles";
import { formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import StaffForm from "./StaffForm";
import GetLinkButton from "./GetLinkButton";

// Always render fresh — staff list reflects the latest invites.
export const dynamic = "force-dynamic";

interface StaffRow {
  id: string;
  email: string;
  fullName: string;
  roles: RoleId[];
  accepted: boolean;
  invitedAt: string;
}

export default async function StaffPage() {
  // Authoritative guard (the page uses the privileged admin client).
  const { user, roles: viewerRoles } = await getCurrentUserAndRoles();
  if (!user || !viewerRoles.includes(ROLES.ADMIN)) redirect("/dashboard");
  // Only an Owner may grant the cross-outlet Owner role; a plain admin cannot.
  const assignableRoles = viewerRoles.includes(ROLES.OWNER)
    ? OWNER_ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES;

  const admin = createAdminClient();
  const supabase = await createClient();

  const [{ data: list }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    supabase.from("profiles").select("id, full_name, roles"),
  ]);

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p]),
  );

  const staff: StaffRow[] = (list?.users ?? [])
    .map((u) => {
      const profile = profileById.get(u.id);
      const metaRoles = (u.user_metadata?.roles ?? null) as unknown;
      return {
        id: u.id,
        email: u.email ?? "—",
        fullName:
          profile?.full_name ??
          (u.user_metadata?.full_name as string | undefined) ??
          "—",
        roles: normalizeRoles(profile?.roles ?? metaRoles),
        accepted: Boolean(u.last_sign_in_at),
        invitedAt: u.created_at,
      };
    })
    .sort((a, b) => (a.invitedAt < b.invitedAt ? 1 : -1));

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Staff</span>
      </div>

      <SectionHeader
        eyebrow="Administration"
        title="Staff Management"
        description="Invite team members and assign their workspace roles. New accounts are provisioned automatically when the invite is accepted."
      />

      <StaffForm assignableRoles={assignableRoles} />

      <div className="mt-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="flex items-center justify-between border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Current staff
            <span className="ml-2 text-neutral-500">{staff.length}</span>
          </h2>
        </div>

        {staff.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No staff yet. Send your first invitation above.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Roles</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Invited</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr
                  key={member.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {member.fullName}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {member.email}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {member.roles.length === 0 ? (
                        <span className="text-neutral-500">—</span>
                      ) : (
                        member.roles.map((r) => (
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
                  <td className="px-5 py-3.5">
                    {member.accepted ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    ) : (
                      <div className="space-y-1.5">
                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Invited
                        </span>
                        <GetLinkButton email={member.email} />
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {formatDate(member.invitedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
