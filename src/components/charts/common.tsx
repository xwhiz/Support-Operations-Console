/** Categorical palette for multi-series / pie slices. */
export const CHART_COLORS = [
  "#B6CF34", // brand
  "#2E90FA", // info
  "#17B26A", // success
  "#F79009", // warning
  "#F04438", // error
  "#7A5AF8", // violet
  "#717680", // gray
];

/** Semantic colors so status charts read consistently with the badges. */
export const TONE_HEX = {
  gray: "#98A2B3",
  brand: "#B6CF34",
  success: "#17B26A",
  warning: "#F79009",
  error: "#F04438",
  info: "#2E90FA",
} as const;

export const AXIS = {
  tick: { fill: "#717680", fontSize: 12 },
  line: "#E9EAEB",
};

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

type TooltipEntry = {
  name?: string | number;
  value?: number | string;
  color?: string;
};

/** Shared white tooltip card. `valueFormatter` lets callers show $ etc. */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      {label !== undefined && (
        <p className="mb-1 text-xs font-medium text-gray-500">{label}</p>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color as string }}
            />
            <span className="text-gray-600">{entry.name}</span>
            <span className="tnum ml-auto font-semibold text-gray-900">
              {valueFormatter
                ? valueFormatter(Number(entry.value))
                : Number(entry.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
