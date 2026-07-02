import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import { resolveDateRange } from "@/lib/date-range";
import SectionHeader from "../../../_components/SectionHeader";
import DateRangeUrlControl from "../../../_components/DateRangeUrlControl";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface DailyRow { order_date: string; orders: number; gross: number; discount: number; gst: number; net: number; }
interface ChannelRow { channel: string; orders: number; gross: number; net: number; gst: number; net_payout: number; }
interface DaypartRow { daypart: string; orders: number; net: number; }
interface ItemRow { item_name: string; category: string | null; qty_sold: number; revenue: number; food_cost: number; gross_profit: number; }

const DAYPART_ORDER = ["Morning", "Afternoon", "Evening", "Night"];

export default async function PosSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const sp = await searchParams;
  const { from, to } = resolveDateRange(sp.from, sp.to);

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [dailyRes, channelRes, daypartRes, itemsRes] = await Promise.all([
    supabase.from("pos_daily_sales").select("*").eq("location_id", loc).gte("order_date", from).lte("order_date", to).order("order_date"),
    supabase.from("pos_sales_by_channel").select("*").eq("location_id", loc).gte("order_date", from).lte("order_date", to),
    supabase.from("pos_daypart").select("*").eq("location_id", loc).gte("order_date", from).lte("order_date", to),
    supabase.from("pos_item_report").select("*").eq("location_id", loc).gte("order_date", from).lte("order_date", to),
  ]);

  const daily = (dailyRes.data ?? []) as DailyRow[];
  const totals = daily.reduce(
    (a, d) => ({
      orders: a.orders + n(d.orders),
      gross: a.gross + n(d.gross),
      gst: a.gst + n(d.gst),
      net: a.net + n(d.net),
    }),
    { orders: 0, gross: 0, gst: 0, net: 0 },
  );

  // Aggregate channel rows (day-grain → period) by channel.
  const channelMap = new Map<string, ChannelRow>();
  for (const r of (channelRes.data ?? []) as ChannelRow[]) {
    const c = channelMap.get(r.channel) ?? { channel: r.channel, orders: 0, gross: 0, net: 0, gst: 0, net_payout: 0 };
    c.orders += n(r.orders); c.gross += n(r.gross); c.net += n(r.net); c.gst += n(r.gst); c.net_payout += n(r.net_payout);
    channelMap.set(r.channel, c);
  }
  const channels = [...channelMap.values()].sort((a, b) => b.net - a.net);

  const daypartMap = new Map<string, { orders: number; net: number }>();
  for (const r of (daypartRes.data ?? []) as DaypartRow[]) {
    const d = daypartMap.get(r.daypart) ?? { orders: 0, net: 0 };
    d.orders += n(r.orders); d.net += n(r.net);
    daypartMap.set(r.daypart, d);
  }

  const itemMap = new Map<string, ItemRow>();
  for (const r of (itemsRes.data ?? []) as ItemRow[]) {
    const it = itemMap.get(r.item_name) ?? { item_name: r.item_name, category: r.category, qty_sold: 0, revenue: 0, food_cost: 0, gross_profit: 0 };
    it.qty_sold += n(r.qty_sold); it.revenue += n(r.revenue); it.food_cost += n(r.food_cost); it.gross_profit += n(r.gross_profit);
    itemMap.set(r.item_name, it);
  }
  const items = [...itemMap.values()].sort((a, b) => b.gross_profit - a.gross_profit);

  const empty = daily.length === 0;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">Dashboards</Link>
        <span>/</span>
        <span className="text-neutral-700">POS Sales</span>
      </div>

      <SectionHeader
        eyebrow="Dashboards"
        title="POS Sales"
        description="Petpooja orders — daily sales, GST, channel mix (Swiggy / Zomato / Dine-in) net of commission, dayparts and item profitability."
      />
      <div className="mb-6 mt-4">
        <DateRangeUrlControl from={from} to={to} />
      </div>

      {empty ? (
        <p className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-10 text-center text-sm text-neutral-500">
          No POS orders in this window yet. Connect Petpooja in Settings → POS
          Integration and run a sync/backfill.
        </p>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Orders", value: totals.orders.toString() },
              { label: "Gross sales", value: inr(totals.gross) },
              { label: "Net sales", value: inr(totals.net) },
              { label: "GST collected", value: inr(totals.gst) },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-4">
                <p className="text-xs uppercase tracking-wider text-neutral-500">{k.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{k.value}</p>
              </div>
            ))}
          </div>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Sales by channel</h2>
            <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="px-5 py-3 font-medium">Channel</th>
                    <th className="px-5 py-3 text-right font-medium">Orders</th>
                    <th className="px-5 py-3 text-right font-medium">Net sales</th>
                    <th className="px-5 py-3 text-right font-medium">After commission</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.channel} className="border-t border-[#e6e0d3]">
                      <td className="px-5 py-3 font-medium text-neutral-900">{c.channel}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">{c.orders}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">{inr(c.net)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-neutral-900">{inr(c.net_payout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-xs text-neutral-500">
              &quot;After commission&quot; applies the per-platform % from Settings — set Swiggy/Zomato commission to see true take-home.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Dayparts</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {DAYPART_ORDER.map((dp) => {
                const d = daypartMap.get(dp) ?? { orders: 0, net: 0 };
                return (
                  <div key={dp} className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-4">
                    <p className="text-xs uppercase tracking-wider text-neutral-500">{dp}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-900">{inr(d.net)}</p>
                    <p className="text-xs text-neutral-500">{d.orders} orders</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Items by profit</h2>
            <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-5 py-3 text-right font-medium">Qty</th>
                    <th className="px-5 py-3 text-right font-medium">Revenue</th>
                    <th className="px-5 py-3 text-right font-medium">Food cost</th>
                    <th className="px-5 py-3 text-right font-medium">Gross profit</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 25).map((it) => (
                    <tr key={it.item_name} className="border-t border-[#e6e0d3]">
                      <td className="px-5 py-3 font-medium text-neutral-900">{it.item_name}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-600">{it.qty_sold}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">{inr(it.revenue)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-500">{inr(it.food_cost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-emerald-700">{inr(it.gross_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
