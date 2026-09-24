import { cn } from "@/lib/cn";

export function StatTile({ label, value, sub, icon, accent = "navy", className }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  accent?: "navy" | "green" | "gold" | "red" | "ocean";
  className?: string;
}) {
  const a = {
    navy: "bg-navy-900/5 text-navy-800",
    green: "bg-kenya-green-50 text-kenya-green",
    gold: "bg-gold-50 text-[#7a5f0c]",
    red: "bg-red-50 text-kenya-red",
    ocean: "bg-ocean-50 text-ocean",
  }[accent];
  return (
    <div className={cn("animate-fade-up rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,31,58,.04)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn("grid size-9 place-items-center rounded-xl", a)}>{icon}</span>
      </div>
      <p className="mt-2 font-display text-[30px] leading-none font-bold tracking-tight text-navy-900 tabular-nums">{value}</p>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </div>
  );
}
