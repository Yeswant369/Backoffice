"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ICON_BADGE, SUBTITLE_TONE, type SubtitleTone } from "./accents";

const ease = [0.22, 1, 0.36, 1] as const;

export type KpiTone = "default" | "positive" | "danger";

export interface KpiCardProps {
  /** Uppercase eyebrow label, e.g. "Theoretical Stock Value". */
  label: string;
  /** Pre-formatted big number, e.g. "₹4.2L" or "312 SKUs". */
  value: string;
  /** Contextual caption under the number, e.g. "18% over revenue". */
  subtitle?: string;
  /** Color intent for the subtitle only. */
  subtitleTone?: SubtitleTone;
  /** Icon node (e.g. an inline <svg> or lucide icon) shown in the badge. */
  icon: ReactNode;
  /** Overall card tone — drives badge + value emphasis. */
  tone?: KpiTone;
  /** Stagger index for entrance animation. */
  delay?: number;
}

const VALUE_TONE: Record<KpiTone, string> = {
  default: "text-neutral-900",
  positive: "text-emerald-700",
  danger: "text-red-700",
};

const BADGE_FOR_TONE: Record<KpiTone, keyof typeof ICON_BADGE> = {
  default: "default",
  positive: "positive",
  danger: "danger",
};

/** Premium KPI tile with indigo icon badge, big number and contextual subtitle. */
export default function KpiCard({
  label,
  value,
  subtitle,
  subtitleTone = "neutral",
  icon,
  tone = "default",
  delay = 0,
}: KpiCardProps) {
  const ring =
    tone === "danger"
      ? "border-red-200 bg-red-50"
      : "border-[#e6e0d3] bg-[#f7f3ec]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay }}
      className={`group relative overflow-hidden rounded-lg border ${ring} p-5 transition hover:border-[#d9d1c1]`}
    >
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-500">
          {label}
        </p>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            ICON_BADGE[BADGE_FOR_TONE[tone]]
          }`}
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center">
            {icon}
          </span>
        </span>
      </div>

      <p
        className={`relative mt-3 text-3xl font-semibold tracking-tight tabular-nums ${VALUE_TONE[tone]}`}
      >
        {value}
      </p>

      {subtitle && (
        <p
          className={`relative mt-1.5 text-xs font-medium ${SUBTITLE_TONE[subtitleTone]}`}
        >
          {subtitle}
        </p>
      )}
    </motion.div>
  );
}
