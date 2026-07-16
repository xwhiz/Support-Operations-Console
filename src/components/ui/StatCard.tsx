import { ArrowDown, ArrowUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Trend = {
  value: string;
  direction: "up" | "down";
  /** Whether this direction is a good thing (green) or bad (red). */
  positive?: boolean;
};

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  hint,
  children,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: Trend;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const positive = trend?.positive ?? trend?.direction === "up";
  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-white p-5 shadow-xs",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-600">{label}</p>
        {Icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200">
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="tnum text-3xl font-semibold tracking-tight text-gray-900">
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
              positive
                ? "bg-success-50 text-success-700"
                : "bg-error-50 text-error-700",
            )}
          >
            {trend.direction === "up" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )}
            {trend.value}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
