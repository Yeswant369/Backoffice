"use client";

import { useMemo } from "react";
import type { DateRange } from "@/lib/date-range";

/**
 * Reusable date filter: quick relative presets (Today / Yesterday / Last 7·30·90
 * days / This month / This year) followed by a custom range at the end.
 * Controlled — the parent owns {from,to} and decides how to apply it (local
 * state or URL). All presets are computed in IST.
 */
export default function DateRangePresets({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const { presets, today } = useMemo(() => {
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
    const shift = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return fmt(d);
    };
    const t = fmt(new Date());
    const [y, m] = t.split("-");
    return {
      today: t,
      presets: [
        { key: "today", label: "Today", from: t, to: t },
        { key: "yst", label: "Yesterday", from: shift(1), to: shift(1) },
        { key: "7d", label: "Last 7 days", from: shift(7), to: t },
        { key: "30d", label: "Last 30 days", from: shift(30), to: t },
        { key: "90d", label: "Last 90 days", from: shift(90), to: t },
        { key: "month", label: "This month", from: `${y}-${m}-01`, to: t },
        { key: "year", label: "This year", from: `${y}-01-01`, to: t },
      ],
    };
  }, []);

  const activeKey = presets.find(
    (p) => p.from === value.from && p.to === value.to,
  )?.key;

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      active
        ? "bg-neutral-900 text-white"
        : "bg-[#efe9dd] text-neutral-600 hover:bg-[#e6e0d3] hover:text-neutral-900"
    }`;
  const inputCls =
    "rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange({ from: p.from, to: p.to })}
          className={chip(activeKey === p.key)}
        >
          {p.label}
        </button>
      ))}

      <span className="mx-1 hidden h-5 w-px bg-[#e6e0d3] sm:block" />

      <span className="text-xs text-neutral-500">Custom</span>
      <input
        type="date"
        aria-label="From date"
        value={value.from}
        max={value.to || today}
        onChange={(e) => onChange({ from: e.target.value, to: value.to })}
        className={inputCls}
      />
      <span className="text-xs text-neutral-400">→</span>
      <input
        type="date"
        aria-label="To date"
        value={value.to}
        min={value.from}
        max={today}
        onChange={(e) => onChange({ from: value.from, to: e.target.value })}
        className={inputCls}
      />
    </div>
  );
}
