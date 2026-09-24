"use client";

import { CountUp, Ring } from "@/components/ui/Motion";
import { pctLabel } from "@/features/targets/status";
import { num } from "@/lib/format";
import type { Breakdown } from "@/lib/types";

/** The county headline: how many people are captured, against what, and how fast. */
export function CountyBand({ county }: { county: Breakdown["county"] }) {
  const stats: [string, React.ReactNode, React.ReactNode][] = [
    ["Verified", num(county.verified), <span key="v">{pctLabel(county.captured ? (county.verified / county.captured) * 100 : null)} of captured</span>],
    ["Supporters", num(county.supporters), <span key="s">declared support</span>],
    ["Today", `+${num(county.today)}`, <span key="t">new captures</span>],
    ["This week", num(county.week), <WeekDelta key="w" now={county.week} before={county.prev_week} />],
    ["Wards visited", `${county.visited_wards}/${county.wards}`, <span key="vw">{num(county.visits_done)} visits done</span>],
    ["Polling stations", num(county.stations), <span key="ps">across {county.wards} wards</span>],
  ];
  return (
    <section className="relative overflow-hidden rounded-3xl bg-navy-950 text-white shadow-[0_20px_50px_-24px_rgba(6,16,31,.7)]">
      {/* Kenyan flag rule */}
      <div aria-hidden className="flex h-1.5">
        <span className="flex-[3] bg-kenya-black" /><span className="w-1 bg-white" /><span className="flex-[3] bg-kenya-red" />
        <span className="w-1 bg-white" /><span className="flex-[3] bg-kenya-green" />
      </div>
      <div className="pointer-events-none absolute -top-24 right-10 size-72 rounded-full bg-kenya-green/20 blur-3xl" />
      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="flex items-center gap-5">
          <Ring percent={county.percent ?? 0} size={112} stroke={10}>
            <span className="font-display text-xl font-bold">{pctLabel(county.percent)}</span>
          </Ring>
          <div>
            <p className="text-xs font-semibold tracking-[.18em] text-gold uppercase">Mombasa County</p>
            <p className="mt-1 font-display text-4xl font-bold tabular-nums"><CountUp value={county.captured} /></p>
            <p className="text-sm text-slate-300">people captured of <b className="text-white">{num(county.target)}</b> target</p>
            <p className="mt-1 text-sm text-slate-400">Still to reach: <b className="text-white">{num(county.gap)}</b></p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map(([k, v, foot]) => (
            <div key={k} className="rounded-2xl border border-white/[.08] bg-white/[.04] px-4 py-3">
              <dt className="text-xs font-medium text-slate-400">{k}</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{v}</dd>
              <dd className="text-xs text-slate-400">{foot}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Week-on-week change in light tints that stay readable on the navy band. */
function WeekDelta({ now, before }: { now: number; before: number }) {
  const diff = now - before;
  if (!now && !before) return <span>no captures yet</span>;
  return <span className={diff >= 0 ? "font-semibold text-[#5fd39a]" : "font-semibold text-[#ff8a7a]"}>{diff >= 0 ? "▲ +" : "▼ −"}{num(Math.abs(diff))} vs last week</span>;
}
