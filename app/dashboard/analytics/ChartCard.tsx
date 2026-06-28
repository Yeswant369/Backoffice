"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

interface LegendItem {
  label: string;
  /** CSS color (or gradient) swatch. */
  color: string;
  /** Render the swatch as a line instead of a filled chip. */
  line?: boolean;
}

interface Props {
  title: string;
  subtitle?: string;
  hasData: boolean;
  legend?: LegendItem[];
  /** Message shown when there isn't enough data to plot. */
  emptyMessage?: string;
  delay?: number;
  children: ReactNode;
}

export default function ChartCard({
  title,
  subtitle,
  hasData,
  legend,
  emptyMessage = "Not enough data yet.",
  delay = 0,
  children,
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease, delay }}
      className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-6"
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
          )}
        </div>
        {hasData && legend && (
          <ul className="flex flex-wrap items-center gap-4">
            {legend.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-2 text-[11px] text-neutral-600"
              >
                <span
                  className={
                    item.line
                      ? "h-[2px] w-4 rounded-full"
                      : "h-2.5 w-2.5 rounded-[3px]"
                  }
                  style={{ background: item.color }}
                />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </header>

      {hasData ? (
        children
      ) : (
        <div className="flex h-[280px] flex-col items-center justify-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-[#d9d1c1] bg-[#efe9dd]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-neutral-500"
              aria-hidden
            >
              <path d="M3 3v18h18M7 15l4-4 3 2 5-6" />
            </svg>
          </div>
          <p className="text-sm font-medium text-neutral-700">
            Not enough data
          </p>
          <p className="mt-1 max-w-xs text-xs text-neutral-500">
            {emptyMessage}
          </p>
        </div>
      )}
    </motion.section>
  );
}
