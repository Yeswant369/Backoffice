"use client";

import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { inr } from "@/lib/format";

export type Quadrant = "star" | "plow" | "puzzle" | "dog";

export interface MenuPoint {
  recipeId: string;
  name: string;
  category: string;
  sellingPrice: number;
  cogs: number;
  marginValue: number;
  marginPct: number;
  volume: number;
  salesMixPct: number;
  quadrant: Quadrant;
}

const QUADRANT_LABEL: Record<Quadrant, string> = {
  star: "Star",
  plow: "Plow Horse",
  puzzle: "Puzzle",
  dog: "Dog",
};

const INDIGO = "#6366f1";
const INDIGO_LIGHT = "#a5b4fc";
const axisTick = { fill: "#737373", fontSize: 11 };

interface TipProps {
  active?: boolean;
  payload?: { payload?: MenuPoint }[];
}

function MenuTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-3.5 py-2.5 shadow-2xl shadow-black/60">
      <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <span className="h-2 w-2 rounded-full" style={{ background: INDIGO_LIGHT }} />
        {p.name}
      </p>
      <p className="mb-2 text-[11px] uppercase tracking-wider text-indigo-600/80">
        {QUADRANT_LABEL[p.quadrant]} · {p.category}
      </p>
      <Row label="Sales price" value={inr(p.sellingPrice)} />
      <Row label="Sales mix" value={`${p.salesMixPct.toFixed(1)}%`} />
      <Row label="Avg profit margin" value={inr(p.marginValue)} />
      <Row label="Margin %" value={`${p.marginPct.toFixed(1)}%`} />
      <Row label="Portions sold" value={String(p.volume)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 text-sm">
      <span className="text-neutral-600">{label}</span>
      <span className="font-semibold tabular-nums text-neutral-900">{value}</span>
    </div>
  );
}

export default function MenuEngineeringChart({
  points,
  medianVolume,
  medianMargin,
}: {
  points: MenuPoint[];
  medianVolume: number;
  medianMargin: number;
}) {
  const maxVol = Math.max(1, ...points.map((p) => p.volume)) * 1.1;
  // Keep ≥5% headroom above the top point so an all-negative-margin menu doesn't
  // pin its highest dot to the Y-axis top edge.
  const maxMargin = (Math.max(5, ...points.map((p) => p.marginPct)) + 5) * 1.05;
  const minMargin = Math.min(0, ...points.map((p) => p.marginPct)) * 1.1;

  return (
    <ResponsiveContainer width="100%" height={420}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="rgba(0,0,0,0.06)" />

        {/* Quadrant bands (drawn first, under the points) */}
        <ReferenceArea x1={medianVolume} x2={maxVol} y1={medianMargin} y2={maxMargin} fill="#6366f1" fillOpacity={0.08} stroke="none" />
        <ReferenceArea x1={medianVolume} x2={maxVol} y1={minMargin} y2={medianMargin} fill="#f59e0b" fillOpacity={0.06} stroke="none" />
        <ReferenceArea x1={0} x2={medianVolume} y1={medianMargin} y2={maxMargin} fill="#8b5cf6" fillOpacity={0.06} stroke="none" />
        <ReferenceArea x1={0} x2={medianVolume} y1={minMargin} y2={medianMargin} fill="#ef4444" fillOpacity={0.06} stroke="none" />

        <XAxis
          type="number"
          dataKey="volume"
          name="Portions sold"
          domain={[0, maxVol]}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "rgba(0,0,0,0.10)" }}
          label={{ value: "Popularity (portions sold)", position: "insideBottom", offset: -12, fill: "#737373", fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="marginPct"
          name="Margin %"
          domain={[minMargin, maxMargin]}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${Math.round(v)}%`}
          width={48}
          label={{ value: "Profit margin %", angle: -90, position: "insideLeft", fill: "#737373", fontSize: 11 }}
        />
        <ZAxis type="number" dataKey="salesMixPct" range={[60, 420]} />

        <ReferenceLine x={medianVolume} stroke="rgba(0,0,0,0.18)" strokeDasharray="4 4" />
        <ReferenceLine y={medianMargin} stroke="rgba(0,0,0,0.18)" strokeDasharray="4 4" />

        <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "rgba(0,0,0,0.15)" }} content={<MenuTooltip />} />

        <Scatter
          data={points}
          fill={INDIGO}
          fillOpacity={0.55}
          stroke={INDIGO_LIGHT}
          strokeWidth={1}
          animationDuration={800}
          animationEasing="ease-out"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
