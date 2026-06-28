import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import ReconciliationForm from "../ReconciliationForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface Reconciliation {
  id: string;
  date: string;
  dine_in_gross: number;
  zomato_gross: number;
  swiggy_gross: number;
  cash_collected: number;
  upi_collected: number;
  card_collected: number;
  actual_bank_deposit: number;
}

export default async function ReconciliationPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, { data: posExp }] = await Promise.all([
    supabase
      .from("daily_sales_reconciliation")
      .select("*")
      .order("date", { ascending: false })
      .limit(14),
    supabase
      .from("pos_revenue_expected")
      .select("sale_date, expected_gross")
      .order("sale_date", { ascending: false })
      .limit(30),
  ]);
  const recon = (data ?? []) as Reconciliation[];
  // Expected gross the POS rang up, keyed by day — to flag reported-vs-POS gaps.
  const expectedByDate = new Map(
    (posExp ?? []).map((p) => [p.sale_date as string, Number(p.expected_gross)]),
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Daily Reconciliation</span>
      </div>

      <SectionHeader
        eyebrow="Operations"
        title="Daily Reconciliation"
        description="Record the day's sales channels and collections to match the bank deposit. Saving an existing date updates it."
      />

      <div className="mt-8">
        <ReconciliationForm />
      </div>

      {recon.length > 0 && (
        <div className="mt-10 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="border-b border-[#e6e0d3] px-5 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Recent reconciliations
            </h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 text-right font-medium">Gross (reported)</th>
                <th className="px-5 py-3 text-right font-medium">Expected (POS)</th>
                <th className="px-5 py-3 text-right font-medium">Δ vs POS</th>
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
                  n(r.cash_collected) + n(r.upi_collected) + n(r.card_collected);
                const variance = n(r.actual_bank_deposit) - coll;
                const expected = expectedByDate.get(r.date);
                const posDelta = expected != null ? gross - expected : null;
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
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-500">
                      {expected != null ? inr(expected) : "—"}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                        posDelta == null
                          ? "text-neutral-400"
                          : Math.abs(posDelta) > 1
                            ? "text-red-600"
                            : "text-emerald-600"
                      }`}
                      title={
                        posDelta != null && Math.abs(posDelta) > 1
                          ? "Reported gross differs from what the POS rang up"
                          : undefined
                      }
                    >
                      {posDelta != null ? inr(posDelta) : "—"}
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
