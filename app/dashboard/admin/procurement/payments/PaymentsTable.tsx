"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { inr, formatDate } from "@/lib/format";
import DateRangePresets from "@/app/dashboard/_components/DateRangePresets";

export interface PaymentRow {
  id: string;
  date: string;
  amount: number;
  mode: string;
  reference: string | null;
  vendorId: string | null;
  vendor: string;
  code: string;
}

const within = (date: string, from: string, to: string) => {
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

export default function PaymentsTable({
  rows,
  totalCount,
}: {
  rows: PaymentRow[];
  totalCount: number;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () => rows.filter((p) => within(p.date, from, to)),
    [rows, from, to],
  );

  const paidTotal = useMemo(
    () => filtered.reduce((s, p) => s + p.amount, 0),
    [filtered],
  );

  // Mode breakdown for the filtered range (e.g. UPI / Cash / Bank).
  const byMode = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtered) m.set(p.mode, (m.get(p.mode) ?? 0) + p.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // CSV download reuses the accounting export; when the local filter is unset,
  // export everything (wide window). Today is an IST calendar day — never bare
  // Date.now().
  const istToday = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const exportHref = `/api/accounting/export?type=payments&from=${from || "2000-01-01"}&to=${to || istToday}`;

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-2">
      <div className="flex flex-wrap items-center justify-between gap-3 p-2">
        <DateRangePresets
          value={{ from, to }}
          onChange={(r) => {
            setFrom(r.from);
            setTo(r.to);
          }}
        />
        <a
          href={exportHref}
          className="rounded-lg border border-[#d9d1c1] bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 transition hover:bg-[#f3eee3]"
        >
          ⤓ Export CSV (Excel)
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-2 pb-2">
        <span className="rounded-lg border border-[#e6e0d3] bg-white px-3 py-1.5 text-sm">
          <span className="text-neutral-500">Paid in range </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {inr(paidTotal)}
          </span>
        </span>
        {byMode.map(([mode, amount]) => (
          <span
            key={mode}
            className="rounded-lg border border-[#e6e0d3] bg-white px-3 py-1.5 text-sm"
          >
            <span className="text-neutral-500">{mode} </span>
            <span className="font-semibold tabular-nums text-neutral-900">
              {inr(amount)}
            </span>
          </span>
        ))}
      </div>

      {totalCount > rows.length && (
        <p className="mx-2 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          Showing the newest {rows.length} of {totalCount} payments — range
          totals above cover only these rows.
        </p>
      )}

      <div className="p-2">
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No payments in this range.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Vendor</th>
                  <th className="px-5 py-2.5 font-medium">Code</th>
                  <th className="px-5 py-2.5 font-medium">Mode</th>
                  <th className="px-5 py-2.5 font-medium">Reference</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-2.5 text-neutral-700">
                      {formatDate(p.date)}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-700">
                      {p.vendorId ? (
                        <Link
                          href={`/dashboard/admin/procurement/vendors/${p.vendorId}`}
                          className="text-indigo-700 transition hover:text-indigo-500"
                        >
                          {p.vendor}
                        </Link>
                      ) : (
                        p.vendor
                      )}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-neutral-600">
                      {p.code}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-700">{p.mode}</td>
                    <td className="px-5 py-2.5 text-neutral-500">
                      {p.reference ?? "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                      {inr(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
