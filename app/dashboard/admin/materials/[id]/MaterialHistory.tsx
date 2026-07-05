"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { inr, formatDate } from "@/lib/format";
import DateRangePresets from "../../../_components/DateRangePresets";

export interface MaterialPurchaseEntry {
  id: string;
  date: string; // business date (bill date, else entry date)
  vendorId: string | null;
  vendor: string;
  qty: number;
  unitPrice: number;
}

const within = (date: string, from: string, to: string) => {
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

/**
 * Purchase history for one raw material: date-range filter → grand totals →
 * one table PER VENDOR (when bought from several), each with its own subtotal,
 * last date and last rate. Vendor names link to the vendor profile.
 */
export default function MaterialHistory({
  purchases,
  stockUnit,
}: {
  purchases: MaterialPurchaseEntry[];
  stockUnit: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () => purchases.filter((p) => within(p.date, from, to)),
    [purchases, from, to],
  );

  const { totalQty, totalAmount, byVendor } = useMemo(() => {
    let qty = 0;
    let amount = 0;
    const groups = new Map<
      string,
      { vendorId: string | null; vendor: string; rows: MaterialPurchaseEntry[]; qty: number; amount: number }
    >();
    for (const p of filtered) {
      qty += p.qty;
      amount += p.qty * p.unitPrice;
      const key = p.vendorId ?? "unknown";
      const g =
        groups.get(key) ??
        { vendorId: p.vendorId, vendor: p.vendor, rows: [], qty: 0, amount: 0 };
      g.rows.push(p);
      g.qty += p.qty;
      g.amount += p.qty * p.unitPrice;
      groups.set(key, g);
    }
    return {
      totalQty: qty,
      totalAmount: amount,
      byVendor: [...groups.values()].sort((a, b) => b.amount - a.amount),
    };
  }, [filtered]);

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">Purchase history</h2>
        <DateRangePresets
          value={{ from, to }}
          onChange={(r) => {
            setFrom(r.from);
            setTo(r.to);
          }}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-[#e6e0d3] bg-white px-4 py-2.5">
          <span className="text-neutral-500">Bought in range </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {totalQty.toLocaleString()} {stockUnit}
          </span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-white px-4 py-2.5">
          <span className="text-neutral-500">Spend in range </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {inr(totalAmount)}
          </span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-white px-4 py-2.5">
          <span className="text-neutral-500">Vendors </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {byVendor.length}
          </span>
        </div>
      </div>

      {byVendor.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-neutral-500">
          No purchases in this range.
        </p>
      ) : (
        <div className="space-y-5">
          {byVendor.map((g) => {
            // Latest by BUSINESS date — rows are entry-ordered, but backdated
            // bills are routine, so the newest entry isn't always the latest bill.
            const last = g.rows.reduce((best, p) => (p.date > best.date ? p : best), g.rows[0]);
            return (
              <div
                key={g.vendorId ?? "unknown"}
                className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e6e0d3] px-4 py-2.5">
                  {g.vendorId ? (
                    <Link
                      href={`/dashboard/admin/procurement/vendors/${g.vendorId}`}
                      className="text-sm font-semibold text-indigo-700 transition hover:text-indigo-500"
                    >
                      {g.vendor}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-neutral-700">
                      {g.vendor}
                    </span>
                  )}
                  <span className="text-xs text-neutral-500">
                    Last: {formatDate(last.date)} @ {inr(last.unitPrice)} ·{" "}
                    <span className="tabular-nums">
                      {g.qty.toLocaleString()} {stockUnit}
                    </span>{" "}
                    · <span className="font-semibold text-neutral-700">{inr(g.amount)}</span>
                  </span>
                </div>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Rate</th>
                      <th className="px-4 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((p) => (
                      <tr key={p.id} className="border-t border-[#f0ebe0]">
                        <td className="px-4 py-2 text-neutral-700">{formatDate(p.date)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                          {p.qty} {stockUnit}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                          {inr(p.unitPrice)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900">
                          {inr(p.qty * p.unitPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
