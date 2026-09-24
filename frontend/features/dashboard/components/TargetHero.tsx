import { FlagStripe } from "@/components/shell/FlagStripe";
import { num, pct } from "@/lib/format";
import type { Progress } from "@/lib/types";

/** Headline card: one number the whole campaign rallies around — progress to target. */
export function TargetHero({ overall, verified }: { overall: Progress; verified: number }) {
  const p = Math.min(overall.percent ?? 0, 100);
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative animate-fade-up overflow-hidden rounded-2xl bg-navy-950 text-white">
      <FlagStripe />
      <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-ocean/25 blur-3xl" />
      <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        <div className="relative grid size-36 shrink-0 place-items-center self-center">
          <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="10" />
            <circle cx="60" cy="60" r={R} fill="none" stroke="#c9a227" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(C * p) / 100} ${C}`} className="transition-[stroke-dasharray] duration-1000 ease-out" />
          </svg>
          <div className="text-center">
            <p className="font-display text-3xl font-bold tabular-nums">{pct(overall.percent)}</p>
            <p className="text-xs text-slate-400">of target</p>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold tracking-[.16em] text-gold uppercase">County target</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums">
            {num(overall.achieved)} <span className="text-xl font-semibold text-slate-400">/ {overall.target ? num(overall.target) : "not set"}</span>
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-white/[.05] px-3 py-2 ring-1 ring-white/10">
              <p className="text-xs text-slate-400">Gap remaining</p>
              <p className="font-display text-lg font-bold tabular-nums">{num(overall.gap)}</p>
            </div>
            <div className="rounded-xl bg-white/[.05] px-3 py-2 ring-1 ring-white/10">
              <p className="text-xs text-slate-400">Verified contacts</p>
              <p className="font-display text-lg font-bold tabular-nums">{num(verified)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
