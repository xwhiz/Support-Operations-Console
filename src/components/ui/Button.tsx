import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "ghost"
  | "success"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-gray-900 text-white shadow-xs hover:bg-gray-950 focus-visible:outline-gray-900",
  brand:
    "bg-brand-400 text-gray-900 shadow-xs hover:bg-brand-500 focus-visible:outline-brand-600",
  secondary:
    "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 shadow-xs hover:bg-gray-50",
  ghost: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
  success:
    "bg-success-600 text-white shadow-xs hover:bg-success-700 focus-visible:outline-success-600",
  danger:
    "bg-error-600 text-white shadow-xs hover:bg-error-700 focus-visible:outline-error-600",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

/** Shared class string, so a <Link> can be styled as a button too. */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      {...props}
    />
  );
}
