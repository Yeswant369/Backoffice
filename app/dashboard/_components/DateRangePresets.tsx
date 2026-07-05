"use client";

import { useMemo } from "react";
import type { DateRange } from "@/lib/date-range";

/**
 * Reusable date filter: a dropdown of quick relative presets (Today / Yesterday
 * / Last 7·30·90 days / This month / This year / Custom) followed by a custom
 * range picker at the end. Editing the custom dates flips the dropdown to
 * "Custom". Controlled — the parent owns {from,to}. Presets computed in IST.
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

  const activeKey =
    presets.find((p) => p.from === value.from && p.to === value.to)?.key ??
    "custom";

  const controlCls =
    "rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <select
          aria-label="Date range preset"
          value={activeKey}
          onChange={(e) => {
            const p = presets.find((x) => x.key === e.target.value);
            if (p) onChange({ from: p.from, to: p.to });
          }}
          className={`${controlCls} appearance-none pr-8 font-medium`}
        >
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom range</option>
        </select>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <span className="mx-1 hidden h-5 w-px bg-[#e6e0d3] sm:block" />

      <input
        type="date"
        aria-label="From date"
        value={value.from}
        max={value.to || today}
        onChange={(e) => onChange({ from: e.target.value, to: value.to })}
        className={controlCls}
      />
      <span className="text-xs text-neutral-400">→</span>
      <input
        type="date"
        aria-label="To date"
        value={value.to}
        min={value.from}
        max={today}
        onChange={(e) => onChange({ from: value.from, to: e.target.value })}
        className={controlCls}
      />
    </div>
  );
}
