"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { inr } from "@/lib/format";

const ease = [0.22, 1, 0.36, 1] as const;

const UNCATEGORISED = "Uncategorised";

export interface LiveStockRow {
  raw_material_id: string;
  raw_material_name: string;
  category: string | null;
  stock_unit: string;
  par_level: number;
  department_id: number;
  department_name: string;
  current_stock: number;
}

interface Entity {
  id: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  par: number;
  total: number;
  /** undefined = no purchase yet (no WAC) — rendered "—", excluded from value. */
  rate: number | undefined;
  value: number;
  belowPar: boolean;
  byDept: { department: string; qty: number }[];
}

/** Display-round a stock quantity (cross-dept float sums can drift). */
const qty = (v: number) => Number(v.toFixed(3)).toLocaleString();

export default function LiveStockMatrix({
  rows,
  codeMap,
  rateMap,
}: {
  rows: LiveStockRow[];
  codeMap: Record<string, string>;
  rateMap: Record<string, number>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("All");

  const entities = useMemo<Entity[]>(() => {
    const map = new Map<string, Entity>();
    for (const r of rows) {
      const e =
        map.get(r.raw_material_id) ??
        ({
          id: r.raw_material_id,
          name: r.raw_material_name,
          code: codeMap[r.raw_material_id] ?? "—",
          category: r.category ?? UNCATEGORISED,
          unit: r.stock_unit,
          par: Number(r.par_level),
          total: 0,
          rate: rateMap[r.raw_material_id],
          value: 0,
          belowPar: false,
          byDept: [],
        } satisfies Entity);
      e.total += Number(r.current_stock);
      e.byDept.push({
        department: r.department_name,
        qty: Number(r.current_stock),
      });
      map.set(r.raw_material_id, e);
    }
    const list = [...map.values()];
    for (const e of list) {
      e.belowPar = e.total < e.par;
      e.value = e.rate !== undefined ? e.total * e.rate : 0;
      e.byDept.sort((a, b) => a.department.localeCompare(b.department));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, codeMap, rateMap]);

  const categories = useMemo(
    () => ["All", ...[...new Set(entities.map((e) => e.category))].sort((a, b) => a.localeCompare(b))],
    [entities],
  );

  const visible = useMemo(() => {
    const inTab = tab === "All" ? entities : entities.filter((e) => e.category === tab);
    const q = query.trim().toLowerCase();
    return q
      ? inTab.filter(
          (e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q),
        )
      : inTab;
  }, [entities, tab, query]);

  const totalValue = useMemo(
    () => visible.reduce((sum, e) => sum + e.value, 0),
    [visible],
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e0d3] px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-900">
          Hand Stock Matrix
          <span className="ml-2 text-neutral-500">{entities.length}</span>
        </h2>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500">
            {tab === "All" && !query.trim() ? "Total stock value" : "Stock value (shown)"}
          </p>
          <p className="text-lg font-bold tabular-nums text-neutral-900">
            {inr(totalValue)}
            <span className="ml-2 text-xs font-normal text-neutral-500">
              {visible.length} material{visible.length === 1 ? "" : "s"} shown
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e0d3] px-5 py-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-[#efe9dd] p-1">
          {categories.map((c) => {
            const active = tab === c;
            return (
              <button
                key={c}
                onClick={() => setTab(c)}
                className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active ? "text-neutral-950" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="live-stock-category-tab"
                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                    transition={{ duration: 0.3, ease }}
                  />
                )}
                <span className="relative z-10">{c}</span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search material…"
          className="w-64 max-w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-1.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
        />
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-neutral-500">
          No stock on hand yet.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="w-10 py-3 pl-4" />
              <th className="px-3 py-3 font-medium">Code</th>
              <th className="px-3 py-3 font-medium">Material</th>
              <th className="px-3 py-3 text-right font-medium">Total stock</th>
              <th className="px-3 py-3 text-right font-medium">Rate</th>
              <th className="px-3 py-3 text-right font-medium">Value</th>
              <th className="px-3 py-3 text-right font-medium">Par</th>
              <th className="px-5 py-3 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const isOpen = open.has(e.id);
              return (
                <Fragment key={e.id}>
                  <tr
                    onClick={() => toggle(e.id)}
                    className="cursor-pointer border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                  >
                    <td className="py-3 pl-4">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-4 w-4 text-neutral-500 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-neutral-600">
                      {e.code}
                    </td>
                    <td className="px-3 py-3 font-medium">
                      <Link
                        href={`/dashboard/admin/materials/${e.id}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-indigo-700 transition hover:text-indigo-500"
                      >
                        {e.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {qty(e.total)} {e.unit}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-600">
                      {e.rate !== undefined ? <>{inr(e.rate)}/{e.unit}</> : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {e.rate !== undefined ? inr(e.value) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-600">
                      {e.par} {e.unit}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {e.belowPar ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Low Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-neutral-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-neutral-600" />
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={8} className="p-0">
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease }}
                            className="overflow-hidden"
                          >
                            <div className="grid gap-2 px-12 py-3 sm:grid-cols-2 lg:grid-cols-3">
                              {e.byDept.map((d) => (
                                <div
                                  key={d.department}
                                  className="flex items-center justify-between rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2"
                                >
                                  <span className="text-xs text-neutral-600">
                                    {d.department}
                                  </span>
                                  <span className="text-sm font-medium tabular-nums text-neutral-900">
                                    {d.qty} {e.unit}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
