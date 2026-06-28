"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

interface LegendItem {
  label: string;
  color: string;
  line?: boolean;
}

export interface ScatterCardProps {
  title: string;
  subtitle?: string;
  hasData: boolean;
  legend?: LegendItem[];
  emptyMessage?: string;
  delay?: number;
  onExpand?: () => void;
  children: ReactNode;
}

/** Glass wrapper for scatter charts (e.g. recipe margin vs sales volume). */
export default function ScatterCard({
  title,
  subtitle,
  hasData,
  legend,
  emptyMessage = "Map POS items to recipes to plot margins.",
  delay = 0,
  onExpand,
  children,
}: ScatterCardProps) {
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

        <div className="flex items-center gap-4">
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
                        : "h-2.5 w-2.5 rounded-full"
                    }
                    style={{ background: item.color }}
                  />
                  {item.label}
                </li>
              ))}
            </ul>
          )}

          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              aria-label="Expand chart"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] text-neutral-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          )}
        </div>
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
              <path d="M3 3v18h18" />
              <circle cx="8" cy="14" r="1.4" />
              <circle cx="13" cy="9" r="1.4" />
              <circle cx="17" cy="12" r="1.4" />
            </svg>
          </div>
          <p className="text-sm font-medium text-neutral-700">No data yet</p>
          <p className="mt-1 max-w-xs text-xs text-neutral-500">
            {emptyMessage}
          </p>
        </div>
      )}
    </motion.section>
  );
}
