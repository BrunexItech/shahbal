"use client";

import { ArrowRight, MapPin, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AreaDrawer } from "@/features/dashboard/components/command/AreaDrawer";
import { cn } from "@/lib/cn";
import type { AttentionAlert } from "@/lib/types";

export const ATTENTION_CYCLE_MS = 7000;

const TONE: Record<AttentionAlert["tone"], { key: string; hex: string; chip: string; tint: string }> = {
  bad: { key: "Act now", hex: "#bb1e10", chip: "bg-kenya-red text-white", tint: "#fdecea" },
  warn: { key: "Watch", hex: "#c9a227", chip: "bg-gold text-navy-950", tint: "#fbf4dc" },
  good: { key: "Good news", hex: "#006b3f", chip: "bg-kenya-green text-white", tint: "#e6f4ec" },
  info: { key: "Note", hex: "#0b7fa6", chip: "bg-ocean text-white", tint: "#e6f3f8" },
};

/**
 * "Needs attention now" as a slim row of tickets under the Command Centre banner.
 * The banner's map pulses on each ticket's place; the row cycles on its own and a
 * click (or hover) holds one. No second map — the tickets point at the one above.
 */
export function AttentionStrip({ alerts, active, onActive, playing, onPlaying, allInsights }: {
  alerts: AttentionAlert[];
  active: number;
  onActive: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  allInsights: boolean;
}) {
  const [openWard, setOpenWard] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!playing || hover || alerts.length < 2) return;
    const t = setInterval(() => onActive((active + 1) % alerts.length), ATTENTION_CYCLE_MS);
    return () => clearInterval(t);
  }, [playing, hover, alerts.length, active, onActive]);

  const pick = (i: number) => {
    onActive(i);
    const stage = document.getElementById("command-stage");
    if (stage && stage.getBoundingClientRect().bottom < 120) stage.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!alerts.length) return null;
  return (
    <section aria-labelledby="attention" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="attention" className="flex items-center gap-2 text-base font-bold text-navy-900">
            <span className="relative flex size-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-kenya-red/60" /><span className="relative size-2.5 rounded-full bg-kenya-red" /></span>
            Needs attention now
          </h2>
          <p className="text-sm text-slate-500">Each place pulses on the map above. Tap one to point at it.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onPlaying(!playing)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 ring-1 ring-line hover:bg-slate-50"
            aria-label={playing ? "Stop cycling" : "Cycle through alerts"}>
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {playing ? "Cycling" : "Paused"}
          </button>
          {allInsights && <Link href="/analytics#insights" className="inline-flex items-center gap-1 text-sm font-semibold text-ocean hover:underline">All insights <ArrowRight className="size-4" /></Link>}
        </div>
      </div>

      <ol className="scroll-thin -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {alerts.map((a, i) => {
          const t = TONE[a.tone];
          const on = i === active;
          return (
            <li key={`${a.title}-${i}`} className="w-[82%] shrink-0 snap-start sm:w-[300px]">
              <div role="button" tabIndex={0} onClick={() => pick(i)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick(i)} aria-pressed={on}
                style={on ? { boxShadow: `0 0 0 2px ${t.hex}, 0 18px 36px -22px ${t.hex}` } : undefined}
                className={cn("relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-white p-4 pl-5 ring-1 ring-line transition duration-300 outline-none",
                  on ? "-translate-y-0.5" : "hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ocean")}>
                <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: t.hex }} />
                <span aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `linear-gradient(135deg, ${t.tint} 0%, transparent 45%)` }} />

                <div className="relative flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold text-white" style={{ background: t.hex }}>{i + 1}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tracking-wide uppercase", t.chip)}>{t.key}</span>
                </div>
                <p className="relative mt-3 font-display text-base leading-snug font-bold text-navy-900">{a.title}</p>
                <p className="relative mt-1 mb-3 line-clamp-2 text-sm leading-relaxed text-slate-600">{a.detail}</p>

                <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-dashed border-line pt-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <MapPin className="size-3.5 shrink-0" style={{ color: t.hex }} />
                    <span className="truncate">{a.area}{a.level === "ward" && a.constituency ? ` · ${a.constituency}` : ""}</span>
                  </span>
                  {a.level === "ward" ? (
                    <button onClick={(e) => { e.stopPropagation(); setOpenWard(a.area); }} className="shrink-0 text-xs font-bold text-ocean hover:underline">Open ward</button>
                  ) : a.level === "constituency" ? (
                    <Link href="/targets" onClick={(e) => e.stopPropagation()} className="shrink-0 text-xs font-bold text-ocean hover:underline">See wards</Link>
                  ) : null}
                </div>
                {on && playing && !hover && (
                  <span aria-hidden key={`sweep-${active}`} className="absolute inset-x-0 bottom-0 h-0.5 origin-left" style={{ background: t.hex, animation: `tab-sweep ${ATTENTION_CYCLE_MS}ms linear both` }} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {openWard && <AreaDrawer wardName={openWard} onClose={() => setOpenWard(null)} />}
    </section>
  );
}
