import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/format";
import SectionHeader from "../_components/SectionHeader";
import MetricCard from "../_components/MetricCard";
import ManagerActions, {
  type PettyRow,
  type ReconRow,
  type SaleRow,
} from "./ManagerActions";
import type { RecipeLite } from "./SalesLogForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface VendorDue {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  total_purchased: number;
  total_paid: number;
  outstanding_due: number;
}

export default async function ManagerPage() {
  const supabase = await createClient();

  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [duesRes, reconRes, pettyRes, salesRes, recipesRes] =
    await Promise.all([
      supabase
        .from("vendor_dues")
        .select(
          "vendor_id, vendor_code, vendor_name, total_purchased, total_paid, outstanding_due",
        )
        .order("outstanding_due", { ascending: false }),
      supabase
        .from("daily_sales_reconciliation")
        .select("*")
        .order("date", { ascending: false })
        .limit(10),
      supabase
        .from("petty_cash_expenses")
        .select("id, amount, category, description, date")
        .gte("date", firstOfMonth)
        .order("date", { ascending: false }),
      supabase
        .from("manual_sales_log")
        .select("id, quantity_sold, sale_date, recipes ( name, selling_price )")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("recipes")
        .select("id, name, selling_price")
        .order("name"),
    ]);

  const dues = (duesRes.data ?? []) as VendorDue[];
  const recipes = (recipesRes.data ?? []) as RecipeLite[];
  const loadError =
    duesRes.error ||
    reconRes.error ||
    pettyRes.error ||
    salesRes.error ||
    recipesRes.error;

  // Metrics
  const outstanding = dues.reduce((s, d) => s + n(d.outstanding_due), 0);
  const vendorsOwing = dues.filter((d) => n(d.outstanding_due) > 0).length;
  const pettyMTD = (pettyRes.data ?? []).reduce((s, p) => s + n(p.amount), 0);

  const recentReconciliations: ReconRow[] = (reconRes.data ?? []).map((r) => {
    const gross =
      n(r.dine_in_gross) + n(r.zomato_gross) + n(r.swiggy_gross);
    const collected =
      n(r.cash_collected) + n(r.upi_collected) + n(r.card_collected);
    return {
      id: r.id,
      date: r.date,
      gross,
      collected,
      deposit: n(r.actual_bank_deposit),
      variance: n(r.actual_bank_deposit) - collected,
    };
  });
  const latest = recentReconciliations[0];

  const recentPettyCash: PettyRow[] = (pettyRes.data ?? [])
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      date: p.date,
      category: p.category,
      description: p.description,
      amount: n(p.amount),
    }));

  const recentSales: SaleRow[] = (salesRes.data ?? []).map((s) => {
    // PostgREST returns the joined to-one relation as an object.
    const recipe = s.recipes as unknown as {
      name: string;
      selling_price: number;
    } | null;
    return {
      id: s.id,
      date: s.sale_date,
      recipe_name: recipe?.name ?? "—",
      qty: n(s.quantity_sold),
      revenue: n(s.quantity_sold) * n(recipe?.selling_price),
    };
  });

  return (
    <div>
      <SectionHeader
        eyebrow="Management"
        title="Operations & Finance"
        description="Track vendor dues, reconcile daily multi-channel sales, and control petty cash."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}. Confirm the Phase 1
          migration (views + grants) has been applied.
        </p>
      )}

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Outstanding dues"
          value={inr(outstanding)}
          sub={`${vendorsOwing} vendor${vendorsOwing === 1 ? "" : "s"} owing`}
          tone={outstanding > 0 ? "negative" : "default"}
        />
        <MetricCard
          label="Petty cash (this month)"
          value={inr(pettyMTD)}
        />
        <MetricCard
          label="Latest gross sales"
          value={inr(latest?.gross ?? 0)}
          sub={latest ? `as of ${latest.date}` : "no entries"}
        />
        <MetricCard
          label="Latest deposit variance"
          value={inr(latest?.variance ?? 0)}
          tone={
            !latest || latest.variance === 0
              ? "default"
              : latest.variance < 0
                ? "negative"
                : "positive"
          }
        />
      </div>

      {/* Vendor dues */}
      <div className="mt-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
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
                const out = n(d.outstanding_due);
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
                        out > 0 ? "text-red-600" : "text-neutral-600"
                      }`}
                    >
                      {inr(out)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Action modules */}
      <div className="mt-8">
        <ManagerActions
          recipes={recipes}
          recentReconciliations={recentReconciliations}
          recentPettyCash={recentPettyCash}
          recentSales={recentSales}
        />
      </div>
    </div>
  );
}
