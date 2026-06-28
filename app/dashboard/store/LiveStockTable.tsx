"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LiveStockRow } from "./types";

const ease = [0.22, 1, 0.36, 1] as const;

export default function LiveStockTable({
  stock,
  live,
}: {
  stock: LiveStockRow[];
  /** Whether the realtime channel is connected. */
  live: boolean;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? stock.filter(
          (s) =>
            s.raw_material_name.toLowerCase().includes(q) ||
            (s.category ?? "").toLowerCase().includes(q) ||
            s.department_name.toLowerCase().includes(q),
        )
      : stock;
    return [...filtered].sort(
      (a, b) =>
        a.raw_material_name.localeCompare(b.raw_material_name) ||
        a.department_name.localeCompare(b.department_name),
    );
  }, [stock, query]);

  return (
    <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e0d3] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-neutral-900">Live Stock</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              live
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : "border-[#e6e0d3] bg-[#f7f3ec] text-neutral-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live ? "animate-pulse bg-emerald-400" : "bg-neutral-600"
              }`}
            />
            {live ? "Live" : "Connecting"}
          </span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search material, category, department…"
          className="w-64 max-w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-1.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
        />
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-neutral-500">
          {stock.length === 0
            ? "No stock movements yet. Record a purchase to get started."
            : "No items match your search."}
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-5 py-3 font-medium">Material</th>
              <th className="px-5 py-3 font-medium">Department</th>
              <th className="px-5 py-3 text-right font-medium">In stock</th>
              <th className="px-5 py-3 text-right font-medium">Par</th>
              <th className="px-5 py-3 text-right font-medium">Status</th>
            </tr>
          </thead>
          <motion.tbody layout>
            <AnimatePresence initial={false}>
              {rows.map((row) => (
                <motion.tr
                  key={`${row.raw_material_id}-${row.department_id}`}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease }}
                  className="border-t border-[#e6e0d3]"
                >
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-neutral-900">
                      {row.raw_material_name}
                    </div>
                    {row.category && (
                      <div className="text-[11px] text-neutral-500">
                        {row.category}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {row.department_name}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <motion.span
                      key={row.current_stock}
                      initial={{ color: "rgb(110 231 183)" }}
                      animate={{ color: "rgb(255 255 255)" }}
                      transition={{ duration: 1.2 }}
                      className="font-semibold tabular-nums"
                    >
                      {row.current_stock}
                    </motion.span>{" "}
                    <span className="text-xs text-neutral-500">
                      {row.stock_unit}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {row.par_level}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {row.below_par ? (
                      <span className="inline-flex items-center gap-1.5 text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Below par
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-neutral-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-600" />
                        OK
                      </span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </motion.tbody>
        </table>
      )}
    </div>
  );
}
