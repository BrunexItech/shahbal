"use client";

import type { FeatureCollection } from "geojson";
import { useMemo } from "react";

import { buildGeometry } from "@/features/dashboard/components/command/geometry";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import type { LiveEvent } from "@/lib/live";
import type { AttentionAlert, Health, VisitedPlace } from "@/lib/types";

export type StageMode = "pace" | "visits";

/** Times visited, on the dark stage: dim → bright ocean. 0 = unlit with a red dashed edge. */
export const VISIT_GLOW: [number, string, string][] = [
  [1, "#1c5d78", "1"],
  [2, "#1f86ad", "2"],
  [3, "#3fb3de", "3–4"],
  [5, "#9ee3ff", "5+"],
];
const visitColor = (n: number) => [...VISIT_GLOW].reverse().find(([v]) => n >= v)?.[1] ?? null;

/** Status colours tuned for the dark stage; always paired with a label in the legend. */
export const HEALTH: Record<Health, { color: string; label: string }> = {
  on_track: { color: "#34c77b", label: "On track" },
  at_risk: { color: "#e3b53a", label: "At risk" },
  critical: { color: "#ff5a4a", label: "Critical" },
  unknown: { color: "#94a3b8", label: "No target" },
};

const W = 640;
const PULSE_MINUTES = 30;
const MAX_H = 460;

type Region = { name: string; status: Health; today: number };


/**
 * A live, stylised Mombasa: the six constituencies lit by how they're doing, the 30
 * wards etched inside, and a pulse wherever something happened in the last half hour.
 * Pure SVG (no map tiles), so it loads instantly and looks the same everywhere.
 */
const ATTENTION: Record<string, string> = { bad: "#ff5a4a", warn: "#e3b53a" };

