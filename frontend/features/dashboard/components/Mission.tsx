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

import { Badge } from "@/components/ui";
import { CountUp, Sparkline } from "@/components/ui/Motion";
import { cn } from "@/lib/cn";
import { num, pct, timeAgo } from "@/lib/format";
import type { LiveCall, LiveEvent, Pulse } from "@/lib/live";
import type { DashboardSummary, Health, InsightCard } from "@/lib/types";

// ---- insight cards ---------------------------------------------------------------
const TONE: Record<InsightCard["tone"], { key: string; hex: string; soft: string; chip: string; glow: string }> = {
  bad: { key: "Act now", hex: "#bb1e10", soft: "#fdecea", chip: "bg-kenya-red text-white", glow: "rgba(187,30,16,.55)" },
  warn: { key: "Watch", hex: "#c9a227", soft: "#fbf4dc", chip: "bg-gold text-navy-950", glow: "rgba(201,162,39,.5)" },
  good: { key: "Good news", hex: "#006b3f", soft: "#e6f4ec", chip: "bg-kenya-green text-white", glow: "rgba(0,107,63,.5)" },
  info: { key: "Note", hex: "#0b7fa6", soft: "#e6f3f8", chip: "bg-ocean text-white", glow: "rgba(11,127,166,.5)" },
};

/**
 * Briefing cards. With `featured`, the most urgent item becomes a large dark card and
 * the rest stack beside it: the eye goes to what matters first.
 */
export function InsightCards({ cards, featured = false }: { cards: InsightCard[]; featured?: boolean }) {
  if (!cards.length) return null;
  if (featured) {
    const [lead, ...rest] = cards;
    return (
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <LeadCard c={lead} />
        <div className="grid gap-4">{rest.map((c, i) => <BriefCard key={c.title} c={c} n={i + 2} delay={(i + 1) * 80} />)}</div>
      </div>
    );
  }
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards.map((c, i) => <BriefCard key={c.title} c={c} n={i + 1} delay={i * 60} />)}</div>;
}

function LeadCard({ c }: { c: InsightCard }) {
  const t = TONE[c.tone];
  return (
    <article className="relative flex min-h-[220px] animate-fade-up flex-col justify-between overflow-hidden rounded-3xl bg-[#06101f] p-6 text-white shadow-[0_24px_50px_-28px_rgba(6,16,31,.8)] sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full blur-3xl" style={{ background: t.glow }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.05] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:28px_28px]" />
      <span aria-hidden className="pointer-events-none absolute -right-2 -bottom-10 font-display text-[10rem] leading-none font-black text-white/[.05] select-none">01</span>
      <div className="relative flex items-center gap-3">
        <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase", t.chip)}>
          <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-white/70" /><span className="relative size-2 rounded-full bg-white" /></span>
          {t.key}
        </span>
        <span className="text-xs font-semibold tracking-[.18em] text-slate-400 uppercase">Priority one</span>
      </div>
      <div className="relative mt-6">
        <h3 className="font-display text-2xl leading-tight font-extrabold sm:text-3xl">{c.title}</h3>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">{c.detail}</p>
      </div>
      <div aria-hidden className="relative mt-6 flex h-1 w-24 overflow-hidden rounded-full"><i className="flex-1 bg-kenya-black ring-1 ring-white/20" /><i className="flex-1 bg-kenya-red" /><i className="flex-1 bg-kenya-green" /></div>
    </article>
  );
}

function BriefCard({ c, n, delay }: { c: InsightCard; n: number; delay: number }) {
  const t = TONE[c.tone];
  return (
    <article style={{ animationDelay: `${delay}ms`, background: `linear-gradient(135deg, ${t.soft} 0%, #ffffff 55%)` }}
      className="group relative animate-fade-up overflow-hidden rounded-3xl p-5 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(11,31,58,.45)]">
      <span aria-hidden className="absolute inset-y-5 left-0 w-1.5 rounded-r-full" style={{ background: t.hex }} />
      <span aria-hidden className="pointer-events-none absolute top-1 right-4 font-display text-6xl leading-none font-black select-none" style={{ color: t.hex, opacity: 0.09 }}>
        {String(n).padStart(2, "0")}
      </span>
      <div className="relative flex items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase", t.chip)}>{t.key}</span>
      </div>
      <h3 className="relative mt-3 pr-10 font-display text-lg leading-snug font-bold text-navy-900">{c.title}</h3>
      <p className="relative mt-1.5 text-sm leading-relaxed text-slate-600">{c.detail}</p>
    </article>
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

const CAP = {
  black: { hex: "#111111", tint: "#eef0f3" },
  red: { hex: "#bb1e10", tint: "#fdecea" },
  green: { hex: "#006b3f", tint: "#e6f4ec" },
  gold: { hex: "#c9a227", tint: "#fbf4dc" },
  ocean: { hex: "#0b7fa6", tint: "#e6f3f8" },
} as const;

/**
 * Metric tile: tinted corner in its accent colour, a flag-colour marker, big number,
 * optional sparkline and a footnote. Lifts on hover when it links somewhere.
 */
export function KpiTile({ label, value, foot, spark, sparkColor, href, cap = "green" }: {
  label: string; value: number | string; foot: React.ReactNode; spark?: number[]; sparkColor?: string; href?: string; cap?: keyof typeof CAP;
}) {
  const c = CAP[cap];
  const body = (
    <div className={cn("group relative h-full animate-fade-up overflow-hidden rounded-3xl bg-white p-5 ring-1 ring-line transition duration-300",
      "hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(11,31,58,.45)]")}>
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-80 transition-transform duration-500 group-hover:scale-110"
        style={{ background: `radial-gradient(circle, ${c.tint} 0%, transparent 70%)` }} />
      <div className="relative flex items-center gap-2">
        <span aria-hidden className="h-4 w-1 rounded-full" style={{ background: c.hex }} />
        <p className="text-xs font-bold tracking-[.14em] text-slate-500 uppercase">{label}</p>
        {href && <ArrowUpRight aria-hidden className="ml-auto size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-navy-900" />}
      </div>
      <p className="relative mt-2 font-display text-[32px] leading-none font-extrabold tracking-tight text-navy-900 tabular-nums">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </p>
      {spark && <Sparkline data={spark} color={sparkColor ?? c.hex} className="relative mt-3" />}
      <div className="relative mt-2.5">{foot}</div>
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-3xl focus-visible:ring-2 focus-visible:ring-ocean focus-visible:outline-none">{body}</Link> : body;
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

