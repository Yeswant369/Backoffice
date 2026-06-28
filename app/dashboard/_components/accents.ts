/**
 * Indigo accent tokens for the light enterprise theme.
 *
 * The base system is now light — white canvas (#ffffff) with warm beige surfaces
 * (#f7f3ec) and hairline borders (#e6e0d3). Indigo is reserved for active states,
 * primary actions and chart series so the accent reads as intentional.
 *
 * Tailwind class strings are co-located so every surface uses the same indigo.
 * Chart colors are raw hex because recharts takes fill/stroke props.
 */

/** Active horizontal-tab styling (text + framer-motion underline color). */
export const ACTIVE_TAB = {
  /** Text + weight applied to the active tab label. */
  text: "text-neutral-900",
  /** Text applied to inactive tab labels. */
  inactiveText: "text-neutral-500 hover:text-neutral-800",
  /** The sliding underline (framer-motion layoutId target). */
  underline: "bg-indigo-600",
  /** Optional pill background variant for the active tab. */
  pill: "bg-indigo-100 text-indigo-700 ring-1 ring-inset ring-indigo-200",
} as const;

/** Primary call-to-action button — solid indigo on the light base. */
export const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg " +
  "bg-indigo-600 px-4 py-2.5 " +
  "text-sm font-semibold text-white shadow-sm transition " +
  "hover:bg-indigo-500 active:bg-indigo-700 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/** Secondary / ghost button — white surface with a crisp warm hairline border. */
export const GHOST_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg " +
  "border border-[#d9d1c1] bg-white px-4 py-2.5 " +
  "text-sm font-medium text-neutral-700 transition " +
  "hover:border-[#cdc4b1] hover:bg-[#f7f3ec] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50";

/** KPI icon badge, keyed by tone — soft tints on the light base. */
export const ICON_BADGE = {
  default: "bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200",
  danger: "bg-red-50 text-red-600 ring-1 ring-inset ring-red-200",
  positive: "bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200",
} as const;

/** Subtitle text tones for contextual KPI captions (light base). */
export const SUBTITLE_TONE = {
  neutral: "text-neutral-500",
  positive: "text-emerald-600",
  negative: "text-red-600",
  accent: "text-indigo-600",
} as const;

/**
 * Raw hex for recharts series across Epic 2 (Theoretical vs Actual variance)
 * and Epic 3 (margin scatter). Series are slightly deepened for legibility on
 * the white canvas; grid/axis flipped to dark hairlines.
 */
export const CHART = {
  /** Theoretical / system stock. indigo-500 */
  theoretical: "#6366f1",
  /** Actual counted stock. violet-500 (deepened for white bg) */
  actual: "#8b5cf6",
  /** Profit / favourable variance. emerald-500 */
  profit: "#10b981",
  /** Loss / shrinkage. red-500 */
  loss: "#ef4444",
  /** Neutral monochrome series. */
  neutral: "rgba(0,0,0,0.30)",
  /** Grid + axis hairlines on the light base. */
  grid: "rgba(0,0,0,0.07)",
  axisTick: "#6b7280",
  /** Dot stroke on the white base. */
  base: "#ffffff",
} as const;

export type SubtitleTone = keyof typeof SUBTITLE_TONE;
export type IconBadgeTone = keyof typeof ICON_BADGE;
