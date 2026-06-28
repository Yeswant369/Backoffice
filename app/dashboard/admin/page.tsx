import { createClient } from "@/lib/supabase/server";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../_components/SectionHeader";
import KpiCard from "../_components/KpiCard";

export const dynamic = "force-dynamic";

// Inline icons for the KPI badges (passed as ReactNode to the client KpiCard).
const svg = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
    {d.split("|").map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);
const IC = {
  dues: svg("M10.3 3.9l-7.6 13A2 2 0 004.4 20h15.2a2 2 0 001.7-3l-7.6-13a2 2 0 00-3.4 0z|M12 9v4|M12 17h.01"),
  cart: svg("M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z|M3 6h18|M16 10a4 4 0 01-8 0"),
  paid: svg("M20 6L9 17l-5-5"),
  vendors: svg("M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8z|M19 8v6|M22 11h-6"),
  sales: svg("M3 3v18h18|M8 17V9m4 8V5m4 12v-6"),
  receipt: svg("M4 3h16v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8"),
  wallet: svg("M19 7H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2zM16 13h.01M21 9V7a2 2 0 00-2-2H6"),
  scale: svg("M12 3v18|M5 7h14|M5 7l-2 6h4l-2-6zM19 7l-2 6h4l-2-6z"),
};

interface VendorDue {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  status: string;
  total_purchased: number;
  total_paid: number;
  outstanding_due: number;
}

interface Reconciliation {
  id: string;
  date: string;
  dine_in_gross: number;
  zomato_gross: number;
  swiggy_gross: number;
  cash_collected: number;
  upi_collected: number;
  card_collected: number;
  aggregator_commissions: number;
  actual_bank_deposit: number;
}

const n = (v: unknown) => Number(v ?? 0);

