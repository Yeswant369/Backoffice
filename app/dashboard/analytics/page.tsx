import { createClient } from "@/lib/supabase/server";
import { getActiveLocation } from "@/lib/location";
import { inr } from "@/lib/format";
import SectionHeader from "../_components/SectionHeader";
import MetricCard from "../_components/MetricCard";
import ChartCard from "./ChartCard";
import VendorCashFlowChart, {
  type CashFlowPoint,
} from "./VendorCashFlowChart";
import RevenueTrendChart, { type RevenuePoint } from "./RevenueTrendChart";

export const dynamic = "force-dynamic";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const n = (v: unknown) => Number(v ?? 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} '${y.slice(2)}`;
}
function dayLabel(d: string) {
  const [, m, day] = d.split("-");
  return `${day} ${MONTHS[Number(m) - 1]}`;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();

  // Honor the outlet switcher. When a specific outlet is focused, scope to it;
  // "All outlets" (activeId null) leaves the query at the RLS-visible set. For
  // single-location users activeId is their one location — a no-op filter.
  const { activeId } = await getActiveLocation(supabase);

  let purchaseQ = supabase
    .from("inventory_ledger")
    .select("created_at, quantity, unit_price")
    .eq("type", "PURCHASE");
  let paymentQ = supabase
    .from("vendor_payments")
    .select("payment_date, amount_paid");
  let salesQ = supabase
    .from("daily_sales_reconciliation")
    .select("date, dine_in_gross, zomato_gross, swiggy_gross")
    .order("date", { ascending: true });

  if (activeId) {
    purchaseQ = purchaseQ.eq("location_id", activeId);
    paymentQ = paymentQ.eq("location_id", activeId);
    salesQ = salesQ.eq("location_id", activeId);
  }

  const [purchaseRes, paymentRes, salesRes] = await Promise.all([
    purchaseQ,
    paymentQ,
    salesQ,
  ]);

  const loadError = purchaseRes.error || paymentRes.error || salesRes.error;

  // --- Chart 1: vendor cash flow, grouped by month ---------------------------
  const monthMap = new Map<string, { purchased: number; paid: number }>();
  for (const r of purchaseRes.data ?? []) {
    const key = String(r.created_at).slice(0, 7);
    const e = monthMap.get(key) ?? { purchased: 0, paid: 0 };
    e.purchased += n(r.quantity) * n(r.unit_price);
    monthMap.set(key, e);
  }
  for (const r of paymentRes.data ?? []) {
    const key = String(r.payment_date).slice(0, 7);
    const e = monthMap.get(key) ?? { purchased: 0, paid: 0 };
    e.paid += n(r.amount_paid);
    monthMap.set(key, e);
  }

  const months = [...monthMap.keys()].sort();
  const cashFlow: CashFlowPoint[] = months.map((key, i) => {
    const e = monthMap.get(key)!;
    // Cumulative outstanding = running sum of (purchased − paid) up to this month.
    const outstanding = months.slice(0, i + 1).reduce((sum, k) => {
      const m = monthMap.get(k)!;
      return sum + m.purchased - m.paid;
    }, 0);
    return {
      monthLabel: monthLabel(key),
      purchased: round2(e.purchased),
      paid: round2(e.paid),
      outstanding: round2(outstanding),
    };
  });
  const outstandingNow = cashFlow.at(-1)?.outstanding ?? 0;

  // --- Chart 2: daily revenue by channel -------------------------------------
  const revenue: RevenuePoint[] = (salesRes.data ?? []).map((r) => ({
    dateLabel: dayLabel(String(r.date)),
    dineIn: n(r.dine_in_gross),
    zomato: n(r.zomato_gross),
    swiggy: n(r.swiggy_gross),
  }));

  // --- KPIs ------------------------------------------------------------------
  const totalPurchased = cashFlow.reduce((s, m) => s + m.purchased, 0);
  const totalPaid = cashFlow.reduce((s, m) => s + m.paid, 0);
  const totalRevenue = revenue.reduce(
    (s, d) => s + d.dineIn + d.zomato + d.swiggy,
    0,
  );

  return (
    <div>
      <SectionHeader
        eyebrow="Insights"
        title="Analytics"
        description="Cash flow against vendors and revenue trends across every sales channel."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}.
        </p>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total purchased" value={inr(totalPurchased)} />
        <MetricCard label="Total paid" value={inr(totalPaid)} tone="positive" />
        <MetricCard
          label="Outstanding now"
          value={inr(outstandingNow)}
          tone={outstandingNow > 0 ? "negative" : "default"}
        />
        <MetricCard label="Total revenue" value={inr(totalRevenue)} />
      </div>

      <div className="space-y-6">
        <ChartCard
          title="Vendor Cash Flow"
          subtitle="Monthly purchases vs. payments, with cumulative outstanding dues."
          hasData={cashFlow.length >= 2}
          emptyMessage="Once there are at least two months of purchases or payments, the cash-flow trend will appear here."
          legend={[
            { label: "Total Purchased", color: "rgba(0,0,0,0.75)" },
            { label: "Total Paid", color: "rgba(0,0,0,0.30)" },
            { label: "Outstanding", color: "#4f46e5", line: true },
          ]}
        >
          <VendorCashFlowChart data={cashFlow} />
        </ChartCard>

        <ChartCard
          title="Revenue Trends"
          subtitle="Daily gross sales, stacked by channel."
          hasData={revenue.length >= 2}
          emptyMessage="Log at least two days of sales reconciliation to see channel revenue trends."
          delay={0.1}
          legend={[
            { label: "Dine-in", color: "rgba(0,0,0,0.82)" },
            { label: "Zomato", color: "rgba(0,0,0,0.50)" },
            { label: "Swiggy", color: "rgba(0,0,0,0.32)" },
          ]}
        >
          <RevenueTrendChart data={revenue} />
        </ChartCard>
      </div>
    </div>
  );
}
