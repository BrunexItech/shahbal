"use client";

import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import type { Insights } from "@/lib/types";

const STATUS = {
  on_track: { label: "On track", chip: "bg-kenya-green-50 text-kenya-green ring-kenya-green/20" },
  at_risk: { label: "At risk", chip: "bg-gold-50 text-[#7a5f0c] ring-gold/30" },
  critical: { label: "Critical", chip: "bg-red-50 text-kenya-red ring-kenya-red/20" },
  unknown: { label: "No target", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
} as const;

const pctText = (p: number | null) => (p == null ? "—" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`);

/**
 * The race to target: one lane per constituency. The runner is where it is now; the
 * hollow marker is where today's pace carries it by election day; the chequered line
 * is the target. Reads in two seconds: who is out front, who won't finish.
 */
export function RaceLanes({ rows }: { rows: Insights["constituencies"] }) {
  const lanes = [...rows].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  return (
    <div className="px-5 pt-2 pb-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full bg-navy-900 ring-2 ring-white" /> Reached now</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-dashed border-navy-900" /> Where today's pace ends up</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1.5 [background:repeating-linear-gradient(#0b1f3a_0_3px,#fff_3px_6px)]" /> Target</span>
      </div>
      <ol className="space-y-4">
        {lanes.map((c, i) => {
          const color = CONSTITUENCY_COLORS[c.name] ?? "#64748b";
          const now = Math.min(c.percent ?? 0, 100);
          const proj = c.projected_percent == null ? null : Math.min(c.projected_percent, 100);
          const st = STATUS[c.status];
          return (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs font-semibold text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate font-semibold text-navy-900">{c.name}</span>
              </div>
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                {/* Track */}
                <div className="relative h-9 rounded-full bg-[repeating-linear-gradient(90deg,#f1f5f9_0_24.8%,#e2e8f0_24.8%_25%)] ring-1 ring-line">
                  <div className="absolute inset-y-0 left-0 rounded-full opacity-25 transition-[width] duration-1000" style={{ width: `${now}%`, background: color }} />
                  {proj != null && proj > now && (
                    <div className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-navy-900/60 bg-white"
                      style={{ left: `clamp(12px, ${proj}%, calc(100% - 22px))` }} title={`On pace for ${pctText(c.projected_percent)} by election day`} />
                  )}
                  <div className="runner absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-bold text-white ring-2 ring-white transition-[left] duration-1000"
                    style={{ left: `clamp(16px, ${now}%, calc(100% - 26px))`, background: color, ["--glow" as string]: `${color}66` }}>
                    {Math.round(c.percent ?? 0)}
                  </div>
                  <div className="absolute inset-y-1 right-1.5 w-1.5 rounded-sm [background:repeating-linear-gradient(#0b1f3a_0_4px,#fff_4px_8px)]" />
                </div>
              </div>
              <div className="flex items-center gap-2 text-right">
                <span className="hidden text-xs text-slate-500 tabular-nums lg:inline">{num(c.achieved)} / {num(c.target)} · +{num(c.today)} today</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1", st.chip)}>{st.label}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
