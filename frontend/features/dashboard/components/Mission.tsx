"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Headphones,
  PhoneCall,
  Radio,
  UserPlus,
  Vote,
} from "lucide-react";
import Link from "next/link";

import { FlagStripe } from "@/components/shell/FlagStripe";
import { Badge } from "@/components/ui";
import { CountUp, LiveDot, Ring, Sparkline } from "@/components/ui/Motion";
import { cn } from "@/lib/cn";
import { CANDIDATE_NAME } from "@/lib/config";
import { num, pct, timeAgo } from "@/lib/format";
import type { LiveCall, LiveEvent, Pulse } from "@/lib/live";
import type { DashboardSummary, Health, InsightCard } from "@/lib/types";

// ---- hero ------------------------------------------------------------------------
export function MissionHero({ d, pulse, connected }: { d: DashboardSummary; pulse: Pulse | null; connected: boolean }) {
  const i = d.insights;
  const o = d.overall;
  const onTrack = i.projected != null && o.target > 0 && i.projected >= o.target;
  const verdict = !o.target
    ? { tone: "info", text: "Set ward targets to start tracking the mission" }
    : i.days_left == null
      ? { tone: "info", text: `${pct(o.percent)} of the county target reached` }
      : onTrack
        ? { tone: "good", text: "On course to hit the county target" }
        : { tone: "bad", text: `Behind: we need ${num(i.required_pace)} supporters a day` };
  const scale = Math.max(o.target, i.projected ?? 0, o.achieved, 1);
  const at = (n: number) => `${Math.min((n / scale) * 100, 100)}%`;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-[0_30px_60px_-30px_rgba(6,16,31,.6)]">
      <FlagStripe />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_10%_0%,rgba(11,127,166,.35),transparent_45%),radial-gradient(ellipse_at_90%_110%,rgba(201,162,39,.22),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[.05] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="relative grid gap-8 p-6 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:p-8">
        <Ring percent={o.percent ?? 0} size={176} stroke={14}>
          <p className="font-display text-4xl font-extrabold"><CountUp value={o.percent ?? 0} format={(n) => `${n.toFixed(n >= 10 ? 0 : 1)}%`} /></p>
          <p className="text-xs tracking-wider text-slate-400 uppercase">of target</p>
        </Ring>

        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[.2em] text-gold uppercase">{CANDIDATE_NAME} · County mission</p>
          <h2 className={cn("mt-2 text-2xl leading-tight font-extrabold sm:text-3xl", verdict.tone === "bad" && "text-white", verdict.tone === "good" && "text-[#7ee2b0]")}>
            {verdict.text}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            <b className="text-white"><CountUp value={o.achieved} /></b> supporters reached of <b className="text-white">{num(o.target)}</b>
            {i.days_left != null && <> · <b className="text-white">{i.days_left}</b> days to election day</>}
            {" "}· pace <b className="text-white">{num(Math.round(i.pace))}</b>/day
          </p>
          {o.target > 0 && (
            <div className="mt-6">
              <div className="relative h-3 rounded-full bg-white/[.08]">
                <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-kenya-green to-[#34c77b] transition-[width] duration-1000" style={{ width: at(o.achieved) }} />
                {i.projected != null && (
                  <div className="absolute inset-y-0 left-0 rounded-full border border-dashed border-white/40" style={{ width: at(i.projected) }} />
                )}
                <div className="absolute -top-1.5 h-6 w-0.5 bg-gold shadow-[0_0_10px_#c9a227]" style={{ left: at(o.target) }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-kenya-green" /> Reached today</span>
                {i.projected != null && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm border border-dashed border-white/50" /> Projected by election day: {num(i.projected)}</span>}
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-gold" /> Target {num(o.target)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:w-[300px]">
          {[
            { rule: "bg-white", label: "Captured today", value: pulse?.captures_today ?? d.totals.today },
            { rule: "bg-kenya-red", label: "Calls today", value: pulse?.calls_today ?? d.ops.calls_today },
            { rule: "bg-[#34c77b]", label: "In the field now", value: pulse?.online_field ?? 0 },
            { rule: "bg-gold", label: "Marked voted", value: pulse?.voted ?? d.ops.voted },
          ].map(({ rule, label, value }) => (
            <div key={label} className="relative overflow-hidden rounded-2xl border border-white/[.08] bg-white/[.04] p-3.5 pt-4 backdrop-blur">
              <span className={cn("absolute inset-x-3.5 top-0 h-[3px] rounded-b-full", rule)} />
              <p className="font-display text-2xl font-bold"><CountUp value={value} /></p>
              <p className="text-xs text-slate-400">{label}</p>
            </div>
          ))}
          <p className="col-span-2 flex items-center justify-end gap-2 text-xs text-slate-400">
            <LiveDot on={connected} className="size-2" /> {connected ? "Streaming live" : "Reconnecting…"}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---- insight cards ---------------------------------------------------------------
const TONE: Record<InsightCard["tone"], { key: string; spine: string; wash: string; chip: string }> = {
  bad: { key: "Act now", spine: "bg-kenya-red", wash: "from-kenya-red/[.07]", chip: "bg-kenya-red text-white" },
  warn: { key: "Watch", spine: "bg-gold", wash: "from-gold/[.12]", chip: "bg-gold text-navy-950" },
  good: { key: "Good news", spine: "bg-kenya-green", wash: "from-kenya-green/[.08]", chip: "bg-kenya-green text-white" },
  info: { key: "Note", spine: "bg-ocean", wash: "from-ocean/[.08]", chip: "bg-ocean text-white" },
};

export function InsightCards({ cards }: { cards: InsightCard[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((c, idx) => {
        const t = TONE[c.tone];
        return (
          <article key={c.title} style={{ animationDelay: `${idx * 70}ms` }}
            className={cn("relative animate-fade-up overflow-hidden rounded-2xl border border-line bg-gradient-to-br to-white to-60% p-5 pl-7 shadow-[0_1px_2px_rgba(11,31,58,.04)]", t.wash)}>
            <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", t.spine)} />
            <div className="flex items-center justify-between gap-3">
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase", t.chip)}>{t.key}</span>
              <span className="font-mono text-xs font-semibold tracking-widest text-slate-400">#{String(idx + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="mt-3 font-display text-lg leading-snug font-bold text-navy-900">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{c.detail}</p>
          </article>
        );
      })}
    </div>
  );
}

// ---- KPI tiles ---------------------------------------------------------------------
export function Delta({ now, before, suffix = "" }: { now: number; before: number; suffix?: string }) {
  const diff = now - before;
  if (!before && !now) return <span className="text-xs text-muted">No activity yet</span>;
  const up = diff >= 0;
  const p = before ? Math.round((diff / before) * 100) : null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", up ? "text-kenya-green" : "text-kenya-red")}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {up ? "+" : ""}{num(diff)}{p != null && ` (${up ? "+" : ""}${p}%)`}{suffix}
    </span>
  );
}

const CAP = { black: "bg-kenya-black", red: "bg-kenya-red", green: "bg-kenya-green", gold: "bg-gold", ocean: "bg-ocean" } as const;

export function KpiTile({ label, value, foot, spark, sparkColor, href, cap = "green" }: {
  label: string; value: number | string; foot: React.ReactNode; spark?: number[]; sparkColor?: string; href?: string; cap?: keyof typeof CAP;
}) {
  const body = (
    <div className="group relative h-full animate-fade-up overflow-hidden rounded-2xl border border-line bg-white p-4 pt-5 shadow-[0_1px_2px_rgba(11,31,58,.04)] transition hover:-translate-y-0.5 hover:shadow-lg">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", CAP[cap])} />
      <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</p>
      <p className="mt-1 font-display text-[28px] leading-tight font-bold text-navy-900">{typeof value === "number" ? <CountUp value={value} /> : value}</p>
      {spark && <Sparkline data={spark} color={sparkColor} className="mt-1" />}
      <div className="mt-1.5">{foot}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// ---- constituency league -------------------------------------------------------------
const HEALTH: Record<Health, { label: string; dot: string; badge: "green" | "gold" | "red" | "slate" }> = {
  on_track: { label: "On track", dot: "bg-kenya-green", badge: "green" },
  at_risk: { label: "At risk", dot: "bg-gold", badge: "gold" },
  critical: { label: "Critical", dot: "bg-kenya-red", badge: "red" },
  unknown: { label: "No target", dot: "bg-slate-300", badge: "slate" },
};

export function ConstituencyLeague({ rows }: { rows: DashboardSummary["insights"]["constituencies"] }) {
  const sorted = [...rows].sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
  return (
    <ol className="divide-y divide-line">
      {sorted.map((c, idx) => {
        const h = HEALTH[c.status];
        return (
          <li key={c.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-5 py-3">
            <span className={cn("grid size-7 place-items-center rounded-full text-xs font-bold", idx === 0 ? "bg-gold text-navy-950" : "bg-slate-100 text-slate-600")}>{idx + 1}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 shrink-0 rounded-full", h.dot)} aria-hidden />
                <p className="truncate font-semibold text-navy-900">{c.name}</p>
                <Badge tone={h.badge}>{h.label}</Badge>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cn("h-full rounded-full transition-[width] duration-1000", h.dot)} style={{ width: `${Math.min(c.percent ?? 0, 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {num(c.achieved)} / {c.target ? num(c.target) : "—"} · {num(Math.round(c.pace))}/day · <b className="text-navy-900">+{num(c.today)}</b> today
                {c.projected_percent != null && <> · projected <b className="text-navy-900">{pct(c.projected_percent)}</b></>}
              </p>
            </div>
            <p className="text-right font-display text-lg font-bold text-navy-900 tabular-nums">{pct(c.percent)}</p>
          </li>
        );
      })}
    </ol>
  );
}

// ---- live activity -----------------------------------------------------------------
const EVENT: Record<string, { verb: string; icon: typeof CircleDot; cls: string }> = {
  CREATE: { verb: "captured a supporter", icon: UserPlus, cls: "bg-kenya-green-50 text-kenya-green" },
  VERIFY: { verb: "verified a record", icon: CheckCircle2, cls: "bg-kenya-green-50 text-kenya-green" },
  REJECT: { verb: "rejected a record", icon: AlertTriangle, cls: "bg-red-50 text-kenya-red" },
  CALL: { verb: "logged a call", icon: PhoneCall, cls: "bg-ocean-50 text-ocean" },
  CHECKIN: { verb: "checked in to a visit", icon: Radio, cls: "bg-gold-50 text-[#7a5f0c]" },
  COMPLETE: { verb: "completed a visit", icon: CheckCircle2, cls: "bg-gold-50 text-[#7a5f0c]" },
  MARK_VOTED: { verb: "marked a supporter as voted", icon: Vote, cls: "bg-kenya-green-50 text-kenya-green" },
  APPROVE: { verb: "approved a message", icon: CheckCircle2, cls: "bg-ocean-50 text-ocean" },
  PASSKEY_ADD: { verb: "added a passkey", icon: CheckCircle2, cls: "bg-slate-100 text-slate-600" },
  NEW_DEVICE: { verb: "signed in on a new device", icon: AlertTriangle, cls: "bg-amber-50 text-amber-700" },
};

export function LiveActivity({ events }: { events: LiveEvent[] }) {
  if (!events.length) return <p className="px-5 py-10 text-center text-sm text-muted">Waiting for activity. New actions appear here the moment they happen.</p>;
  return (
    <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
      {events.map((e) => {
        const cfg = EVENT[e.action] ?? { verb: e.action.toLowerCase().replace(/_/g, " "), icon: CircleDot, cls: "bg-slate-100 text-slate-600" };
        const source = e.entity === "voter" && e.meta && (e.meta as { source?: string }).source;
        return (
          <li key={e.id} className="flex animate-fade-up items-center gap-3 px-5 py-2.5 text-sm">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", cfg.cls)}><cfg.icon className="size-4" /></span>
            <p className="min-w-0 flex-1 truncate"><b className="text-navy-900">{e.actor}</b> <span className="text-slate-600">{cfg.verb}{source === "portal" ? " (portal)" : ""}</span>{e.ward && <span className="text-slate-600"> in <b className="font-semibold text-navy-900">{e.ward}</b></span>}</p>
            <span className="text-xs whitespace-nowrap text-muted">{timeAgo(e.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- live call wall ----------------------------------------------------------------
const CALL_STATUS: Record<LiveCall["status"], { label: string; cls: string }> = {
  on_call: { label: "On call", cls: "bg-kenya-green text-white" },
  ringing: { label: "Ringing", cls: "bg-gold text-navy-950" },
  wrap_up: { label: "Wrap-up", cls: "bg-ocean text-white" },
  available: { label: "Available", cls: "bg-slate-100 text-slate-600" },
  away: { label: "Away", cls: "bg-slate-100 text-slate-400" },
};

export function CallWall({ calls }: { calls: LiveCall[] | null }) {
  if (!calls?.length)
    return (
      <div className="flex flex-col items-center px-5 py-10 text-center text-sm text-muted">
        <Headphones className="mb-2 size-6 text-slate-300" /> No call-centre seats signed in right now.
      </div>
    );
  return (
    <ul className="grid gap-2 p-4 sm:grid-cols-2">
      {calls.map((c) => (
        <li key={c.agent_id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-navy-900">{c.agent}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", CALL_STATUS[c.status].cls)}>{CALL_STATUS[c.status].label}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {c.voter ? <>with <b className="text-navy-900">{c.voter}</b></> : "Waiting for next voter"} · {timeAgo(c.since)}
          </p>
        </li>
      ))}
    </ul>
  );
}

