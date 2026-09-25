"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

export type TabDef = { id: string; label: string; hint?: string; count?: number };

/**
 * Sticky, numbered tab bar with a Kenyan-flag marker on the active tab and a gold
 * sweep while the next panel slides in. Keyboard: ←/→ move between tabs.
 */
export function FlagTabs({ tabs, active, onChange, label, switching }: {
  tabs: readonly TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  switching: number;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);
  const move = (dir: number) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.id);
    bar.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  };
  return (
    <div className="sticky top-16 z-10 -mx-4 mb-6 border-b border-line bg-white/90 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:shadow-[0_10px_30px_-20px_rgba(11,31,58,.4)]">
      <div className="flex items-stretch">
        <div className="hidden shrink-0 items-center gap-2.5 border-r border-line px-4 lg:flex">
          <span aria-hidden className="flex h-7 w-1 flex-col overflow-hidden rounded-full"><i className="flex-1 bg-kenya-black" /><i className="flex-1 bg-kenya-red" /><i className="flex-1 bg-kenya-green" /></span>
          <span className="text-xs font-bold tracking-[.16em] text-slate-500 uppercase">{label}</span>
        </div>
        <div ref={bar} role="tablist" aria-label={label} className="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-2"
          onKeyDown={(e) => { if (e.key === "ArrowRight") move(1); if (e.key === "ArrowLeft") move(-1); }}>
          {tabs.map((t, i) => {
            const on = t.id === active;
            return (
              <button key={t.id} data-id={t.id} role="tab" aria-selected={on} aria-controls={`panel-${t.id}`} tabIndex={on ? 0 : -1} title={t.hint}
                onClick={() => onChange(t.id)}
                className={cn("group relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors duration-200",
                  on ? "bg-navy-950 text-white shadow-[0_6px_18px_-8px_rgba(6,16,31,.7)]" : "text-slate-500 hover:bg-slate-100 hover:text-navy-900")}>
                <span className={cn("font-mono text-xs tabular-nums", on ? "text-gold" : "text-slate-400")}>{String(i + 1).padStart(2, "0")}</span>
                {t.label}
                {t.count != null && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-white/15" : "bg-slate-100")}>{t.count}</span>}
                <span aria-hidden className={cn("absolute inset-x-3 -bottom-px flex h-[3px] gap-px overflow-hidden rounded-full transition-opacity", on ? "opacity-100" : "opacity-0")}>
                  <i className="flex-1 bg-kenya-black" /><i className="flex-1 bg-kenya-red" /><i className="flex-1 bg-kenya-green" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative h-0.5 overflow-hidden sm:rounded-b-2xl">
        {switching > 0 && <span key={switching} className="tab-sweep absolute inset-0 bg-gradient-to-r from-gold via-[#e3b53a] to-kenya-green" />}
      </div>
    </div>
  );
}

/** Sync the active tab with the URL hash so tabs can be linked and survive reloads. */
export function readHash(ids: readonly string[], fallback: string) {
  if (typeof window === "undefined") return fallback;
  const h = window.location.hash.slice(1);
  return ids.includes(h) ? h : fallback;
}
