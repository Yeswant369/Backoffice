"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inrCompact } from "@/lib/format";
import ChartTooltip from "./ChartTooltip";

export interface RevenuePoint {
  dateLabel: string;
  dineIn: number;
  zomato: number;
  swiggy: number;
}

const axisTick = { fill: "#737373", fontSize: 11 };

// Monochrome stack: descending opacity per channel.
const DINE_IN = "rgba(0,0,0,0.82)";
const ZOMATO = "rgba(0,0,0,0.50)";
const SWIGGY = "rgba(0,0,0,0.32)";

export default function RevenueTrendChart({ data }: { data: RevenuePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fillDineIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={DINE_IN} stopOpacity={0.45} />
            <stop offset="100%" stopColor={DINE_IN} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="fillZomato" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ZOMATO} stopOpacity={0.4} />
            <stop offset="100%" stopColor={ZOMATO} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="fillSwiggy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SWIGGY} stopOpacity={0.4} />
            <stop offset="100%" stopColor={SWIGGY} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(0,0,0,0.07)" vertical={false} />
        <XAxis
          dataKey="dateLabel"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "rgba(0,0,0,0.10)" }}
          minTickGap={24}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => inrCompact(v)}
          width={56}
        />
        <Tooltip
          cursor={{ stroke: "rgba(0,0,0,0.15)" }}
          content={<ChartTooltip showTotal />}
        />
        <Area
          type="monotone"
          dataKey="dineIn"
          name="Dine-in"
          stackId="rev"
          stroke={DINE_IN}
          strokeWidth={1.5}
          fill="url(#fillDineIn)"
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="zomato"
          name="Zomato"
          stackId="rev"
          stroke={ZOMATO}
          strokeWidth={1.5}
          fill="url(#fillZomato)"
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="swiggy"
          name="Swiggy"
          stackId="rev"
          stroke={SWIGGY}
          strokeWidth={1.5}
          fill="url(#fillSwiggy)"
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
