"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export type Section = { id: string; label: string; hint?: string };

/**
 * Sticky in-page navigator for long pages (Analytics). Numbered chapters, the current
 * one tracked as you scroll, marked with a Kenyan flag bar. Clicks scroll smoothly and
 * update the URL hash, so a section can be linked directly (e.g. /analytics#wards).
 */
export function SectionNav({ sections, label = "On this page" }: { sections: readonly Section[]; label?: string }) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);
  const lock = useRef(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const onScroll = () => {
      if (Date.now() < lock.current) return;
      const line = 190; // just below the sticky header + this bar
      let current: string | undefined = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top - line <= 0) current = el.id;
      // At the very bottom, the last section wins even if it's short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = els.at(-1)?.id;
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  // Keep the active chapter visible in the scrollable bar on phones.
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    lock.current = Date.now() + 700; // don't let the scroll-spy flicker mid-animation
    setActive(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav aria-label={label} className="sticky top-16 z-10 -mx-4 mb-6 border-b border-line bg-white/90 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:shadow-[0_8px_24px_-18px_rgba(11,31,58,.35)]">
      <div className="flex items-stretch">
        <div className="hidden shrink-0 items-center gap-2.5 border-r border-line pr-4 pl-4 lg:flex">
          <span aria-hidden className="flex h-7 w-1 flex-col overflow-hidden rounded-full">
            <span className="flex-1 bg-kenya-black" /><span className="flex-1 bg-kenya-red" /><span className="flex-1 bg-kenya-green" />
          </span>
          <span className="text-xs font-bold tracking-[.16em] text-slate-500 uppercase">{label}</span>
        </div>
        <div ref={bar} className="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-2">
          {sections.map((s, i) => {
            const on = s.id === active;
            return (
              <a key={s.id} data-id={s.id} href={`#${s.id}`} onClick={go(s.id)} aria-current={on ? "location" : undefined} title={s.hint}
                className={cn("group relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
                  on ? "bg-navy-950 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-navy-900")}>
                <span className={cn("font-mono text-xs tabular-nums", on ? "text-gold" : "text-slate-400 group-hover:text-slate-500")}>{String(i + 1).padStart(2, "0")}</span>
                {s.label}
                {/* Flag bar under the current chapter: black · red · green with white fimbriation */}
                <span aria-hidden className={cn("absolute inset-x-3 -bottom-px flex h-[3px] gap-px overflow-hidden rounded-full transition-opacity", on ? "opacity-100" : "opacity-0")}>
                  <span className="flex-1 bg-kenya-black" /><span className="flex-1 bg-kenya-red" /><span className="flex-1 bg-kenya-green" />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

/** Chapter heading that matches the navigator: number, title, one-line purpose, flag rule. */
export function SectionTitle({ n, title, hint, action }: { n: number; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-navy-950 font-mono text-sm font-bold text-gold tabular-nums">{String(n).padStart(2, "0")}</span>
        <div>
          <h2 className="text-lg font-bold text-navy-900">{title}</h2>
          {hint && <p className="text-sm text-slate-500">{hint}</p>}
        </div>
      </div>
      {action}
      <span aria-hidden className="flex h-[3px] w-full overflow-hidden rounded-full">
        <span className="w-10 bg-kenya-black" /><span className="w-1 bg-white" /><span className="w-10 bg-kenya-red" /><span className="w-1 bg-white" />
        <span className="w-10 bg-kenya-green" /><span className="flex-1 bg-line" />
      </span>
    </div>
  );
}
