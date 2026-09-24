"use client";

import { CountUp } from "@/components/ui/Motion";
import { num } from "@/lib/format";

/**
 * Half-dial of the county target. Solid arc = reached now; dashed arc = where the
 * current pace lands by election day; the far end of the dial is the target.
 */
export function PaceGauge({ percent, projectedPercent }: { percent: number; projectedPercent: number | null }) {
  const R = 100;
  const arc = `M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0`;
  const now = Math.min(Math.max(percent, 0), 100);
  const proj = projectedPercent == null ? null : Math.min(Math.max(projectedPercent, 0), 100);
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div className="mx-auto w-full max-w-[320px]">
      <div className="relative">
      <svg viewBox="-128 -118 256 136" className="w-full" role="img"
        aria-label={`${percent.toFixed(1)}% of the county target reached${projectedPercent != null ? `, ${Math.round(projectedPercent)}% projected by election day` : ""}`}>
        <defs>
          <linearGradient id="pg-fill" x1="0" x2="1">
            <stop offset="0" stopColor="#006b3f" />
            <stop offset="1" stopColor="#34c77b" />
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke="#ffffff" strokeOpacity=".08" strokeWidth="18" strokeLinecap="round" />
        {proj != null && proj > now && (
          <path d={arc} fill="none" stroke="#ffffff" strokeOpacity=".45" strokeWidth="18" pathLength={100}
            strokeDasharray={`0 ${now} ${proj - now} 100`} />
        )}
        <path d={arc} fill="none" stroke="url(#pg-fill)" strokeWidth="18" strokeLinecap="round" pathLength={100}
          strokeDasharray={`${Math.max(now, 0.5)} 100`} className="transition-[stroke-dasharray] duration-1000" />
        {ticks.map((t) => {
          const a = Math.PI * (1 - t / 100);
          return (
            <g key={t}>
              <line x1={Math.cos(a) * (R + 13)} y1={-Math.sin(a) * (R + 13)} x2={Math.cos(a) * (R + 18)} y2={-Math.sin(a) * (R + 18)}
                stroke={t === 100 ? "#c9a227" : "#ffffff"} strokeOpacity={t === 100 ? 1 : 0.3} strokeWidth={t === 100 ? 3 : 1.5} />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="font-display text-5xl leading-none font-extrabold tabular-nums">
          <CountUp value={percent} format={(n) => `${n.toFixed(n >= 10 ? 0 : 1)}%`} />
        </p>
        <p className="mt-1 text-xs tracking-[.18em] text-slate-400 uppercase">of county target</p>
      </div>
      </div>
      <div className="mt-3 flex justify-between px-1 text-xs text-slate-400 tabular-nums">
        <span>0</span>
        {projectedPercent != null && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-white/45" />On pace for {num(Math.round(projectedPercent))}%</span>}
        <span className="text-gold">Target</span>
      </div>
    </div>
  );
}
