"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { inr, formatDate } from "@/lib/format";
import DateRangePresets from "../../../../_components/DateRangePresets";

const ease = [0.22, 1, 0.36, 1] as const;

export interface PurchaseEntry {
  id: string;
  date: string;
  materialId: string | null;
  material: string;
  unit: string;
  qty: number;
  unitPrice: number;
}
export interface PaymentEntry {
  id: string;
  date: string;
  amount: number;
  mode: string;
  reference: string | null;
}

interface Props {
  purchases: PurchaseEntry[];
  payments: PaymentEntry[];
  vendorId: string;
}

const within = (date: string, from: string, to: string) => {
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

export default function VendorHistoryTabs({ purchases, payments, vendorId }: Props) {
  const [tab, setTab] = useState<"purchases" | "payments">("purchases");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filteredPurchases = useMemo(
    () => purchases.filter((p) => within(p.date, from, to)),
    [purchases, from, to],
  );
  const filteredPayments = useMemo(
    () => payments.filter((p) => within(p.date, from, to)),
    [payments, from, to],
  );

  // Range totals + "what all was bought" (per-material aggregation).
  const purchaseTotal = useMemo(
    () => filteredPurchases.reduce((s, p) => s + p.qty * p.unitPrice, 0),
    [filteredPurchases],
  );
  const paymentTotal = useMemo(
    () => filteredPayments.reduce((s, p) => s + p.amount, 0),
    [filteredPayments],
  );
  const byMaterial = useMemo(() => {
    const m = new Map<
      string,
      { materialId: string | null; material: string; unit: string; qty: number; amount: number }
    >();
    for (const p of filteredPurchases) {
      const key = p.materialId ?? p.material;
      const g =
        m.get(key) ??
        { materialId: p.materialId, material: p.material, unit: p.unit, qty: 0, amount: 0 };
      g.qty += p.qty;
      g.amount += p.qty * p.unitPrice;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [filteredPurchases]);

  // Report downloads reuse the accounting export with a vendor filter; when the
  // local filter is unset, export everything (wide window).
  const istToday = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
    [],
  );
  const exportHref = (type: "purchases" | "payments") =>
    `/api/accounting/export?type=${type}&vendor=${vendorId}&from=${from || "2000-01-01"}&to=${to || istToday}`;

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-2">
      <div className="flex flex-wrap items-center justify-between gap-3 p-2">
        <div className="flex gap-1 rounded-lg bg-[#efe9dd] p-1">
          {(["purchases", "payments"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative rounded-lg px-4 py-2 text-sm font-medium capitalize transition ${
                  active ? "text-neutral-950" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="vendor-history-tab"
                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                    transition={{ duration: 0.3, ease }}
                  />
                )}
                <span className="relative z-10">{t} history</span>
              </button>
            );
          })}
        </div>
        <DateRangePresets
          value={{ from, to }}
          onChange={(r) => {
            setFrom(r.from);
            setTo(r.to);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 px-2 pb-2">
        <span className="rounded-lg border border-[#e6e0d3] bg-white px-3 py-1.5 text-sm">
          <span className="text-neutral-500">Bought in range </span>
          <span className="font-semibold tabular-nums text-neutral-900">{inr(purchaseTotal)}</span>
        </span>
        <span className="rounded-lg border border-[#e6e0d3] bg-white px-3 py-1.5 text-sm">
          <span className="text-neutral-500">Paid in range </span>
          <span className="font-semibold tabular-nums text-neutral-900">{inr(paymentTotal)}</span>
        </span>
        <span className="ml-auto flex gap-2">
          <a
            href={exportHref("purchases")}
            className="rounded-lg border border-[#d9d1c1] bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 transition hover:bg-[#f3eee3]"
          >
            ⤓ Purchases CSV
          </a>
          <a
            href={exportHref("payments")}
            className="rounded-lg border border-[#d9d1c1] bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 transition hover:bg-[#f3eee3]"
          >
            ⤓ Payments CSV
          </a>
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease }}
          className="p-2"
        >
          {tab === "purchases" ? (
            <>
              {byMaterial.length > 0 && (
                <div className="mb-3 overflow-hidden rounded-lg border border-[#e6e0d3] bg-white">
                  <div className="border-b border-[#e6e0d3] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    What was bought in this range
                  </div>
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {byMaterial.map((m) => (
                        <tr key={m.materialId ?? m.material} className="border-t border-[#f0ebe0]">
                          <td className="px-5 py-2">
                            {m.materialId ? (
                              <Link
                                href={`/dashboard/admin/materials/${m.materialId}`}
                                className="text-indigo-700 transition hover:text-indigo-500"
                              >
                                {m.material}
                              </Link>
                            ) : (
                              m.material
                            )}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums text-neutral-600">
                            {m.qty.toLocaleString()} {m.unit}
                          </td>
                          <td className="px-5 py-2 text-right font-semibold tabular-nums text-neutral-900">
                            {inr(m.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Table
                empty={filteredPurchases.length === 0}
                head={["Date", "Material", "Qty", "Unit price", "Total"]}
              >
              {filteredPurchases.map((p) => (
                <tr key={p.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 text-neutral-700">{formatDate(p.date)}</td>
                  <td className="px-5 py-2.5 text-neutral-700">
                    {p.materialId ? (
                      <Link
                        href={`/dashboard/admin/materials/${p.materialId}`}
                        className="text-indigo-700 transition hover:text-indigo-500"
                      >
                        {p.material}
                      </Link>
                    ) : (
                      p.material
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {p.qty} {p.unit}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {inr(p.unitPrice)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                    {inr(p.qty * p.unitPrice)}
                  </td>
                </tr>
              ))}
              </Table>
            </>
          ) : (
            <Table
              empty={filteredPayments.length === 0}
              head={["Date", "Mode", "Reference", "Amount"]}
            >
              {filteredPayments.map((p) => (
                <tr key={p.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 text-neutral-700">{formatDate(p.date)}</td>
                  <td className="px-5 py-2.5 text-neutral-700">{p.mode}</td>
                  <td className="px-5 py-2.5 text-neutral-500">{p.reference ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                    {inr(p.amount)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Table({
  head,
  empty,
  children,
}: {
  head: string[];
  empty: boolean;
  children: React.ReactNode;
}) {
  if (empty)
    return (
      <p className="px-5 py-8 text-center text-sm text-neutral-500">
        No entries in this range.
      </p>
    );
  return (
    <div className="overflow-hidden rounded-lg border border-[#e6e0d3]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-5 py-2.5 font-medium ${i >= head.length - (head.length > 3 ? 3 : 1) ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
