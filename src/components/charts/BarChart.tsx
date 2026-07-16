"use client";

import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartTooltip, formatCompact } from "./common";

export type BarDatum = { label: string; value: number; color?: string };

export function BarChart({
  data,
  height = 280,
  color = "#B6CF34",
  name = "Count",
  valueFormatter,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  name?: string;
  valueFormatter?: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={AXIS.line} />
        <XAxis
          dataKey="label"
          tick={AXIS.tick}
          tickLine={false}
          axisLine={{ stroke: AXIS.line }}
          interval="preserveStartEnd"
          minTickGap={12}
        />
        <YAxis
          tick={AXIS.tick}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          tickFormatter={formatCompact}
        />
        <Tooltip
          cursor={{ fill: "#F5F5F5" }}
          content={<ChartTooltip valueFormatter={valueFormatter} />}
        />
        <Bar dataKey="value" name={name} radius={[6, 6, 0, 0]} maxBarSize={44}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? color} />
          ))}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}
