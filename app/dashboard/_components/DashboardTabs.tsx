"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ACTIVE_TAB } from "./accents";

const ease = [0.22, 1, 0.36, 1] as const;

export interface DashboardTab {
  /** Stable id used as the active key. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional trailing count badge (e.g. open unmapped-sales count). */
  count?: number;
  /** Optional leading icon. */
  icon?: ReactNode;
}

export interface DashboardTabsProps {
  tabs: DashboardTab[];
  /** Currently active tab id. */
  active: string;
  onChange: (id: string) => void;
  /** Visual variant: underline (default) or filled pill. */
  variant?: "underline" | "pill";
  /** Unique id so multiple tab bars on one page don't share the layout anim. */
  layoutGroup?: string;
}

/** Horizontal tab bar with an animated indigo active indicator. */
export default function DashboardTabs({
  tabs,
  active,
  onChange,
  variant = "underline",
  layoutGroup = "dashboard-tabs",
}: DashboardTabsProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={
        variant === "pill"
          ? "inline-flex items-center gap-1 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-1"
          : "flex items-center gap-1 border-b border-[#e6e0d3]"
      }
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={
              variant === "pill"
                ? `relative z-10 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    isActive ? "text-neutral-900" : ACTIVE_TAB.inactiveText
                  }`
                : `relative inline-flex items-center gap-2 px-3.5 pb-3 pt-2 text-sm font-medium transition ${
                    isActive ? ACTIVE_TAB.text : ACTIVE_TAB.inactiveText
                  }`
            }
          >
            {/* Pill background indicator. */}
            {variant === "pill" && isActive && (
              <motion.span
                layoutId={`${layoutGroup}-pill`}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-lg bg-indigo-100 ring-1 ring-inset ring-indigo-200"
              />
            )}

            {tab.icon && (
              <span className="flex h-4 w-4 items-center justify-center">
                {tab.icon}
              </span>
            )}
            <span className="whitespace-nowrap">{tab.label}</span>
            {typeof tab.count === "number" && tab.count > 0 && (
              <span
                className={`ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  isActive
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-[#efe9dd] text-neutral-600"
                }`}
              >
                {tab.count}
              </span>
            )}

            {/* Underline indicator. */}
            {variant === "underline" && isActive && (
              <motion.span
                layoutId={`${layoutGroup}-underline`}
                transition={{ duration: 0.35, ease }}
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${ACTIVE_TAB.underline}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
