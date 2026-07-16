import { cn } from "@/lib/cn";

/** Soft, readable initials-avatar palettes (no external images). */
const PALETTE = [
  { bg: "#EAECF0", fg: "#414651" },
  { bg: "#ECF7A8", fg: "#667416" },
  { bg: "#D1E9FF", fg: "#175CD3" },
  { bg: "#DCFAE6", fg: "#067647" },
  { bg: "#FEF0C7", fg: "#B54708" },
  { bg: "#FEE4E2", fg: "#B42318" },
  { bg: "#E9D7FE", fg: "#6941C6" },
  { bg: "#C7D7FE", fg: "#3538CD" },
];

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  seed,
  size = 40,
  className,
}: {
  name: string | null | undefined;
  /** Stable key for color selection; falls back to name. */
  seed?: string;
  size?: number;
  className?: string;
}) {
  const label = name?.trim() || "Unknown";
  const color = PALETTE[hash(seed || label) % PALETTE.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-black/5",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color.bg,
        color: color.fg,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initialsFrom(label)}
    </span>
  );
}
