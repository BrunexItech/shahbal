"use client";

import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { STATUS, pctLabel, statusOf } from "@/features/targets/status";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import type { ConstituencyBreakdown } from "@/lib/types";

/**
 * One card per constituency, each in its own map colour so it reads the same here,
 * on the regions map and in GeoLibre. The strip of squares is one per ward, coloured
 * by how that ward compares with the county: the pattern inside each constituency at a glance.
 */
export function ConstituencyCards({ rows, countyPercent, selected, onSelect }: {
  rows: ConstituencyBreakdown[];
  countyPercent: number | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((c, i) => {
        const color = CONSTITUENCY_COLORS[c.name] ?? "#64748b";
        const active = selected === c.id;
        const st = statusOf(c, countyPercent);
        return (
          <button key={c.id} onClick={() => onSelect(active ? null : c.id)} aria-pressed={active}
            style={{ animationDelay: `${i * 50}ms`, ...(active ? { boxShadow: `0 0 0 2px ${color}, 0 18px 40px -22px ${color}` } : {}) }}
            className={cn("group relative min-w-0 animate-fade-up overflow-hidden rounded-2xl border bg-white text-left transition hover:-translate-y-0.5 hover:shadow-lg",
              active ? "border-transparent" : "border-line")}>
            <span aria-hidden className="block h-1.5" style={{ background: color }} />
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[.16em] text-slate-500 uppercase">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: color }} /> IEBC {c.code}
                  </p>
                  <h3 className="truncate font-display text-xl font-bold text-navy-900">{c.name}</h3>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", STATUS[st].chip)}>{STATUS[st].label}</span>
              </div>

              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="font-display text-3xl font-bold text-navy-900 tabular-nums">{num(c.captured)}
                  <span className="ml-1.5 text-sm font-medium text-slate-500">of {num(c.target)}</span></p>
                <p className="font-display text-2xl font-bold text-navy-900 tabular-nums">{pctLabel(c.percent)}</p>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(c.percent ?? 0, 100)}%`, background: color }} />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {([["Today", `+${num(c.today)}`], ["This week", num(c.week)], ["Gap", num(c.gap)]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 px-2 py-2">
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd className="font-semibold text-navy-900 tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{c.wards.length} wards · {c.visited_wards} visited</span>
                  <span>{c.stations} stations</span>
                </div>
                <div className="mt-1.5 flex gap-1" aria-label={`Ward status in ${c.name}`}>
                  {c.wards.map((w) => {
                    const ws = statusOf(w, countyPercent);
                    return <span key={w.id} title={`${w.name}: ${pctLabel(w.percent)} (${STATUS[ws].label})`} className={cn("h-2.5 flex-1 rounded-sm", STATUS[ws].dot)} />;
                  })}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
