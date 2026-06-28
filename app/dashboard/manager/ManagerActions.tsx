"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { inr, formatDate } from "@/lib/format";
import ReconciliationForm from "../admin/ReconciliationForm";
import PettyCashForm from "./PettyCashForm";
import SalesLogForm, { type RecipeLite } from "./SalesLogForm";

const ease = [0.22, 1, 0.36, 1] as const;

const TABS = [
  { key: "reconcile", label: "Daily Reconciliation" },
  { key: "petty", label: "Petty Cash" },
  { key: "sales", label: "Sales Log" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export interface ReconRow {
  id: string;
  date: string;
  gross: number;
  collected: number;
  deposit: number;
  variance: number;
}
export interface PettyRow {
  id: string;
  date: string;
  category: string;
  description: string | null;
  amount: number;
}
export interface SaleRow {
  id: string;
  date: string;
  recipe_name: string;
  qty: number;
  revenue: number;
}

interface Props {
  recipes: RecipeLite[];
  recentReconciliations: ReconRow[];
  recentPettyCash: PettyRow[];
  recentSales: SaleRow[];
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="mt-6">{children}</div>;
}

function TableShell({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
      <div className="border-b border-[#e6e0d3] px-5 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      {empty ? (
        <p className="px-5 py-8 text-center text-sm text-neutral-500">
          No entries yet.
        </p>
      ) : (
        <table className="w-full text-left text-sm">{children}</table>
      )}
    </div>
  );
}

export default function ManagerActions({
  recipes,
  recentReconciliations,
  recentPettyCash,
  recentSales,
}: Props) {
  const [tab, setTab] = useState<TabKey>("reconcile");

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-[#efe9dd] p-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
                active ? "text-neutral-950" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="manager-tab"
                  className="absolute inset-0 rounded-lg bg-white shadow-sm"
                  transition={{ duration: 0.3, ease }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease }}
          >
            {tab === "reconcile" && (
              <>
                <ReconciliationForm />
                <Panel>
                  <TableShell
                    title="Recent reconciliations"
                    empty={recentReconciliations.length === 0}
                  >
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                        <th className="px-5 py-2.5 font-medium">Date</th>
                        <th className="px-5 py-2.5 text-right font-medium">Gross</th>
                        <th className="px-5 py-2.5 text-right font-medium">Collected</th>
                        <th className="px-5 py-2.5 text-right font-medium">Deposit</th>
                        <th className="px-5 py-2.5 text-right font-medium">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentReconciliations.map((r) => (
                        <tr key={r.id} className="border-t border-[#e6e0d3]">
                          <td className="px-5 py-2.5 text-neutral-700">
                            {formatDate(r.date)}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                            {inr(r.gross)}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                            {inr(r.collected)}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                            {inr(r.deposit)}
                          </td>
                          <td
                            className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
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
                  </TableShell>
                </Panel>
              </>
            )}

            {tab === "petty" && (
              <>
                <PettyCashForm />
                <Panel>
                  <TableShell
                    title="Recent petty cash"
                    empty={recentPettyCash.length === 0}
                  >
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                        <th className="px-5 py-2.5 font-medium">Date</th>
                        <th className="px-5 py-2.5 font-medium">Category</th>
                        <th className="px-5 py-2.5 font-medium">Description</th>
                        <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPettyCash.map((p) => (
                        <tr key={p.id} className="border-t border-[#e6e0d3]">
                          <td className="px-5 py-2.5 text-neutral-700">
                            {formatDate(p.date)}
                          </td>
                          <td className="px-5 py-2.5 text-neutral-700">
                            {p.category}
                          </td>
                          <td className="px-5 py-2.5 text-neutral-500">
                            {p.description ?? "—"}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                            {inr(p.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </Panel>
              </>
            )}

            {tab === "sales" && (
              <>
                <SalesLogForm recipes={recipes} />
                <Panel>
                  <TableShell
                    title="Recent sales"
                    empty={recentSales.length === 0}
                  >
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                        <th className="px-5 py-2.5 font-medium">Date</th>
                        <th className="px-5 py-2.5 font-medium">Dish</th>
                        <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                        <th className="px-5 py-2.5 text-right font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentSales.map((s) => (
                        <tr key={s.id} className="border-t border-[#e6e0d3]">
                          <td className="px-5 py-2.5 text-neutral-700">
                            {formatDate(s.date)}
                          </td>
                          <td className="px-5 py-2.5 text-neutral-700">
                            {s.recipe_name}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                            {s.qty}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                            {inr(s.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </Panel>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
