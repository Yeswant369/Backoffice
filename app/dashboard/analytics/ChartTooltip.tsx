"use client";

import { inr } from "@/lib/format";

interface TooltipEntry {
  name?: string;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
  stroke?: string;
}

interface Props {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  showTotal?: boolean;
}

/** Glassmorphic dark-mode tooltip shared by both charts. */
export default function ChartTooltip({
  active,
  payload,
  label,
  showTotal = false,
}: Props) {
  if (!active || !payload || payload.length === 0) return null;

  const total = payload.reduce((sum, p) => sum + Number(p.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-3.5 py-2.5 shadow-2xl shadow-black/60">
      {label && (
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-600">
          {label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((p) => (
          <div
            key={String(p.dataKey)}
            className="flex items-center justify-between gap-6 text-sm"
          >
            <span className="flex items-center gap-2 text-neutral-700">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: p.color ?? p.stroke ?? "#fff" }}
              />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums text-neutral-900">
              {inr(p.value)}
            </span>
          </div>
        ))}
        {showTotal && (
          <div className="mt-1.5 flex items-center justify-between gap-6 border-t border-[#e6e0d3] pt-1.5 text-sm">
            <span className="text-neutral-600">Total</span>
            <span className="font-semibold tabular-nums text-neutral-900">
              {inr(total)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
