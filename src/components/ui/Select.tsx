import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pr-10 pl-3.5 text-sm text-gray-900 shadow-xs focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </div>
  );
}