export function MombasaPulse({ constituencies, wards, regions, events, mode = "pace", wardVisits, places = [], onWard, attention = [], activeAttention = -1 }: {
  constituencies: FeatureCollection;
  wards: FeatureCollection;
  regions: Region[];
  events: LiveEvent[];
  mode?: StageMode;
  /** Completed visits per ward name (visits mode). */
  wardVisits?: Map<string, number>;
  places?: VisitedPlace[];
  onWard?: (name: string) => void;
  /** Places that need action (ward / constituency alerts), with pulsing rings; the active one strongest. */
  attention?: AttentionAlert[];
  activeAttention?: number;
}) {
  const geo = useMemo(() => buildGeometry(constituencies, wards, W), [constituencies, wards]);

  const byName = new Map(regions.map((r) => [r.name, r]));
  // Attention: wards that need action get pulsing rings; a constituency alert lights up
  // its whole outline when selected (a ring would sit on top of its name).
  const spots = useMemo(() => {
    const out: { i: number; x: number; y: number; d: string; color: string; area: string }[] = [];
    attention.forEach((a, i) => {
      const color = ATTENTION[a.tone];
      const w = a.level === "ward" ? geo.wards.find((x) => x.name === a.area) : null;
      if (!color || !w) return;
      let [x, y] = w.c;
      for (let t = 0; t < 6 && out.some((q) => Math.hypot(q.x - x, q.y - y) < 30); t++) { x += 26 * Math.cos(t * 1.9); y += 26 * Math.sin(t * 1.9); }
      out.push({ i, x, y, d: w.d, color, area: a.area });
    });
    return out;
  }, [attention, geo]);
  const activeSpot = spots.find((s) => s.i === activeAttention);
  const activeAlert = attention[activeAttention];
  const activeArea = activeSpot?.d
    ?? (activeAlert?.level === "constituency" && ATTENTION[activeAlert.tone] ? geo.cons.find((c) => c.name === activeAlert.area)?.d : undefined);
  const activeColor = activeAlert ? ATTENTION[activeAlert.tone] : undefined;
  const wardAt = new Map(geo.wards.map((w) => [w.name, w.c]));
  const cutoff = Date.now() - PULSE_MINUTES * 60_000;
  const pulses = events
    .filter((e) => e.ward && wardAt.has(e.ward) && new Date(e.at).getTime() >= cutoff)
    .slice(0, 14)
    .map((e, i) => ({ id: e.id, at: wardAt.get(e.ward!)!, i, action: e.action }));

  return (
    <div>
      {/* Box keeps the map's aspect ratio but never taller than MAX_H, so labels stay aligned. */}
      <div className="relative mx-auto" style={{ width: `min(100%, ${Math.round((MAX_H * (W + 40)) / (geo.H + 40))}px)`, aspectRatio: `${W + 40} / ${geo.H + 40}` }}>
      <svg viewBox={`-20 -20 ${W + 40} ${geo.H + 40}`} className="absolute inset-0 h-full w-full" role="img"
        aria-label={`Map of Mombasa's constituencies: ${regions.map((r) => `${r.name} ${HEALTH[r.status].label}`).join(", ")}`}>
        <defs>
          <filter id="mp-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="mp-sweep" cx="0" cy="0" r="1">
            <stop offset="0" stopColor="#c9a227" stopOpacity=".22" />
            <stop offset="1" stopColor="#c9a227" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Radar rings + sweep centred on the island */}
        <g opacity=".5" transform={`translate(${W * 0.62} ${geo.H * 0.62})`}>
          {[90, 180, 270, 360].map((r) => <circle key={r} r={r} fill="none" stroke="#ffffff" strokeOpacity=".06" strokeDasharray="2 6" />)}
          <path className="radar-sweep" d="M0 0 L360 0 A360 360 0 0 0 311.8 -180 Z" fill="url(#mp-sweep)" />
        </g>

        {/* Constituencies: lit by status (pace) or outlined (visits) */}
        {geo.cons.map((c) => {
          const s = HEALTH[byName.get(c.name)?.status ?? "unknown"];
          return mode === "pace" ? (
            <g key={c.name}>
              <path d={c.d} fill={s.color} fillOpacity=".16" stroke={s.color} strokeOpacity=".9" strokeWidth="2" filter="url(#mp-glow)" />
              <path d={c.d} fill={s.color} fillOpacity=".1" />
            </g>
          ) : (
            <path key={c.name} d={c.d} fill="#ffffff" fillOpacity=".03" stroke="#ffffff" strokeOpacity=".5" strokeWidth="1.6" />
          );
        })}
        {/* Wards: etched (pace) or lit by times visited (visits); always clickable */}
        {geo.wards.map((w) => {
          const n = wardVisits?.get(w.name) ?? 0;
          const lit = mode === "visits" ? visitColor(n) : null;
          return (
            <path key={w.name} d={w.d} role={onWard ? "button" : undefined} tabIndex={onWard ? 0 : undefined}
              aria-label={onWard ? `${w.name}: ${mode === "visits" ? `visited ${n} times` : "open ward"}` : undefined}
              onClick={() => onWard?.(w.name)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onWard?.(w.name)}
              className={cn(onWard && "cursor-pointer outline-none transition-[fill-opacity] hover:[fill-opacity:.45] focus-visible:[fill-opacity:.45]")}
              fill={lit ?? "#ffffff"} fillOpacity={lit ? 0.7 : 0.001}
              stroke={mode === "visits" && !n ? "#ff5a4a" : "#ffffff"} strokeOpacity={mode === "visits" && !n ? 0.75 : 0.16}
              strokeWidth={mode === "visits" && !n ? 1.3 : 0.8} strokeDasharray={mode === "visits" && !n ? "4 3" : undefined}>
              <title>{w.name}</title>
            </path>
          );
        })}

        {/* Places the team has been (visits mode): size = times visited */}
        {mode === "visits" && places.map((p) => {
          const [x, y] = geo.pt([p.lng, p.lat]);
          return (
            <circle key={`${p.lat},${p.lng}`} cx={x} cy={y} r={4 + 2.5 * Math.sqrt(p.count)} className="pointer-events-none"
              fill={p.exact ? "#34c77b" : "#94a3b8"} stroke="#06101f" strokeWidth="1.5" />
          );
        })}

        {/* Needs attention: rings on the places that need action */}
        {activeArea && activeColor && <path d={activeArea} fill={activeColor} fillOpacity=".2" stroke={activeColor} strokeWidth="2.5" filter="url(#mp-glow)" className="pointer-events-none" />}
        {spots.map((s) => {
          const on = s.i === activeAttention;
          return (
            <g key={`att-${s.i}`} transform={`translate(${s.x} ${s.y})`} className="pointer-events-none">
              {[0, 0.9, 1.8].map((delay) => (
                <circle key={delay} r={on ? 13 : 8} className="radar-wave" fill={on ? `${s.color}18` : "none"} stroke={s.color} strokeWidth={on ? 2.4 : 1.5}
                  style={{ animationDelay: `${delay + s.i * 0.3}s`, opacity: on ? 1 : 0.6 }} />
              ))}
              <circle r={on ? 7.5 : 5} fill={s.color} stroke="#06101f" strokeWidth="2" filter="url(#mp-glow)" />
            </g>
          );
        })}

        {/* Activity pulses (last 30 minutes) */}
        {pulses.map((p) => (
          <g key={p.id} transform={`translate(${p.at[0]} ${p.at[1]})`} className="pointer-events-none">
            <circle r="8" className="map-ping" fill="#c9a227" fillOpacity=".25" stroke="#e3b53a" strokeWidth="2" style={{ animationDelay: `${(p.i % 6) * 0.4}s` }} />
            <circle r="6" fill="#fff4cc" stroke="#c9a227" strokeWidth="2.5" filter="url(#mp-glow)" />
          </g>
        ))}

      </svg>

      {/* Attention pins: number + the active place's name */}
      {spots.map((sp) => (
        <span key={`pin-${sp.i}`} aria-hidden className={cn("pointer-events-none absolute grid size-5 -translate-x-1/2 place-items-center rounded-full text-xs font-extrabold text-navy-950 ring-2 ring-[#06101f] transition",
          sp.i === activeAttention ? "z-10 scale-110 bg-white" : "bg-white/75")}
          style={{ left: `${((sp.x + 20) / (W + 40)) * 100}%`, top: `calc(${((sp.y + 20) / (geo.H + 40)) * 100}% - 24px)` }}>{sp.i + 1}</span>
      ))}
      {activeSpot && (
        <span className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-full bg-[#06101f]/90 px-2.5 py-1 text-xs font-bold tracking-wider whitespace-nowrap uppercase transition-all duration-500"
          style={{ left: `${((activeSpot.x + 20) / (W + 40)) * 100}%`, top: `calc(${((activeSpot.y + 20) / (geo.H + 40)) * 100}% + 14px)`, color: activeSpot.color, boxShadow: `0 0 0 1px ${activeSpot.color}88` }}>
          {activeSpot.area}
        </span>
      )}

      {/* Direct labels in HTML so they keep a readable size when the map shrinks on phones. */}
      {geo.cons.map((c) => {
        const r = byName.get(c.name);
        return (
          <div key={`${c.name}-l`} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center [text-shadow:0_1px_6px_#06101f,0_0_2px_#06101f]"
            style={{ left: `${((+c.label[0] + 20) / (W + 40)) * 100}%`, top: `${((+c.label[1] + 20) / (geo.H + 40)) * 100}%` }}>
            <p className="text-xs font-bold tracking-[.14em] whitespace-nowrap text-white sm:text-sm">{c.name.toUpperCase()}</p>
            {r && <p className="hidden text-xs whitespace-nowrap text-slate-300 sm:block">+{num(r.today)} today</p>}
          </div>
        );
      })}
      </div>

      {mode === "visits" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
          <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-[#ff5a4a]" />Not visited</span>
          {VISIT_GLOW.map(([v, c, l]) => (
            <span key={v} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: c }} />{l}×</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#34c77b]" />Place visited (size = times)</span>
        </div>
      ) : (
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
        {(["on_track", "at_risk", "critical"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: HEALTH[k].color }} />{HEALTH[k].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-gold bg-[#fff4cc]" />Activity, last {PULSE_MINUTES} min
          {pulses.length > 0 && <b className="text-white">· {pulses.length}</b>}
        </span>
      </div>
      )}
    </div>
  );
}
