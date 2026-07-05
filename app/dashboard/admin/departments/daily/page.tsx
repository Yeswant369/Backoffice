import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import { resolveDateRange } from "@/lib/date-range";
import SectionHeader from "@/app/dashboard/_components/SectionHeader";
import MetricCard from "@/app/dashboard/_components/MetricCard";
import DateRangeUrlControl from "@/app/dashboard/_components/DateRangeUrlControl";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface DailyStockRow {
  location_id: string;
  department_id: number;
  department_name: string | null;
  day: string;
  opening_value: number;
  received_value: number;
  transferred_out_value: number;
  sales_consumption_value: number;
  wastage_value: number;
  shrinkage_value: number;
  closing_value: number;
  consumption_value: number;
  counted: boolean;
}

interface DailyCostingRow {
  day: string;
  sales_value: number;
  food_cost_pct: number | null;
}

export default async function DailyClosingCostingPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; from?: string; to?: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const sp = await searchParams;
  const { from, to } = resolveDateRange(sp.from, sp.to);

  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data: deptData, error: deptError } = await supabase
    .from("departments")
    .select("id, name")
    .eq("location_id", loc)
    .order("id");
  const departments = (deptData ?? []) as { id: number; name: string }[];

  const requested = Number(sp.dept);
  const deptId =
    Number.isFinite(requested) && departments.some((d) => d.id === requested)
      ? requested
      : (departments[0]?.id ?? 0);

  const [stockRes, costingRes] = await Promise.all([
    supabase
      .from("department_daily_stock")
      .select("*")
      .eq("location_id", loc)
      .eq("department_id", deptId)
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: false }),
    supabase
      .from("department_daily_costing")
      .select("day, sales_value, food_cost_pct")
      .eq("location_id", loc)
      .eq("department_id", deptId)
      .gte("day", from)
      .lte("day", to),
  ]);

  const rows = (stockRes.data ?? []) as DailyStockRow[];
  const costingByDay = new Map(
    ((costingRes.data ?? []) as DailyCostingRow[]).map((c) => [c.day, c]),
  );
  const loadError = deptError || stockRes.error || costingRes.error;

  const tot = rows.reduce(
    (a, r) => ({
      received: a.received + n(r.received_value),
      consumption: a.consumption + n(r.consumption_value),
      wastage: a.wastage + n(r.wastage_value),
    }),
    { received: 0, consumption: 0, wastage: 0 },
  );
  const totSales = [...costingByDay.values()].reduce(
    (a, c) => a + n(c.sales_value),
    0,
  );
  const overallFoodPct = totSales > 0 ? (tot.consumption / totSales) * 100 : null;

  const rangeParams = new URLSearchParams();
  if (sp.from) rangeParams.set("from", sp.from);
  if (sp.to) rangeParams.set("to", sp.to);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Dashboards
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Daily Closing &amp; Costing</span>
      </div>

      <SectionHeader
        eyebrow="Kitchen Management"
        title="Daily Closing & Costing"
        description="The restaurant-standard day book per department: opening + received − closing = consumption, and food cost % = consumption ÷ sales. A closing is simply that day's stock count — on uncounted days the system balance carries forward."
      />

      {departments.length > 0 && (
        <div className="mb-4 inline-flex gap-1 rounded-lg bg-[#efe9dd] p-1">
          {departments.map((d) => {
            const active = d.id === deptId;
            const params = new URLSearchParams(rangeParams);
            params.set("dept", String(d.id));
            return (
              <Link
                key={d.id}
                href={`/dashboard/admin/departments/daily?${params.toString()}`}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-white text-neutral-950 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {d.name}
              </Link>
            );
          })}
        </div>
      )}

      <div className="mb-8">
        <DateRangeUrlControl from={from} to={to} />
      </div>

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load daily closing data: {loadError.message}. Confirm
          migration 0030 has been applied.
        </p>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Received" value={inr(tot.received)} sub="Issues + purchases into the department" />
        <MetricCard label="Consumption" value={inr(tot.consumption)} sub="Opening + received − closing" />
        <MetricCard
          label="Wastage"
          value={inr(tot.wastage)}
          tone={tot.wastage > 0 ? "negative" : "default"}
          sub="Logged wastage at WAC"
        />
        <MetricCard
          label="Sales"
          value={inr(totSales)}
          sub={
            overallFoodPct !== null
              ? `Food cost ${overallFoodPct.toFixed(1)}% of sales`
              : "No sales in range"
          }
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No stock movement for this department in the selected range.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-3 font-medium">Day</th>
                  <th className="px-5 py-3 text-right font-medium">Opening</th>
                  <th className="px-5 py-3 text-right font-medium">Received</th>
                  <th className="px-5 py-3 text-right font-medium">Transfers out</th>
                  <th className="px-5 py-3 text-right font-medium">Sales cost</th>
                  <th className="px-5 py-3 text-right font-medium">Wastage</th>
                  <th className="px-5 py-3 text-right font-medium">Shrinkage</th>
                  <th className="px-5 py-3 text-right font-medium">Closing</th>
                  <th className="px-5 py-3 text-right font-medium">Consumption</th>
                  <th className="px-5 py-3 text-right font-medium">Sales</th>
                  <th className="px-5 py-3 text-right font-medium">Food %</th>
                  <th className="px-5 py-3 text-center font-medium">Counted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = costingByDay.get(r.day);
                  return (
                    <tr key={r.day} className="border-t border-[#e6e0d3]">
                      <td className="px-5 py-3 font-medium whitespace-nowrap text-neutral-900">
                        {formatDate(r.day)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">
                        {inr(r.opening_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">
                        {inr(r.received_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">
                        {inr(r.transferred_out_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">
                        {inr(r.sales_consumption_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">
                        {inr(r.wastage_value)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right tabular-nums ${
                          n(r.shrinkage_value) > 0 ? "text-red-600" : "text-neutral-600"
                        }`}
                      >
                        {inr(r.shrinkage_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">
                        {inr(r.closing_value)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-neutral-900">
                        {inr(r.consumption_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">
                        {inr(c?.sales_value)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">
                        {c?.food_cost_pct != null ? `${n(c.food_cost_pct).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {r.counted ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            ✓
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 text-neutral-400"
                            title="no closing count — system carry-forward"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm text-neutral-500">
        A day&apos;s closing is set by that department&apos;s stock count — days
        without a count carry the system balance forward.{" "}
        <Link
          href="/dashboard/admin/inventory/count"
          className="font-medium text-indigo-700 transition hover:text-indigo-500"
        >
          Enter today&apos;s closing count &rarr;
        </Link>
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        Note: POS (Petpooja) sales deplete Kitchen stock, so for POS-heavy menus
        the food-cost % is most meaningful on the Kitchen tab; manual sales
        deplete the dish&apos;s own department. Values use the current
        weighted-average cost.
      </p>
    </div>
  );
}
