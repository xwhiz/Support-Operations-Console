"use client";

import { useId } from "react";
import {
  Area,
  AreaChart as RAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartTooltip, formatCompact } from "./common";

export type AreaDatum = { label: string; value: number };

export function AreaChart({
  data,
  height = 280,
  stroke = "#8BA01F",
  fill = "#CEEA50",
  name = "Value",
  valueFormatter,
}: {
  data: AreaDatum[];
  height?: number;
  stroke?: string;
  fill?: string;
  name?: string;
  valueFormatter?: (value: number) => string;
}) {
  const gid = "area-" + useId().replace(/:/g, "");
  const lastIndex = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RAreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={0.35} />
            <stop offset="100%" stopColor={fill} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={AXIS.line} />
        <XAxis
          dataKey="label"
          tick={AXIS.tick}
          tickLine={false}
          axisLine={{ stroke: AXIS.line }}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          tick={AXIS.tick}
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          tickFormatter={formatCompact}
        />
        <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gid})`}
          isAnimationActive={false}
          dot={(props: { cx?: number; cy?: number; index?: number }) => {
            const { cx, cy, index } = props;
            if (index !== lastIndex || cx == null || cy == null)
              return <g key={index} />;
            return (
              <circle
                key={index}
                cx={cx}
                cy={cy}
                r={4}
                fill={stroke}
                stroke="#fff"
                strokeWidth={2}
              />
            );
          }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
        />
      </RAreaChart>
    </ResponsiveContainer>
  );
}
