import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { getActiveLocation } from "@/lib/location";
import { inr } from "@/lib/format";
import SectionHeader from "../_components/SectionHeader";
import KpiCard from "../_components/KpiCard";

export const dynamic = "force-dynamic";

const svg = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[18px] w-[18px]"
  >
    {d.split("|").map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);
const IC = {
  outlets: svg("M3 21h18|M5 21V8l7-5 7 5v13|M9 21v-6h6v6"),
  sales: svg("M3 3v18h18|M8 17V9m4 8V5m4 12v-6"),
  dues: svg(
    "M10.3 3.9l-7.6 13A2 2 0 004.4 20h15.2a2 2 0 001.7-3l-7.6-13a2 2 0 00-3.4 0z|M12 9v4|M12 17h.01",
  ),
  variance: svg("M12 3v18|M5 7h14|M5 7l-2 6h4l-2-6zM19 7l-2 6h4l-2-6z"),
};

const n = (v: unknown) => Number(v ?? 0);

interface Row {
  id: string;
  name: string;
  revenue: number;
  dues: number;
  variance: number;
}

export default async function PortfolioPage() {
  const { user, roles } = await getCurrentUserAndRoles();
  // Portfolio is the cross-outlet (read-only roll-up) surface for Owner / Area Manager.
  if (
    !user ||
    !(roles.includes(ROLES.OWNER) || roles.includes(ROLES.AREA_MANAGER))
  ) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const { activeId, locations } = await getActiveLocation(supabase);

  // Last-30-days revenue window.
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);

  const [duesRes, reconRes, varRes] = await Promise.all([
    supabase.from("vendor_dues").select("location_id, outstanding_due"),
    supabase
      .from("daily_sales_reconciliation")
      .select("location_id, date, dine_in_gross, zomato_gross, swiggy_gross")
      .gte("date", sinceStr),
    supabase
      .from("stock_count_variance")
      .select("location_id, variance_value"),
  ]);

  const loadError = duesRes.error || reconRes.error || varRes.error;

  // Aggregate per location (seeded with every visible outlet so empties show 0).
  const byLoc = new Map<string, Row>();
  for (const l of locations) {
    byLoc.set(l.id, { id: l.id, name: l.name, revenue: 0, dues: 0, variance: 0 });
  }
  for (const r of reconRes.data ?? []) {
    const e = byLoc.get(r.location_id as string);
    if (e) e.revenue += n(r.dine_in_gross) + n(r.zomato_gross) + n(r.swiggy_gross);
  }
  for (const d of duesRes.data ?? []) {
    const e = byLoc.get(d.location_id as string);
    if (e) e.dues += n(d.outstanding_due);
  }
  for (const v of varRes.data ?? []) {
    const e = byLoc.get(v.location_id as string);
    if (e) e.variance += n(v.variance_value);
  }

  // Honor the outlet switcher: a focused outlet narrows the roll-up to one row.
  const rows = (activeId
    ? [...byLoc.values()].filter((r) => r.id === activeId)
    : [...byLoc.values()]
  ).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalDues = rows.reduce((s, r) => s + r.dues, 0);
  const totalVariance = rows.reduce((s, r) => s + r.variance, 0);
  const scopeLabel = activeId
    ? (rows[0]?.name ?? "Outlet")
    : `${rows.length} outlet${rows.length === 1 ? "" : "s"}`;

  return (
    <div>
      <SectionHeader
        eyebrow="Portfolio"
        title="Outlet Roll-up"
        description="Read-only consolidated view across the outlets you oversee. Use the outlet switcher to focus on one location."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Outlets in view"
          value={String(rows.length)}
          subtitle={scopeLabel}
          icon={IC.outlets}
          delay={0}
        />
        <KpiCard
          label="Revenue (30d)"
          value={inr(totalRevenue)}
          subtitle="Dine-in + Zomato + Swiggy"
          icon={IC.sales}
          delay={0.05}
        />
        <KpiCard
          label="Outstanding dues"
          value={inr(totalDues)}
          subtitle="Across outlets in view"
          subtitleTone={totalDues > 0 ? "negative" : "neutral"}
          tone={totalDues > 0 ? "danger" : "default"}
          icon={IC.dues}
          delay={0.1}
        />
        <KpiCard
          label="Stock variance"
          value={inr(totalVariance)}
          subtitle="Counted − system (₹)"
          subtitleTone={totalVariance < 0 ? "negative" : "neutral"}
          tone={totalVariance < 0 ? "danger" : "default"}
          icon={IC.variance}
          delay={0.15}
        />
      </div>

      <div className="mt-10 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">By outlet</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No outlets in view.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Outlet</th>
                <th className="px-5 py-3 text-right font-medium">Revenue (30d)</th>
                <th className="px-5 py-3 text-right font-medium">Outstanding</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {r.name}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                    {inr(r.revenue)}
                  </td>
                  <td
                    className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                      r.dues > 0 ? "text-red-600" : "text-neutral-600"
                    }`}
                  >
                    {inr(r.dues)}
                  </td>
                  <td
                    className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                      r.variance < 0
                        ? "text-red-600"
                        : r.variance > 0
                          ? "text-emerald-600"
                          : "text-neutral-600"
                    }`}
                  >
                    {inr(r.variance)}
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
