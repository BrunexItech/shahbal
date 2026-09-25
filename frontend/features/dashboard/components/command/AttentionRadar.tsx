"use client";

import { ArrowRight, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/loaders";
import { LiveDot } from "@/components/ui/Motion";
import { AreaDrawer } from "@/features/dashboard/components/command/AreaDrawer";
import { buildGeometry } from "@/features/dashboard/components/command/geometry";
import { useBoundaries, useConstituencyOutlines } from "@/features/map/api";
import { cn } from "@/lib/cn";
import type { AttentionAlert } from "@/lib/types";

const W = 520;
const MAX_H = 440;
const CYCLE_MS = 7000;

const TONE: Record<AttentionAlert["tone"], { key: string; hex: string; chip: string }> = {
  bad: { key: "Act now", hex: "#ff5a4a", chip: "bg-kenya-red text-white" },
  warn: { key: "Watch", hex: "#e3b53a", chip: "bg-gold text-navy-950" },
  good: { key: "Good news", hex: "#34c77b", chip: "bg-kenya-green text-white" },
  info: { key: "Note", hex: "#3fb3de", chip: "bg-ocean text-white" },
};

/**
 * "Needs attention now" as a live radar: every alert is pinned to the place it's about,
 * with rings pulsing out from that spot. The list cycles through them on its own; hover
 * or tap to hold one. Ward alerts open the street-level view.
 */
export function AttentionRadar({ alerts, connected }: { alerts: AttentionAlert[]; connected: boolean }) {
  const wards = useBoundaries();
  const cons = useConstituencyOutlines();
  const geo = useMemo(() => (wards.data && cons.data ? buildGeometry(cons.data, wards.data, W) : null), [wards.data, cons.data]);
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  const [openWard, setOpenWard] = useState<string | null>(null);

  useEffect(() => {
    if (hold || alerts.length < 2) return;
    const t = setInterval(() => setActive((a) => (a + 1) % alerts.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [hold, alerts.length]);
  useEffect(() => setActive((a) => (a < alerts.length ? a : 0)), [alerts.length]);

  const spots = useMemo(() => {
    if (!geo) return [];
    const island = geo.pt([39.665, -4.05]);
    const raw = alerts.map((a) => {
      if (a.level === "ward") {
        const w = geo.wards.find((x) => x.name === a.area);
        if (w) return { x: w.c[0], y: w.c[1], d: w.d };
      }
      if (a.level === "constituency") {
        const c = geo.cons.find((x) => x.name === a.area);
        if (c) return { x: +c.label[0], y: +c.label[1], d: c.d };
      }
      return { x: +island[0], y: +island[1], d: null as string | null };
    });
    // Nudge pins that would sit on top of each other (e.g. a ward inside its constituency).
    const placed: { x: number; y: number; d: string | null }[] = [];
    for (const r of raw) {
      let { x, y } = r;
      for (let tries = 0; tries < 6 && placed.some((q) => Math.hypot(q.x - x, q.y - y) < 30); tries++) {
        x += 26 * Math.cos(tries * 1.9);
        y += 26 * Math.sin(tries * 1.9);
      }
      placed.push({ ...r, x, y });
    }
    return placed;
  }, [geo, alerts]);

  if (!alerts.length) return null;
  const cur = alerts[active] ?? alerts[0];
  const t = TONE[cur.tone];

  return (
    <section aria-labelledby="attention" className="relative overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-[0_30px_60px_-30px_rgba(6,16,31,.7)]"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.045] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:30px_30px]" />
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-24 size-80 rounded-full blur-3xl transition-colors duration-700" style={{ background: `${t.hex}22` }} />

      <div className="relative grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8">
        {/* Radar map */}
        <div className="min-w-0">
          {geo ? (
            <div className="relative mx-auto" style={{ width: `min(100%, ${Math.round((MAX_H * (W + 40)) / (geo.H + 40))}px)`, aspectRatio: `${W + 40} / ${geo.H + 40}` }}>
              <svg viewBox={`-20 -20 ${W + 40} ${geo.H + 40}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`Map pinpointing: ${alerts.map((a) => a.area).join(", ")}`}>
                <defs>
                  <filter id="ar-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                {geo.cons.map((c) => <path key={c.name} d={c.d} fill="#ffffff" fillOpacity=".035" stroke="#ffffff" strokeOpacity=".35" strokeWidth="1.3" />)}
                {geo.wards.map((w) => <path key={w.name} d={w.d} fill="none" stroke="#ffffff" strokeOpacity=".1" strokeWidth=".7" />)}
                {spots[active]?.d && (
                  <path d={spots[active].d!} fill={t.hex} fillOpacity=".22" stroke={t.hex} strokeWidth="2" filter="url(#ar-glow)" className="transition-all duration-500" />
                )}
                {spots.map((s, i) => {
                  const tone = TONE[alerts[i].tone];
                  const on = i === active;
                  return (
                    <g key={i} transform={`translate(${s.x} ${s.y})`} className="cursor-pointer" onClick={() => setActive(i)}>
                      {[0, 0.9, 1.8].map((delay) => (
                        <circle key={delay} r={on ? 14 : 9} className="radar-wave" fill={on ? `${tone.hex}14` : "none"} stroke={tone.hex} strokeWidth={on ? 2.4 : 1.6}
                          style={{ animationDelay: `${delay + i * 0.25}s`, opacity: on ? 1 : 0.55 }} />
                      ))}
                      <circle r={on ? 8 : 6} fill={tone.hex} stroke="#06101f" strokeWidth="2" filter="url(#ar-glow)" />
                    </g>
                  );
                })}
              </svg>
              {/* numbered pins (HTML keeps them crisp and readable on phones) */}
              {spots.map((s, i) => (
                <button key={i} onClick={() => setActive(i)} aria-label={`Alert ${i + 1}: ${alerts[i].area}`}
                  className={cn("absolute grid size-6 -translate-x-1/2 place-items-center rounded-full text-xs font-extrabold ring-2 ring-[#06101f] transition",
                    i === active ? "scale-110 bg-white text-navy-950" : "bg-white/80 text-navy-950")}
                  style={{ left: `${((s.x + 20) / (W + 40)) * 100}%`, top: `calc(${((s.y + 20) / (geo.H + 40)) * 100}% - 26px)` }}>
                  {i + 1}
                </button>
              ))}
              <div className="pointer-events-none absolute -translate-x-1/2 rounded-full bg-[#06101f]/85 px-2.5 py-1 text-xs font-bold tracking-wider whitespace-nowrap uppercase transition-all duration-500"
                style={{ left: `${(((spots[active]?.x ?? 0) + 20) / (W + 40)) * 100}%`, top: `calc(${(((spots[active]?.y ?? 0) + 20) / (geo.H + 40)) * 100}% + 16px)`, color: t.hex, boxShadow: `0 0 0 1px ${t.hex}88` }}>
                <MapPin className="mr-1 inline size-3" />{cur.area}
              </div>
            </div>
          ) : <Skeleton className="aspect-square w-full rounded-2xl bg-white/5" />}
        </div>

        {/* Alerts */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="attention" className="font-display text-xl font-bold">Needs attention now</h2>
            <span className="inline-flex items-center gap-2 text-xs text-slate-400"><LiveDot on={connected} className="size-2" />{hold ? "Paused" : "Live"}</span>
          </div>
          <ol className="space-y-2">
            {alerts.map((a, i) => {
              const tone = TONE[a.tone];
              const on = i === active;
              return (
                <li key={`${a.title}-${i}`}>
                  <button onClick={() => setActive(i)} aria-current={on || undefined}
                    className={cn("relative w-full overflow-hidden rounded-2xl p-3.5 text-left ring-1 transition duration-300", on ? "bg-white/[.07] ring-white/15" : "ring-transparent hover:bg-white/[.04]")}>
                    {on && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ background: tone.hex }} />}
                    {on && !hold && <span aria-hidden key={active} className="absolute inset-x-0 bottom-0 h-0.5 origin-left" style={{ background: tone.hex, animation: `tab-sweep ${CYCLE_MS}ms linear both` }} />}
                    <div className="flex items-start gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-extrabold" style={{ background: `${tone.hex}26`, color: tone.hex }}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tracking-wide uppercase", tone.chip)}>{tone.key}</span>
                          <span className="inline-flex items-center gap-1 text-xs text-slate-400"><MapPin className="size-3" />{a.area}{a.level === "ward" && a.constituency ? ` · ${a.constituency}` : ""}</span>
                        </div>
                        <p className="mt-1.5 font-semibold leading-snug">{a.title}</p>
                        {on && <p className="mt-1 animate-fade-up text-sm leading-relaxed text-slate-300">{a.detail}</p>}
                      </div>
                    </div>
                  </button>
                  {on && a.level !== "county" && (
                    <div className="mt-1 flex justify-end">
                      {a.level === "ward" ? (
                        <button onClick={() => setOpenWard(a.area)} className="inline-flex items-center gap-1 px-3.5 py-1 text-sm font-semibold text-gold hover:underline">Open {a.area} <ArrowRight className="size-4" /></button>
                      ) : (
                        <Link href="/targets" className="inline-flex items-center gap-1 px-3.5 py-1 text-sm font-semibold text-gold hover:underline">See its wards <ArrowRight className="size-4" /></Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {openWard && <AreaDrawer wardName={openWard} onClose={() => setOpenWard(null)} />}
    </section>
  );
}
