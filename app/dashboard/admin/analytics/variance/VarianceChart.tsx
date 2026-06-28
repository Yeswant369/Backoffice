"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inr } from "@/lib/format";
import { CHART } from "@/app/dashboard/_components/accents";

export interface CategoryCost {
  category: string;
  theoretical: number;
  actual: number;
}

const axisTick = { fill: CHART.axisTick, fontSize: 11 };
const inrCompact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
};

interface TipProps {
  active?: boolean;
  label?: string;
  payload?: { name?: string; value?: number; color?: string }[];
}

function VarianceTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const theo = payload.find((p) => p.name === "Theoretical")?.value ?? 0;
  const act = payload.find((p) => p.name === "Actual")?.value ?? 0;
  const variance = act - theo;
  return (
    <div className="rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-3.5 py-2.5 shadow-2xl shadow-black/60">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-600">
        {label}
      </p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6 text-sm">
          <span className="flex items-center gap-2 text-neutral-700">
            <span className="h-2 w-2 rounded-[3px]" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold tabular-nums text-neutral-900">{inr(p.value)}</span>
        </div>
      ))}
      <div className="mt-1.5 flex items-center justify-between gap-6 border-t border-[#e6e0d3] pt-1.5 text-sm">
        <span className="text-neutral-600">Variance</span>
        <span
          className={`font-semibold tabular-nums ${variance < 0 ? "text-red-600" : "text-emerald-600"}`}
        >
          {inr(variance)}
        </span>
      </div>
    </div>
  );
}

export default function VarianceChart({ data }: { data: CategoryCost[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 56)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
        barGap={4}
      >
        <CartesianGrid stroke={CHART.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "rgba(0,0,0,0.10)" }}
          tickFormatter={inrCompact}
        />
        <YAxis
          type="category"
          dataKey="category"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.05)" }} content={<VarianceTooltip />} />
        <Bar
          dataKey="theoretical"
          name="Theoretical"
          fill={CHART.theoretical}
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          animationDuration={800}
          animationEasing="ease-out"
        />
        <Bar
          dataKey="actual"
          name="Actual"
          fill={CHART.actual}
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          animationDuration={900}
          animationEasing="ease-out"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
