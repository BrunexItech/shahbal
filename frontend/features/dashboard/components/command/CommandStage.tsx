"use client";

import { Skeleton } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { CountUp, LiveDot } from "@/components/ui/Motion";
import { AreaDrawer } from "@/features/dashboard/components/command/AreaDrawer";
import { MombasaPulse, type StageMode } from "@/features/dashboard/components/command/MombasaPulse";
import { PaceGauge } from "@/features/dashboard/components/command/PaceGauge";
import { useBoundaries, useConstituencyOutlines, useMapOverview } from "@/features/map/api";
import { useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { CANDIDATE_NAME } from "@/lib/config";
import { num } from "@/lib/format";
import type { LiveEvent, Pulse } from "@/lib/live";
import type { DashboardSummary } from "@/lib/types";

/**
 * The Command Centre stage: are we winning (gauge + verdict), how fast (pace vs
 * required), how long is left (countdown), and where it's happening (live map).
 */
export function CommandStage({ d, pulse, events, connected, activeAttention = -1 }: {
  d: DashboardSummary; pulse: Pulse | null; events: LiveEvent[]; connected: boolean; activeAttention?: number;
}) {
  const i = d.insights;
  const o = d.overall;
  const wards = useBoundaries();
  const cons = useConstituencyOutlines();
  const overview = useMapOverview();
  const [mode, setMode] = useState<StageMode>("pace");
  const [ward, setWard] = useState<string | null>(null);
  const ov = overview.data;
  const wardVisits = useMemo(() => new Map((ov?.wards ?? []).map((w) => [w.name, w.visits_completed])), [ov]);
  const visited = ov?.wards.filter((w) => w.visits_completed > 0).length ?? 0;
  const coverage: [string, string][] = [
    ["Visits done", num(ov?.wards.reduce((a, w) => a + w.visits_completed, 0) ?? 0)],
    ["Places", num(ov?.places.length ?? 0)],
    ["Wards visited", `${visited}/${ov?.wards.length ?? 30}`],
    ["Never visited", num((ov?.wards.length ?? 0) - visited)],
  ];
  const projectedPct = i.projected != null && o.target ? (i.projected / o.target) * 100 : null;
  const onTrack = projectedPct != null && projectedPct >= 100;
  const verdict = !o.target
    ? "Set ward targets to start the mission"
    : i.days_left == null
      ? `${num(o.achieved)} supporters reached`
      : onTrack ? "On course to hit the county target" : "Behind target: the pace must rise";

  const live: [string, number, string][] = [
    ["Captured today", pulse?.captures_today ?? d.totals.today, "#ffffff"],
    ["In the field now", pulse?.online_field ?? 0, "#34c77b"],
    ["Calls today", pulse?.calls_today ?? d.ops.calls_today, "#bb1e10"],
    ["Marked voted", pulse?.voted ?? d.ops.voted, "#c9a227"],
  ];

  return (
    <section id="command-stage" className="relative scroll-mt-24 overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-[0_30px_60px_-30px_rgba(6,16,31,.7)]">
      <FlagStripe />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_0%_0%,rgba(11,127,166,.32),transparent_45%),radial-gradient(ellipse_at_100%_100%,rgba(0,107,63,.28),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[.045] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative grid gap-6 p-5 sm:p-7 xl:grid-cols-[380px_minmax(0,1fr)] xl:gap-10">
        {/* Left: the mission in numbers */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-[.2em] text-gold uppercase">{CANDIDATE_NAME} · Mombasa</p>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><LiveDot on={connected} className="size-2" />{connected ? "Live" : "Reconnecting"}</span>
          </div>
          <h2 className={cn("mt-2 text-2xl leading-tight font-extrabold", onTrack ? "text-[#7ee2b0]" : "text-white")}>{verdict}</h2>

          <div className="mt-5"><PaceGauge percent={o.percent ?? 0} projectedPercent={projectedPct} /></div>

          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-white/[.05] px-2 py-3 ring-1 ring-white/[.08]">
              <p className="font-display text-2xl font-bold tabular-nums">{i.days_left ?? "—"}</p>
              <p className="text-xs text-slate-400">days to vote</p>
            </div>
            <div className="rounded-2xl bg-white/[.05] px-2 py-3 ring-1 ring-white/[.08]">
              <p className="font-display text-2xl font-bold tabular-nums">{num(Math.round(i.pace))}</p>
              <p className="text-xs text-slate-400">per day now</p>
            </div>
            <div className={cn("rounded-2xl px-2 py-3 ring-1", onTrack || i.required_pace == null ? "bg-white/[.05] ring-white/[.08]" : "bg-kenya-red/20 ring-kenya-red/40")}>
              <p className="font-display text-2xl font-bold tabular-nums">{i.required_pace != null ? num(i.required_pace) : "—"}</p>
              <p className="text-xs text-slate-400">per day needed</p>
            </div>
          </div>
          {i.days_left == null && <p className="mt-2 text-xs text-slate-400">Set the election date under Election Day to see the countdown and required pace.</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {live.map(([k, v, c]) => (
              <div key={k} className="relative overflow-hidden rounded-2xl bg-white/[.04] px-3.5 pt-3.5 pb-3 ring-1 ring-white/[.08]">
                <span className="absolute inset-x-3.5 top-0 h-[3px] rounded-b-full" style={{ background: c }} />
                <p className="font-display text-2xl font-bold tabular-nums"><CountUp value={v} /></p>
                <p className="text-xs text-slate-400">{k}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: live Mombasa */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[.2em] text-slate-400 uppercase">Live across Mombasa</p>
              <p className="text-sm text-slate-300">
                {mode === "pace" ? "Each constituency lit by its pace to target. Gold pulses show new activity." : "Wards lit by how often the team has been. Tap a ward for streets and photos."}
              </p>
            </div>
            <div role="tablist" aria-label="Map view" className="inline-flex rounded-xl bg-white/[.06] p-1 ring-1 ring-white/10">
              {([["pace", "Pace"], ["visits", "Visits"]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                  className={cn("rounded-lg px-3.5 py-1.5 text-sm font-semibold transition", mode === k ? "bg-gold text-navy-950" : "text-slate-300 hover:text-white")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {wards.data && cons.data ? (
            <MombasaPulse constituencies={cons.data} wards={wards.data} events={events} mode={mode} wardVisits={wardVisits}
              places={ov?.places ?? []} onWard={setWard} attention={i.alerts ?? []} activeAttention={activeAttention}
              regions={i.constituencies.map((c) => ({ name: c.name, status: c.status, today: c.today }))} />
          ) : (
            <Skeleton className="aspect-[4/3] w-full rounded-2xl bg-white/5" />
          )}
          {mode === "visits" && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {coverage.map(([k, v], n) => (
                <div key={k} className={cn("rounded-2xl px-3.5 py-3 ring-1", n === 3 && visited < (ov?.wards.length ?? 0) ? "bg-kenya-red/15 ring-kenya-red/35" : "bg-white/[.04] ring-white/[.08]")}>
                  <p className="font-display text-2xl font-bold tabular-nums">{v}</p>
                  <p className="text-xs text-slate-400">{k}</p>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
      {ward && <AreaDrawer wardName={ward} onClose={() => setWard(null)} />}
    </section>
  );
}
