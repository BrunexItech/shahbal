"use client";

import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { useMemo } from "react";

import { num } from "@/lib/format";
import type { LiveEvent } from "@/lib/live";
import type { Health } from "@/lib/types";

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

function polys(f: Feature): Position[][][] {
  const g = f.geometry as Polygon | MultiPolygon;
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/**
 * A live, stylised Mombasa: the six constituencies lit by how they're doing, the 30
 * wards etched inside, and a pulse wherever something happened in the last half hour.
 * Pure SVG (no map tiles), so it loads instantly and looks the same everywhere.
 */
export function MombasaPulse({ constituencies, wards, regions, events }: {
  constituencies: FeatureCollection;
  wards: FeatureCollection;
  regions: Region[];
  events: LiveEvent[];
}) {
  const geo = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of constituencies.features) for (const p of polys(f)) for (const [x, y] of p[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180); // equirectangular, true to shape at this latitude
    const scale = W / ((maxX - minX) * k);
    const H = Math.round((maxY - minY) * scale);
    const pt = ([x, y]: Position) => [((x - minX) * k * scale).toFixed(1), ((maxY - y) * scale).toFixed(1)] as const;
    const path = (f: Feature) => polys(f).map((p) => p.map((ring) => `M${ring.map((c) => pt(c).join(",")).join("L")}Z`).join("")).join("");
    const centre = (f: Feature): [number, number] => {
      const ring = [...polys(f)].sort((a, b) => b[0].length - a[0].length)[0][0];
      const [sx, sy] = ring.reduce(([ax, ay], c) => { const [x, y] = pt(c); return [ax + +x, ay + +y]; }, [0, 0]);
      return [sx / ring.length, sy / ring.length];
    };
    return {
      H,
      cons: constituencies.features.map((f) => ({
        name: String(f.properties?.name), d: path(f),
        label: pt([Number(f.properties?.label_lng), Number(f.properties?.label_lat)]),
      })),
      wards: wards.features.map((f) => ({ name: String(f.properties?.name), d: path(f), c: centre(f) })),
    };
  }, [constituencies, wards]);

  const byName = new Map(regions.map((r) => [r.name, r]));
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

        {/* Constituencies lit by status */}
        {geo.cons.map((c) => {
          const s = HEALTH[byName.get(c.name)?.status ?? "unknown"];
          return (
            <g key={c.name}>
              <path d={c.d} fill={s.color} fillOpacity=".16" stroke={s.color} strokeOpacity=".9" strokeWidth="2" filter="url(#mp-glow)" />
              <path d={c.d} fill={s.color} fillOpacity=".1" />
            </g>
          );
        })}
        {/* Ward etching */}
        {geo.wards.map((w) => <path key={w.name} d={w.d} fill="none" stroke="#ffffff" strokeOpacity=".14" strokeWidth=".8" />)}

        {/* Activity pulses (last 30 minutes) */}
        {pulses.map((p) => (
          <g key={p.id} transform={`translate(${p.at[0]} ${p.at[1]})`}>
            <circle r="8" className="map-ping" fill="#c9a227" fillOpacity=".25" stroke="#e3b53a" strokeWidth="2" style={{ animationDelay: `${(p.i % 6) * 0.4}s` }} />
            <circle r="6" fill="#fff4cc" stroke="#c9a227" strokeWidth="2.5" filter="url(#mp-glow)" />
          </g>
        ))}

      </svg>

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
    </div>
  );
}
