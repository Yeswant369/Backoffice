import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "@/app/dashboard/_components/SectionHeader";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90, 365] as const;
const n = (v: unknown) => Number(v ?? 0);
const pct = (part: number, whole: number) =>
  whole > 0 ? (part / whole) * 100 : 0;

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

interface PLRow {
  pl_date: string;
  revenue: number;
  items_sold: number;
  theoretical_cogs: number;
  wastage_cost: number;
  variance_cost: number;
  actual_cogs: number;
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "good"
            ? "text-emerald-600"
            : tone === "bad"
              ? "text-red-600"
              : tone === "warn"
                ? "text-amber-700"
                : "text-neutral-900"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

export default async function ProfitPage({
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
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data, error } = await supabase
    .from("pl_daily")
    .select(
      "pl_date, revenue, items_sold, theoretical_cogs, wastage_cost, variance_cost, actual_cogs",
    )
    .eq("location_id", loc)
    .gte("pl_date", fromDate)
    .order("pl_date", { ascending: false });
  const rows = (data ?? []) as PLRow[];

  const t = rows.reduce(
    (a, r) => ({
      revenue: a.revenue + n(r.revenue),
      theoretical: a.theoretical + n(r.theoretical_cogs),
      wastage: a.wastage + n(r.wastage_cost),
      variance: a.variance + n(r.variance_cost),
      actual: a.actual + n(r.actual_cogs),
    }),
    { revenue: 0, theoretical: 0, wastage: 0, variance: 0, actual: 0 },
  );
  const grossProfit = t.revenue - t.actual;
  const theoFc = pct(t.theoretical, t.revenue);
  const actualFc = pct(t.actual, t.revenue);
  const gap = actualFc - theoFc;
  const marginPct = pct(grossProfit, t.revenue);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Dashboards
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Cost &amp; Profit</span>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          eyebrow="Dashboards"
          title="Cost & Profit"
          description="Theoretical vs actual food cost. The gap between what recipes say and what stock actually consumed is your wastage + shrinkage leakage."
        />
        <div className="flex gap-1 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-1">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/dashboard/admin/analytics/profit?days=${p}`}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                days === p
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {p}d
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load P&amp;L: {error.message}. Confirm migration 0022 has
          been applied.
        </p>
      )}
      {!loc && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          No home location is set for your account, so there&apos;s nothing to
          show here.
        </p>
      )}
      <p className="mb-6 text-xs text-neutral-500">
        Costs are valued at the current weighted-average cost. The daily
        breakdown is approximate — wastage and stock-count variance land on their
        entry day — so read the cards above as the reliable period totals.
      </p>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Revenue" value={inr(t.revenue)} sub={`${days} days`} />
        <Card
          label="Theoretical food cost"
          value={`${theoFc.toFixed(1)}%`}
          sub={inr(t.theoretical)}
        />
        <Card
          label="Actual food cost"
          value={`${actualFc.toFixed(1)}%`}
          sub={inr(t.actual)}
          tone={actualFc > 40 ? "bad" : actualFc > 32 ? "warn" : "good"}
        />
        <Card
          label="Leakage (actual − theoretical)"
          value={`${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`}
          sub="wastage + shrinkage"
          tone={gap > 5 ? "bad" : gap > 2 ? "warn" : "good"}
        />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Wastage cost" value={inr(t.wastage)} />
        <Card label="Variance (count) cost" value={inr(t.variance)} />
        <Card label="Actual COGS" value={inr(t.actual)} />
        <Card
          label="Gross profit"
          value={inr(grossProfit)}
          sub={`${marginPct.toFixed(1)}% margin`}
          tone={grossProfit >= 0 ? "good" : "bad"}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Daily breakdown</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No activity in this period.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
                <th className="px-5 py-3 text-right font-medium">Theoretical</th>
                <th className="px-5 py-3 text-right font-medium">Wastage</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
                <th className="px-5 py-3 text-right font-medium">Actual</th>
                <th className="px-5 py-3 text-right font-medium">Food cost %</th>
                <th className="px-5 py-3 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fc = pct(n(r.actual_cogs), n(r.revenue));
                const profit = n(r.revenue) - n(r.actual_cogs);
                return (
                  <tr key={r.pl_date} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-3 text-neutral-700">{r.pl_date}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-700">
                      {inr(r.revenue)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-500">
                      {inr(r.theoretical_cogs)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-500">
                      {inr(r.wastage_cost)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-500">
                      {inr(r.variance_cost)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-700">
                      {inr(r.actual_cogs)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right tabular-nums ${
                        fc > 40 ? "text-red-600" : "text-neutral-600"
                      }`}
                    >
                      {n(r.revenue) > 0 ? `${fc.toFixed(1)}%` : "—"}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold tabular-nums ${
                        profit >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {inr(profit)}
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
