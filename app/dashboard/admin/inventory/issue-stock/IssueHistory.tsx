"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { inr, formatDate } from "@/lib/format";
import DateRangePresets from "../../../_components/DateRangePresets";

export interface IssueEntry {
  id: string;
  /** Business date (issue date, else IST entry day) — YYYY-MM-DD. */
  date: string;
  materialId: string | null;
  material: string;
  unit: string;
  fromId: number | null;
  toId: number | null;
  qty: number;
}

const within = (date: string, from: string, to: string) => {
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

/**
 * Issue history: date-range filter → count + issued-value chips → one row per
 * ledger line (transfer or kitchen issue). Value uses the material's CURRENT
 * weighted average cost — a valuation of the movement, not a booked price.
 */
export default function IssueHistory({
  entries,
  deptNames,
  wac,
}: {
  entries: IssueEntry[];
  /** {department id → name} for resolving from/to columns. */
  deptNames: Record<number, string>;
  /** {raw_material_id → weighted average cost}; omit to hide the value chip. */
  wac?: Record<string, number>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () => entries.filter((e) => within(e.date, from, to)),
    [entries, from, to],
  );

  const totalValue = useMemo(() => {
    if (!wac) return null;
    return filtered.reduce(
      (s, e) => s + e.qty * (e.materialId ? (wac[e.materialId] ?? 0) : 0),
      0,
    );
  }, [filtered, wac]);

  const dept = (id: number | null) =>
    id != null ? (deptNames[id] ?? `Dept ${id}`) : "—";

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">Issue history</h2>
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
          <span className="text-neutral-500">Lines in range </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {filtered.length}
          </span>
        </div>
        {totalValue !== null && (
          <div className="rounded-lg border border-[#e6e0d3] bg-white px-4 py-2.5">
            <span className="text-neutral-500">Issued value (range) </span>
            <span className="font-semibold tabular-nums text-neutral-900">
              {inr(totalValue)}
            </span>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-neutral-500">
          No issues in this range.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Material</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-[#f0ebe0]">
                  <td className="px-4 py-2 text-neutral-700">{formatDate(e.date)}</td>
                  <td className="px-4 py-2 text-neutral-700">
                    {e.materialId ? (
                      <Link
                        href={`/dashboard/admin/materials/${e.materialId}`}
                        className="text-indigo-700 transition hover:text-indigo-500"
                      >
                        {e.material}
                      </Link>
                    ) : (
                      e.material
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-700">{dept(e.fromId)}</td>
                  <td className="px-4 py-2 text-neutral-700">{dept(e.toId)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">
                    {e.qty} {e.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
