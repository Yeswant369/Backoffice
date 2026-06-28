import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MapUnmappedRow from "./MapUnmappedRow";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "@/app/dashboard/_components/SectionHeader";
import KpiCard from "@/app/dashboard/_components/KpiCard";
import GroupedBarCard from "@/app/dashboard/_components/GroupedBarCard";
import { CHART } from "@/app/dashboard/_components/accents";
import VarianceChart, { type CategoryCost } from "./VarianceChart";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90, 365] as const;
const n = (v: unknown) => Number(v ?? 0);

function istDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

interface VarianceRow {
  count_date: string;
  department_id: number;
  raw_material_id: string;
  raw_material_name: string;
  stock_unit: string;
  system_qty: number;
  actual_qty: number;
  variance: number;
  unit_cost: number;
  variance_value: number;
}

// Inline monochrome/indigo icons for KPI badges.
const IcStack = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5" /></svg>
);
const IcCalc = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2" /></svg>
);
const IcTrash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
);
const IcAlert = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M10.3 3.9l-7.6 13A2 2 0 004.4 20h15.2a2 2 0 001.7-3l-7.6-13a2 2 0 00-3.4 0zM12 9v4m0 4h.01" /></svg>
);

export default async function VariancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days) as (typeof PERIODS)[number])
    ? Number(sp.days)
    : 30;
  const fromDate = istDateNDaysAgo(days);
  // IST start-of-day for timestamptz columns (count_date is a plain date already).
  const fromTs = `${fromDate}T00:00:00+05:30`;

  const supabase = await createClient();
  const [varRes, matRes, wacRes, ledgerRes, unmappedRes, unmappedCountRes, recipesRes] = await Promise.all([
    supabase
      .from("stock_count_variance")
      .select(
        "count_date, department_id, raw_material_id, raw_material_name, stock_unit, system_qty, actual_qty, variance, unit_cost, variance_value",
      )
      .gte("count_date", fromDate)
      .order("count_date", { ascending: false }),
    supabase.from("raw_materials").select("id, category"),
    supabase.from("weighted_average_cost").select("raw_material_id, weighted_avg_cost"),
    supabase
      .from("inventory_ledger")
      .select("raw_material_id, quantity, type")
      .in("type", ["SALES_DEPLETION", "WASTAGE"])
      .gte("created_at", fromTs),
    supabase
      .from("unmapped_sales")
      .select("id, pos_item_code, item_name, quantity, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("unmapped_sales")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false),
    supabase.from("recipes").select("id, name").order("name"),
  ]);
  const openUnmappedCount = unmappedCountRes.count ?? (unmappedRes.data ?? []).length;
  const recipes = (recipesRes.data ?? []) as { id: string; name: string }[];

  const loadError = varRes.error || matRes.error;

  const categoryById = new Map(
    (matRes.data ?? []).map((m) => [m.id, (m.category as string) ?? "Uncategorised"]),
  );
  const wacById = new Map(
    (wacRes.data ?? []).map((w) => [w.raw_material_id, n(w.weighted_avg_cost)]),
  );

  // Keep only the LATEST count per (department, material) within the period.
  const latest = new Map<string, VarianceRow>();
  for (const r of (varRes.data ?? []) as unknown as VarianceRow[]) {
    const key = `${r.department_id}:${r.raw_material_id}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const rows = [...latest.values()];

  // KPIs.
  let theoreticalCost = 0;
  let actualCost = 0;
  let uncontrolledLoss = 0;
  const byCategory = new Map<string, { theoretical: number; actual: number }>();
  for (const r of rows) {
    const theo = n(r.system_qty) * n(r.unit_cost);
    const act = n(r.actual_qty) * n(r.unit_cost);
    theoreticalCost += theo;
    actualCost += act;
    if (n(r.variance) < 0) uncontrolledLoss += -n(r.variance) * n(r.unit_cost);
    const cat = categoryById.get(r.raw_material_id) ?? "Uncategorised";
    const e = byCategory.get(cat) ?? { theoretical: 0, actual: 0 };
    e.theoretical += theo;
    e.actual += act;
    byCategory.set(cat, e);
  }

  let cogs = 0;
  let wastageCost = 0;
  for (const l of ledgerRes.data ?? []) {
    const cost = n(l.quantity) * (wacById.get(l.raw_material_id) ?? 0);
    if (l.type === "SALES_DEPLETION") cogs += cost;
    else if (l.type === "WASTAGE") wastageCost += cost;
  }

  const chartData: CategoryCost[] = [...byCategory.entries()]
    .map(([category, v]) => ({ category, theoretical: Math.round(v.theoretical), actual: Math.round(v.actual) }))
    .sort((a, b) => b.theoretical - a.theoretical);

  const topLosses = rows
    .filter((r) => n(r.variance) < 0)
    .sort((a, b) => n(a.variance_value) - n(b.variance_value))
    .slice(0, 8);

  const unmapped = unmappedRes.data ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Variance Analysis</span>
      </div>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Flagship"
          title="Theoretical vs Actual"
          description="What the books say you should have, against what you physically counted — the gap is wastage, theft, or mis-portioning."
        />
        <nav className="flex gap-1 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-1">
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                d === days ? "bg-indigo-100 text-indigo-700" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {d === 365 ? "1y" : `${d}d`}
            </Link>
          ))}
        </nav>
      </div>

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load variance data: {loadError.message}.
        </p>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Theoretical Cost" value={inr(theoreticalCost)} subtitle="Book value at last count" icon={IcStack} delay={0} />
        <KpiCard label="Actual Cost" value={inr(actualCost)} subtitle="Physically counted value" icon={IcCalc} delay={0.05} />
        <KpiCard
          label="Uncontrolled Stock"
          value={inr(uncontrolledLoss)}
          subtitle="Shrinkage — wastage / theft"
          subtitleTone="negative"
          tone="danger"
          icon={IcAlert}
          delay={0.1}
        />
        <KpiCard label="Wastage Cost" value={inr(wastageCost)} subtitle={`COGS depleted: ${inr(cogs)}`} icon={IcTrash} delay={0.15} />
      </div>

      <GroupedBarCard
        title="Actual vs Theoretical Cost"
        subtitle="By item category — the spread between bars is your uncontrolled stock."
        hasData={chartData.length > 0}
        legend={[
          { label: "Theoretical", color: CHART.theoretical },
          { label: "Actual", color: CHART.actual },
        ]}
      >
        <VarianceChart data={chartData} />
      </GroupedBarCard>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Biggest losses */}
        <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="border-b border-[#e6e0d3] px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">Biggest shrinkage</h3>
          </div>
          {topLosses.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-neutral-500">No negative variances in range.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">Material</th>
                  <th className="px-5 py-2.5 text-right font-medium">System</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actual</th>
                  <th className="px-5 py-2.5 text-right font-medium">Loss</th>
                </tr>
              </thead>
              <tbody>
                {topLosses.map((r) => (
                  <tr key={`${r.department_id}:${r.raw_material_id}`} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-2.5 text-neutral-700">{r.raw_material_name}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">{n(r.system_qty)} {r.stock_unit}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">{n(r.actual_qty)} {r.stock_unit}</td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-red-600">{inr(n(r.variance_value))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Unmapped POS sales (Epic 1 discrepancy detection) */}
        <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="border-b border-[#e6e0d3] px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Unmapped POS items
              <span className="ml-2 text-neutral-500">{openUnmappedCount}</span>
            </h3>
          </div>
          {unmapped.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-neutral-500">
              Every sold item maps to a recipe.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">POS code</th>
                  <th className="px-5 py-2.5 font-medium">Item</th>
                  <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-5 py-2.5 text-right font-medium">Map &amp; replay</th>
                </tr>
              </thead>
              <tbody>
                {unmapped.map((u) => (
                  <tr key={u.id} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-2.5 font-mono text-xs text-amber-700">{u.pos_item_code ?? "—"}</td>
                    <td className="px-5 py-2.5 text-neutral-700">{u.item_name ?? "—"}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">{u.quantity}</td>
                    <td className="px-5 py-2.5 text-right">
                      <MapUnmappedRow posItemCode={u.pos_item_code} recipes={recipes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
