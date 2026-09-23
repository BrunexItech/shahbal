import { cn } from "@/lib/cn";

/** Colour communicates health at a glance: red < 40%, gold < 75%, green beyond. */
export function progressTone(percent: number | null) {
  if (percent == null) return "bg-slate-300";
  if (percent < 40) return "bg-kenya-red";
  if (percent < 75) return "bg-gold";
  return "bg-kenya-green";
}

export function ProgressBar({ percent, className, thin }: { percent: number | null; className?: string; thin?: boolean }) {
  const w = Math.min(percent ?? 0, 100);
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-slate-100", thin ? "h-1.5" : "h-2.5", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", progressTone(percent))} style={{ width: `${w}%` }} />
    </div>
  );
}
