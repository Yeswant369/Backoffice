import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../../_components/SectionHeader";
import MetricCard from "../../../_components/MetricCard";
import ChartCard from "../../../analytics/ChartCard";
import MenuEngineeringChart, {
  type MenuPoint,
  type Quadrant,
} from "./MenuEngineeringChart";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90, 365] as const;
const num = (v: unknown) => Number(v ?? 0);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function istDateNDaysAgo(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  // IST date string YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export default async function MenuEngineeringPage({
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

  const supabase = await createClient();
  const [costingRes, volRes] = await Promise.all([
    supabase
      .from("recipe_costing")
      .select(
        "recipe_id, recipe_name, category, selling_price, cogs, margin_value, margin_pct, food_cost_pct",
      ),
    supabase
      .from("recipe_sales_volume")
      .select("recipe_id, portions, sold_on")
      .gte("sold_on", fromDate),
  ]);
  const loadError = costingRes.error || volRes.error;

  const volByRecipe = new Map<string, number>();
  for (const r of volRes.data ?? [])
    volByRecipe.set(
      r.recipe_id,
      (volByRecipe.get(r.recipe_id) ?? 0) + num(r.portions),
    );

  const base = (costingRes.data ?? []).map((c) => ({
    recipeId: c.recipe_id as string,
    name: c.recipe_name as string,
    category: (c.category as string) ?? "Uncategorised",
    sellingPrice: num(c.selling_price),
    cogs: num(c.cogs),
    marginValue: num(c.margin_value),
    marginPct: num(c.margin_pct),
    volume: volByRecipe.get(c.recipe_id) ?? 0,
  }));

  const totalVolume = base.reduce((s, p) => s + p.volume, 0);
  const medV = median(base.map((p) => p.volume));
  const medM = median(base.map((p) => p.marginPct));

  const classify = (volume: number, marginPct: number): Quadrant => {
    // When the median is 0 (e.g. most dishes are unsold), `>= median` would mark
    // EVERY dish "high", collapsing the low quadrants — fall back to a strict
    // positive test so unsold/unprofitable dishes land in Dogs/Puzzles correctly.
    const hiVol = medV > 0 ? volume >= medV : volume > 0;
    const hiMargin = medM > 0 ? marginPct >= medM : marginPct > 0;
    return hiVol && hiMargin
      ? "star"
      : hiVol
        ? "plow"
        : hiMargin
          ? "puzzle"
          : "dog";
  };

  const points: MenuPoint[] = base.map((p) => ({
    ...p,
    salesMixPct: totalVolume > 0 ? (p.volume / totalVolume) * 100 : 0,
    quadrant: classify(p.volume, p.marginPct),
  }));

  const count = (q: Quadrant) => points.filter((p) => p.quadrant === q).length;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Menu Engineering</span>
      </div>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          eyebrow="Insights"
          title="Menu Engineering Matrix"
          description="Every dish plotted by how often it sells against how much margin it earns. Find your Stars, fix your Dogs."
        />
        <nav className="flex gap-1 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-1">
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                d === days
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {d === 365 ? "1y" : `${d}d`}
            </Link>
          ))}
        </nav>
      </div>

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load menu data: {loadError.message}.
        </p>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Stars" value={String(count("star"))} sub="High volume · high margin" tone="positive" />
        <MetricCard label="Plow Horses" value={String(count("plow"))} sub="Popular but thin margin" />
        <MetricCard label="Puzzles" value={String(count("puzzle"))} sub="Profitable but underselling" />
        <MetricCard label="Dogs" value={String(count("dog"))} sub="Low volume · low margin" tone="negative" />
      </div>

      <ChartCard
        title="Profitability vs. Popularity"
        subtitle={`Median split over the last ${days} days. ${points.length} dishes plotted.`}
        hasData={points.length >= 2}
        emptyMessage="Add recipes with selling prices and at least two days of sales to populate the matrix."
        legend={[
          { label: "Stars", color: "rgba(99,102,241,0.5)" },
          { label: "Plow Horses", color: "rgba(245,158,11,0.4)" },
          { label: "Puzzles", color: "rgba(139,92,246,0.4)" },
          { label: "Dogs", color: "rgba(239,68,68,0.35)" },
        ]}
      >
        <MenuEngineeringChart
          points={points}
          medianVolume={medV}
          medianMargin={medM}
        />
      </ChartCard>
    </div>
  );
}
