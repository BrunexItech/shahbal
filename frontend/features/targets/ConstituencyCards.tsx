"use client";

import { Ring } from "@/components/ui/Motion";
import { CONSTITUENCY_COLORS, CONSTITUENCY_DEEP } from "@/features/map/regions";
import { STATUS, pctLabel, statusOf } from "@/features/targets/status";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import type { ConstituencyBreakdown } from "@/lib/types";

/**
 * Constituency cards: a header in the constituency's own colour, a progress ring, the
 * numbers that matter, and a "ward skyline" — one bar per ward, height = % of its
 * target, colour = ahead / near / behind the county. The pattern reads at a glance.
 */
export function ConstituencyCards({ rows, countyPercent, selected, onSelect }: {
  rows: ConstituencyBreakdown[];
  countyPercent: number | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const maxWardPct = Math.max(1, ...rows.flatMap((c) => c.wards.map((w) => w.percent ?? 0)));
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((c, i) => {
        const color = CONSTITUENCY_COLORS[c.name] ?? "#64748b";
        const deep = CONSTITUENCY_DEEP[c.name] ?? "#334155";
        const active = selected === c.id;
        const st = statusOf(c, countyPercent);
        return (
          <button key={c.id} onClick={() => onSelect(active ? null : c.id)} aria-pressed={active}
            style={{ animationDelay: `${i * 60}ms`, ...(active ? { boxShadow: `0 0 0 3px ${color}, 0 24px 48px -26px ${deep}` } : {}) }}
            className="group relative min-w-0 animate-fade-up overflow-hidden rounded-3xl bg-white text-left ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-28px_rgba(11,31,58,.55)]">
            {/* Header in the constituency colour */}
            <div className="relative overflow-hidden px-5 pt-4 pb-5 text-white" style={{ background: `linear-gradient(135deg, ${deep} 0%, ${color} 130%)` }}>
              <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.12] [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:14px_14px]" />
              <span aria-hidden className="pointer-events-none absolute -right-3 -bottom-6 font-display text-8xl leading-none font-black text-white/10 select-none">{c.code}</span>
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[.18em] text-white/70 uppercase">Constituency {c.code}</p>
                  <h3 className="truncate font-display text-2xl font-extrabold">{c.name}</h3>
                </div>
                <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold ring-1 ring-white/25 backdrop-blur">
                  <span className={cn("mr-1.5 inline-block size-2 rounded-full", STATUS[st].dot)} />{STATUS[st].label}
                </span>
              </div>
            </div>

            {/* Numbers */}
            <div className="flex items-center gap-4 px-5 pt-4">
              <Ring percent={c.percent ?? 0} size={84} stroke={9} color={color} track="#eef2f6">
                <span className="font-display text-base font-extrabold text-navy-900 tabular-nums">{pctLabel(c.percent)}</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <p className="font-display text-3xl leading-none font-extrabold text-navy-900 tabular-nums">{num(c.captured)}</p>
                <p className="mt-1 text-sm text-slate-500">captured of <b className="text-navy-900">{num(c.target)}</b></p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-navy-900 tabular-nums">+{num(c.today)} today</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-navy-900 tabular-nums">{num(c.week)} this week</span>
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-kenya-red tabular-nums">gap {num(c.gap)}</span>
                </div>
              </div>
            </div>

            {/* Ward skyline */}
            <div className="px-5 pt-4 pb-5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold tracking-wider uppercase">Wards</span>
                <span>{c.visited_wards}/{c.wards.length} visited · {c.stations} stations</span>
              </div>
              <div className="mt-2 flex h-16 items-end gap-1.5 rounded-xl bg-slate-50 px-2 pt-2 ring-1 ring-line" aria-label={`Ward progress in ${c.name}`}>
                {c.wards.map((w) => {
                  const ws = statusOf(w, countyPercent);
                  const h = Math.max(6, ((w.percent ?? 0) / maxWardPct) * 100);
                  return (
                    <span key={w.id} className="group/bar relative flex h-full flex-1 items-end" title={`${w.name}: ${num(w.captured)} of ${num(w.target)} (${pctLabel(w.percent)}) · ${STATUS[ws].label}`}>
                      <span className="w-full rounded-t-md transition-[height] duration-700" style={{ height: `${h}%`, background: STATUS[ws].fill }} />
                    </span>
                  );
                })}
              </div>
              <div className="mt-1 flex gap-1.5 px-2">
                {c.wards.map((w) => <span key={w.id} className="flex-1 truncate text-center text-xs text-slate-500" title={w.name}>{w.name.split(/[ /]/)[0].slice(0, 6)}</span>)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
