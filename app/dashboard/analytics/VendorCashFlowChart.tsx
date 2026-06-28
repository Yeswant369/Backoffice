"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inrCompact } from "@/lib/format";
import ChartTooltip from "./ChartTooltip";

export interface CashFlowPoint {
  monthLabel: string;
  purchased: number;
  paid: number;
  outstanding: number;
}

const PURCHASED = "rgba(0,0,0,0.75)";
const PAID = "rgba(0,0,0,0.30)";
const OUTSTANDING = "#4f46e5"; // indigo-600 — distinct accent line over the mono bars

const axisTick = { fill: "#737373", fontSize: 11 };

export default function VendorCashFlowChart({
  data,
}: {
  data: CashFlowPoint[];
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="rgba(0,0,0,0.07)" vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: "rgba(0,0,0,0.10)" }}
        />
        <YAxis
          yAxisId="left"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => inrCompact(v)}
          width={56}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => inrCompact(v)}
          width={56}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.05)" }}
          content={<ChartTooltip />}
        />
        <Bar
          yAxisId="left"
          dataKey="purchased"
          name="Total Purchased"
          fill={PURCHASED}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          animationDuration={900}
          animationEasing="ease-out"
        />
        <Bar
          yAxisId="left"
          dataKey="paid"
          name="Total Paid"
          fill={PAID}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          animationDuration={900}
          animationEasing="ease-out"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="outstanding"
          name="Cumulative Outstanding"
          stroke={OUTSTANDING}
          strokeWidth={2}
          dot={{ r: 3, fill: OUTSTANDING, stroke: "#ffffff", strokeWidth: 1.5 }}
          activeDot={{ r: 5, fill: OUTSTANDING, stroke: "#ffffff" }}
          animationDuration={1100}
          animationEasing="ease-out"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
