import { cn } from "@/lib/cn";

export type Tone =
  | "gray"
  | "brand"
  | "success"
  | "warning"
  | "error"
  | "info";

const TONE: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700 ring-gray-200",
  brand: "bg-brand-100 text-brand-800 ring-brand-200",
  success: "bg-success-50 text-success-700 ring-success-100",
  warning: "bg-warning-50 text-warning-700 ring-warning-100",
  error: "bg-error-50 text-error-700 ring-error-100",
  info: "bg-info-50 text-info-700 ring-info-100",
};

const DOT: Record<Tone, string> = {
  gray: "bg-gray-500",
  brand: "bg-brand-600",
  success: "bg-success-500",
  warning: "bg-warning-500",
  error: "bg-error-500",
  info: "bg-info-500",
};

export function Badge({
  tone = "gray",
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} />
      )}
      {children}
    </span>
  );
}
