"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { inr, formatDate } from "@/lib/format";
import DateRangePresets from "../../../../_components/DateRangePresets";

const ease = [0.22, 1, 0.36, 1] as const;

export interface PurchaseEntry {
  id: string;
  date: string;
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
}

const within = (date: string, from: string, to: string) => {
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

export default function VendorHistoryTabs({ purchases, payments }: Props) {
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
            <Table
              empty={filteredPurchases.length === 0}
              head={["Date", "Material", "Qty", "Unit price", "Total"]}
            >
              {filteredPurchases.map((p) => (
                <tr key={p.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 text-neutral-700">{formatDate(p.date)}</td>
                  <td className="px-5 py-2.5 text-neutral-700">{p.material}</td>
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