export default async function AdminFinancialOverview() {
  const supabase = await createClient();

  const [duesResult, reconResult] = await Promise.all([
    supabase
      .from("vendor_dues")
      .select(
        "vendor_id, vendor_code, vendor_name, status, total_purchased, total_paid, outstanding_due",
      )
      .order("outstanding_due", { ascending: false }),
    supabase
      .from("daily_sales_reconciliation")
      .select("*")
      .order("date", { ascending: false })
      .limit(14),
  ]);

  const dues = (duesResult.data ?? []) as VendorDue[];
  const recon = (reconResult.data ?? []) as Reconciliation[];
  const loadError = duesResult.error || reconResult.error;

  // Vendor aggregates
  const totalOutstanding = dues.reduce((s, d) => s + n(d.outstanding_due), 0);
  const totalPurchased = dues.reduce((s, d) => s + n(d.total_purchased), 0);
  const totalPaid = dues.reduce((s, d) => s + n(d.total_paid), 0);
  const vendorsWithDues = dues.filter((d) => n(d.outstanding_due) > 0).length;

  // Latest reconciliation
  const latest = recon[0];
  const grossSales = latest
    ? n(latest.dine_in_gross) + n(latest.zomato_gross) + n(latest.swiggy_gross)
    : 0;
  const collected = latest
    ? n(latest.cash_collected) +
      n(latest.upi_collected) +
      n(latest.card_collected)
    : 0;
  const depositVariance = latest ? n(latest.actual_bank_deposit) - collected : 0;

  return (
    <div>
      <div className="mb-8">
        <SectionHeader
          eyebrow="Dashboards"
          title="Financial Overview"
          description="Vendor liabilities, revenue and cash flow at a glance."
        />
      </div>

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}. Confirm the Phase 1
          migration (views + grants) has been applied.
        </p>
      )}

      {/* Vendor liability metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Outstanding dues"
          value={inr(totalOutstanding)}
          subtitle={`${vendorsWithDues} vendor${vendorsWithDues === 1 ? "" : "s"} owing`}
          subtitleTone={totalOutstanding > 0 ? "negative" : "neutral"}
          tone={totalOutstanding > 0 ? "danger" : "default"}
          icon={IC.dues}
          delay={0}
        />
        <KpiCard
          label="Total purchased"
          value={inr(totalPurchased)}
          subtitle="All-time vendor spend"
          icon={IC.cart}
          delay={0.05}
        />
        <KpiCard
          label="Total paid"
          value={inr(totalPaid)}
          subtitle="Settled to vendors"
          subtitleTone="positive"
          tone="positive"
          icon={IC.paid}
          delay={0.1}
        />
        <KpiCard
          label="Active vendors"
          value={String(dues.length)}
          subtitle="with ledger activity"
          icon={IC.vendors}
          delay={0.15}
        />
      </div>

      {/* Latest reconciliation snapshot */}
      <h2 className="mb-3 mt-10 text-sm font-semibold text-neutral-900">
        Latest reconciliation
        {latest && (
          <span className="ml-2 font-normal text-neutral-500">
            {formatDate(latest.date)}
          </span>
        )}
      </h2>
      {latest ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Gross sales"
            value={inr(grossSales)}
            subtitle="Dine-in + Zomato + Swiggy"
            icon={IC.sales}
            delay={0}
          />
          <KpiCard
            label="Aggregator commissions"
            value={inr(latest.aggregator_commissions)}
            subtitle="Platform fees deducted"
            subtitleTone="negative"
            icon={IC.receipt}
            delay={0.05}
          />
          <KpiCard
            label="Total collected"
            value={inr(collected)}
            subtitle="Cash + UPI + Card"
            icon={IC.wallet}
            delay={0.1}
          />
          <KpiCard
            label="Deposit variance"
            value={inr(depositVariance)}
            subtitle="Bank deposit − collected"
            subtitleTone={
              depositVariance < 0 ? "negative" : depositVariance > 0 ? "positive" : "neutral"
            }
            tone={
              depositVariance < 0 ? "danger" : depositVariance > 0 ? "positive" : "default"
            }
            icon={IC.scale}
            delay={0.15}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-8 text-center text-sm text-neutral-500">
          No reconciliation entries yet. Log one under Operations → Daily
          Reconciliation.
        </p>
      )}

      {/* Vendor dues table */}
      <div className="mt-10 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Vendor dues</h2>
        </div>
        {dues.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No vendor activity yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Vendor</th>
                <th className="px-5 py-3 text-right font-medium">Purchased</th>
                <th className="px-5 py-3 text-right font-medium">Paid</th>
                <th className="px-5 py-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {dues.map((d) => {
                const outstanding = n(d.outstanding_due);
                return (
                  <tr
                    key={d.vendor_id}
                    className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-neutral-900">
                        {d.vendor_name}
                      </span>
                      <span className="ml-2 text-xs text-neutral-500">
                        {d.vendor_code}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(d.total_purchased)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(d.total_paid)}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                        outstanding > 0 ? "text-red-600" : "text-neutral-600"
                      }`}
                    >
                      {inr(outstanding)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent reconciliations table */}
      {recon.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="border-b border-[#e6e0d3] px-5 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Recent reconciliations
            </h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 text-right font-medium">Gross</th>
                <th className="px-5 py-3 text-right font-medium">Collected</th>
                <th className="px-5 py-3 text-right font-medium">Deposit</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {recon.map((r) => {
                const gross =
                  n(r.dine_in_gross) + n(r.zomato_gross) + n(r.swiggy_gross);
                const coll =
                  n(r.cash_collected) +
                  n(r.upi_collected) +
                  n(r.card_collected);
                const variance = n(r.actual_bank_deposit) - coll;
                return (
                  <tr
                    key={r.id}
                    className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                  >
                    <td className="px-5 py-3.5 text-neutral-700">
                      {formatDate(r.date)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(gross)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(coll)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(r.actual_bank_deposit)}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                        variance < 0
                          ? "text-red-600"
                          : variance > 0
                            ? "text-emerald-600"
                            : "text-neutral-600"
                      }`}
                    >
                      {inr(variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
