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
import DateRangeUrlControl from "../../../_components/DateRangeUrlControl";
import { resolveDateRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v ?? 0);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default async function MenuEngineeringPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const sp = await searchParams;
  const { from, to } = resolveDateRange(sp.from, sp.to);

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
      .gte("sold_on", from)
      .lte("sold_on", to),
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

      <SectionHeader
        eyebrow="Insights"
        title="Menu Engineering Matrix"
        description="Every dish plotted by how often it sells against how much margin it earns. Find your Stars, fix your Dogs."
      />
      <div className="mb-8 mt-4">
        <DateRangeUrlControl from={from} to={to} />
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
        subtitle={`Median split over ${from} → ${to}. ${points.length} dishes plotted.`}
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
