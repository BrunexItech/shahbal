import type { AreaMetrics } from "@/lib/types";

/**
 * How an area is doing compared with the county as a whole: a pattern anyone can read
 * without knowing the targets. Always shown with its label, never colour alone.
 */
export type AreaStatus = "ahead" | "near" | "behind" | "none";

export const STATUS: Record<AreaStatus, { label: string; fill: string; chip: string; dot: string }> = {
  ahead: { label: "Ahead", fill: "#006b3f", chip: "bg-kenya-green-50 text-kenya-green ring-kenya-green/20", dot: "bg-kenya-green" },
  near: { label: "Near average", fill: "#c9a227", chip: "bg-gold-50 text-[#7a5f0c] ring-gold/30", dot: "bg-gold" },
  behind: { label: "Behind", fill: "#bb1e10", chip: "bg-red-50 text-kenya-red ring-kenya-red/20", dot: "bg-kenya-red" },
  none: { label: "No target", fill: "#94a3b8", chip: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
};

export function statusOf(a: Pick<AreaMetrics, "percent">, countyPercent: number | null): AreaStatus {
  if (a.percent == null) return "none";
  const avg = countyPercent ?? 0;
  if (a.percent >= avg) return "ahead";
  if (a.percent >= avg * 0.7) return "near";
  return "behind";
}

export const pctLabel = (p: number | null) => (p == null ? "—" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`);
