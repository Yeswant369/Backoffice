import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import DepartmentManager, { type DepartmentOption } from "./DepartmentManager";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface DeptPL {
  department_id: number | null;
  department_name: string | null;
  issued_cost: number;
  sale_value: number;
  items_sold: number;
  item_wastage_cost: number;
}

export default async function DepartmentPLPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data, error } = await supabase
    .from("department_pl")
    .select(
      "department_id, department_name, issued_cost, sale_value, items_sold, item_wastage_cost",
    )
    .eq("location_id", loc)
    .order("sale_value", { ascending: false });
  const rows = (data ?? []) as DeptPL[];

  const { data: deptData } = await supabase
    .from("departments")
    .select("id, name")
    .eq("location_id", loc)
    .order("name");
  const departments = (deptData ?? []) as DepartmentOption[];

  const tot = rows.reduce(
    (a, r) => ({
      issued: a.issued + n(r.issued_cost),
      sale: a.sale + n(r.sale_value),
      waste: a.waste + n(r.item_wastage_cost),
    }),
    { issued: 0, sale: 0, waste: 0 },
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Dashboards
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Department P&amp;L</span>
      </div>

      <SectionHeader
        eyebrow="Kitchen Management"
        title="Department P&L"
        description="Per-department picture: raw cost issued in vs. sale revenue out, minus prepared-item wastage. All figures derive automatically from issues, sales and production."
      />

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Sale value </span>
          <span className="font-semibold text-neutral-900">{inr(tot.sale)}</span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Raw issued </span>
          <span className="font-semibold text-neutral-900">{inr(tot.issued)}</span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Item wastage </span>
          <span className="font-semibold text-neutral-900">{inr(tot.waste)}</span>
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load department P&amp;L: {error.message}. Confirm migration
          0021 has been applied.
        </p>
      )}

      <DepartmentManager departments={departments} />

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No department activity yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Department</th>
                <th className="px-5 py-3 text-right font-medium">Sale value</th>
                <th className="px-5 py-3 text-right font-medium">Items sold</th>
                <th className="px-5 py-3 text-right font-medium">Raw issued (cost)</th>
                <th className="px-5 py-3 text-right font-medium">Item wastage</th>
                <th className="px-5 py-3 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const net = n(r.sale_value) - n(r.issued_cost) - n(r.item_wastage_cost);
                return (
                  <tr
                    key={r.department_id ?? "none"}
                    className="border-t border-[#e6e0d3]"
                  >
                    <td className="px-5 py-3.5 font-medium text-neutral-900">
                      {r.department_id != null ? (
                        <Link
                          href={`/dashboard/admin/departments/daily?dept=${r.department_id}`}
                          className="text-indigo-700 hover:text-indigo-500"
                        >
                          {r.department_name ?? "Unassigned"}
                        </Link>
                      ) : (
                        (r.department_name ?? "Unassigned")
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(r.sale_value)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {n(r.items_sold)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {inr(r.issued_cost)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {inr(r.item_wastage_cost)}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                        net >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {inr(net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
