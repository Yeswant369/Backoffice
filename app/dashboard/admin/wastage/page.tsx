import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { formatDate, inr } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import WastageForm from "./WastageForm";

export const dynamic = "force-dynamic";

interface WastageRow {
  id: string;
  created_at: string;
  transaction_date: string | null;
  quantity: number;
  wastage_reason: string | null;
  from_department_id: number | null;
  raw_materials: { name: string; stock_unit: string } | null;
}

interface DeptWastageRow {
  department_name: string | null;
  day: string;
  wastage_value: number;
}

/** IST calendar date (YYYY-MM-DD) `days` days before now (evaluated per request). */
function istDateDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date(Date.now() - days * 86400000));
}

export default async function WastagePage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  // Last 30 days (IST) window for the department wastage leaderboard.
  const thirtyAgo = istDateDaysAgo(30);

  const [deptRes, materialsRes, ledgerRes, deptWastageRes] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name")
      .eq("location_id", loc)
      .order("id"),
    supabase
      .from("raw_materials")
      .select("id, name, code, stock_unit")
      .eq("location_id", loc)
      .order("name"),
    supabase
      .from("inventory_ledger")
      .select(
        "id, created_at, transaction_date, quantity, wastage_reason, from_department_id, raw_materials(name, stock_unit)",
      )
      .eq("type", "WASTAGE")
      .eq("location_id", loc)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("department_daily_stock")
      .select("department_name, day, wastage_value")
      .eq("location_id", loc)
      .gt("wastage_value", 0)
      .gte("day", thirtyAgo)
      .order("wastage_value", { ascending: false }),
  ]);

  const departments = (deptRes.data ?? []) as { id: number; name: string }[];
  const materials = (materialsRes.data ?? []) as {
    id: string;
    name: string;
    code: string | null;
    stock_unit: string;
  }[];
  const rows = (ledgerRes.data ?? []) as unknown as WastageRow[];
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const deptWastage = (deptWastageRes.data ?? []) as DeptWastageRow[];

  // Aggregate the day-grain rows per department: 30-day total + the worst day.
  const byDept = new Map<
    string,
    { department_name: string; total: number; worstDay: string; worstValue: number }
  >();
  for (const r of deptWastage) {
    const name = r.department_name ?? "—";
    const value = Number(r.wastage_value);
    const cur = byDept.get(name);
    if (!cur) {
      byDept.set(name, {
        department_name: name,
        total: value,
        worstDay: r.day,
        worstValue: value,
      });
    } else {
      cur.total += value;
      if (value > cur.worstValue) {
        cur.worstValue = value;
        cur.worstDay = r.day;
      }
    }
  }
  const deptLeaderboard = [...byDept.values()].sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Record Wastage</span>
      </div>

      <SectionHeader
        eyebrow="Operations"
        title="Record Wastage"
        description="Log spoilage, breakage and prep waste for ANY department — each entry posts an immutable WASTAGE row to the inventory ledger."
      />

      <div className="mb-8">
        <WastageForm departments={departments} materials={materials} />
      </div>

      {deptLeaderboard.length > 0 && (
        <div className="mb-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="border-b border-[#e6e0d3] px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Highest wastage by department (30d)
            </h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Department</th>
                <th className="px-5 py-2.5 text-right font-medium">
                  Total wastage (30d)
                </th>
                <th className="px-5 py-2.5 text-right font-medium">Worst day</th>
              </tr>
            </thead>
            <tbody>
              {deptLeaderboard.map((r) => (
                <tr key={r.department_name} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 font-medium text-neutral-900">
                    {r.department_name}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                    {inr(r.total)}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                    {formatDate(r.worstDay)} · {inr(r.worstValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No wastage recorded yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Material</th>
                <th className="px-5 py-3 font-medium">Department</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5 text-neutral-700">
                    {formatDate(r.transaction_date ?? r.created_at)}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {r.raw_materials?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {(r.from_department_id != null &&
                      deptName.get(r.from_department_id)) ||
                      "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                    {r.quantity}
                    {r.raw_materials?.stock_unit
                      ? ` ${r.raw_materials.stock_unit}`
                      : ""}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {r.wastage_reason ?? "—"}
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
