"use client";

import { CalendarClock, Clock, Flag, Vote } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

const eat = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+03:00`).getTime();

/**
 * Election countdown: live days / hours / minutes / seconds to polls opening, a campaign
 * clock (one segment per week, this week glowing), and the facts people ask for. On the
 * day it switches to "polls are open" and counts down to closing.
 */
export function ElectionCountdown({ date, pollsOpen = "06:00", pollsClose = "17:00", start, children }: {
  date: string | null;
  pollsOpen?: string;
  pollsClose?: string;
  /** Campaign start for the clock (defaults to the start of this week). */
  start?: string | null;
  /** Extra controls (e.g. HQ's date picker) shown under the facts. */
  children?: React.ReactNode;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!date) {
    return (
      <section className="relative overflow-hidden rounded-3xl bg-[#06101f] text-white">
        <Flagline />
        <div className="p-6 sm:p-8">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[.18em] text-gold uppercase"><Flag className="size-4" /> Election day</p>
          <p className="mt-3 font-display text-2xl font-bold">Not set yet</p>
          <p className="mt-1 text-sm text-slate-300">The countdown, required pace and weekly plan all start from this date.</p>
          {children && <div className="mt-5 max-w-sm">{children}</div>}
        </div>
      </section>
    );
  }

  const open = eat(date, pollsOpen);
  const close = eat(date, pollsClose);
  const t = now ?? open - 1;
  const live = t >= open && t < close;
  const over = t >= close;
  const target = live ? close : open;
  const left = Math.max(0, Math.floor((target - t) / 1000));
  const parts: [string, number][] = [["Days", Math.floor(left / 86400)], ["Hours", Math.floor(left / 3600) % 24], ["Minutes", Math.floor(left / 60) % 60], ["Seconds", left % 60]];

  // Campaign clock runs from the plan's first week; without a plan, from today.
  const startMs = start ? Math.min(eat(start, "00:00"), t) : Math.min(open - 7 * 86400_000, t - ((new Date(t).getDay() + 6) % 7) * 86400_000);
  const weeks = Math.max(1, Math.ceil((open - startMs) / (7 * 86400_000)));
  const weekNow = Math.min(weeks, Math.max(0, Math.floor((t - startMs) / (7 * 86400_000))));
  const weeksLeft = Math.max(0, Math.ceil((open - t) / (7 * 86400_000)));
  const weekendsLeft = (() => {
    let n = 0;
    for (let d = new Date(t); d.getTime() < open; d.setDate(d.getDate() + 1)) if (d.getDay() === 6) n++;
    return n;
  })();
  const pretty = new Date(`${date}T12:00:00+03:00`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-[0_30px_60px_-30px_rgba(6,16,31,.8)]">
      <Flagline />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(201,162,39,.22),transparent_45%),radial-gradient(ellipse_at_100%_100%,rgba(0,107,63,.35),transparent_50%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.05] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:30px_30px]" />
      <Vote aria-hidden className="pointer-events-none absolute -right-6 -bottom-8 size-56 text-white/[.04]" />

      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[.2em] text-gold uppercase">
            {live ? <><span className="relative flex size-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-[#34c77b]" /><span className="relative size-2.5 rounded-full bg-[#34c77b]" /></span> Polls are open</>
              : over ? <><Flag className="size-4" /> Polls have closed</> : <><CalendarClock className="size-4" /> Countdown to election day</>}
          </p>
          <p className="mt-2 font-display text-2xl leading-tight font-extrabold sm:text-3xl">{pretty}</p>

          {!over && (
            <div className="mt-5 grid max-w-xl grid-cols-4 gap-2 sm:gap-3" role="timer" aria-live="off"
              aria-label={`${parts[0][1]} days, ${parts[1][1]} hours, ${parts[2][1]} minutes ${live ? "until polls close" : "until polls open"}`}>
              {parts.map(([label, v]) => (
                <div key={label} className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-white/[.10] to-white/[.03] px-2 pt-3 pb-2 text-center ring-1 ring-white/10 [perspective:400px]">
                  <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-black/40" />
                  <p key={v} className="digit-in font-display text-3xl leading-none font-extrabold text-gold tabular-nums sm:text-5xl">{String(v).padStart(2, "0")}</p>
                  <p className="mt-1.5 text-xs font-semibold tracking-[.14em] text-slate-400 uppercase">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Campaign clock: one segment per week */}
          <div className="mt-6 max-w-xl">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Campaign clock</span>
              <span>{over ? "Done" : `Week ${Math.min(weekNow + 1, weeks)} of ${weeks}`}</span>
            </div>
            <div className="mt-2 flex gap-1" aria-hidden>
              {Array.from({ length: weeks }).map((_, i) => (
                <span key={i} className={cn("h-2 flex-1 rounded-full transition", i < weekNow ? "bg-gradient-to-r from-kenya-green to-[#34c77b]" : i === weekNow ? "animate-pulse bg-gold shadow-[0_0_10px_#c9a227]" : "bg-white/10")} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 lg:w-60 lg:grid-cols-1">
          {([
            [Clock, "Polls", `${pollsOpen} – ${pollsClose}`],
            [CalendarClock, "Weeks left", String(weeksLeft)],
            [Flag, "Weekends left", String(weekendsLeft)],
          ] as const).map(([Icon, k, v]) => (
            <div key={k} className="rounded-2xl bg-white/[.05] px-3 py-2.5 ring-1 ring-white/[.08]">
              <p className="flex items-center gap-1.5 text-xs text-slate-400"><Icon className="size-3.5 text-gold" />{k}</p>
              <p className="font-display text-lg font-bold tabular-nums">{v}</p>
            </div>
          ))}
          {children && <div className="col-span-3 lg:col-span-1">{children}</div>}
        </div>
      </div>
    </section>
  );
}

function Flagline() {
  return <div aria-hidden className="relative flex h-1.5"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>;
}
