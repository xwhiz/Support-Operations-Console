"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "./common";

export type DonutDatum = { name: string; value: number; color: string };

export function DonutChart({
  data,
  size = 220,
  centerLabel,
  valueFormatter,
}: {
  data: DonutDatum[];
  size?: number;
  centerLabel?: string;
  valueFormatter?: (value: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const hasData = total > 0;
  const slices = hasData ? data : [{ name: "No data", value: 1, color: "#E9EAEB" }];

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="100%"
              paddingAngle={hasData ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {hasData && (
              <Tooltip
                content={<ChartTooltip valueFormatter={valueFormatter} />}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-3xl font-semibold text-gray-900">
            {total.toLocaleString()}
          </span>
          {centerLabel && (
            <span className="text-xs text-gray-500">{centerLabel}</span>
          )}
        </div>
      </div>
      <ul className="w-full max-w-xs space-y-2.5 sm:w-auto">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2.5 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-gray-600">{d.name}</span>
            <span className="tnum ml-auto font-semibold text-gray-900">
              {valueFormatter ? valueFormatter(d.value) : d.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
