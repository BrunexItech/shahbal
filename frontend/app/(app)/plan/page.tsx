"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Flag, Sparkles, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Skeleton } from "@/components/loaders";
import { Button, Card, ErrorState, PageHeader, useConfirm } from "@/components/ui";
import { useElectionSettings, useSaveElectionSettings } from "@/features/election/api";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

type Week = { week_start: string; target: number; actual: number | null; cumulative_target: number; cumulative_actual: number | null; current: boolean; past: boolean };
type Plan = {
  election_date: string | null; days_left: number | null; target_total: number; achieved: number; before_plan: number;
  planned_total: number; planned_by_today: number | null; vs_plan: number | null; weeks: Week[];
};
type Shape = "even" | "ramp" | "front";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T12:00:00+03:00`);
const fmt = (s: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => day(s).toLocaleDateString("en-KE", o);
const mondayOf = (d: Date) => { const x = new Date(d); x.setUTCHours(12, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };

/** Split `total` over n weeks by shape, exactly (largest remainder). */
function spread(total: number, n: number, shape: Shape): number[] {
  const w = Array.from({ length: n }, (_, i) => (shape === "even" ? 1 : shape === "ramp" ? 1 + i : n - i));
  const s = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (total * x) / s);
  const base = raw.map(Math.floor);
  raw.map((x, i) => [x - base[i], i] as const).sort((a, b) => b[0] - a[0]).slice(0, total - base.reduce((a, b) => a + b, 0)).forEach(([, i]) => base[i]++);
  return base;
}

/**
 * Campaign plan: set election day, then decide how many people to capture each week
 * until then. Every week shows plan against what actually happened, and "planned by
 * today" tells the Command Centre whether we're ahead or behind.
 */
export default function PlanPage() {
  const user = useUser();
  const hq = user.role === "super_admin";
  const qc = useQueryClient();
  const confirm = useConfirm();
  const plan = useQuery({ queryKey: ["plan"], queryFn: () => api<Plan>("/election/plan") });
  const settings = useElectionSettings();
  const saveSettings = useSaveElectionSettings();
  const [date, setDate] = useState("");
  const [draft, setDraft] = useState<{ week_start: string; target: number }[] | null>(null);
  const [shape, setShape] = useState<Shape>("ramp");

  useEffect(() => { if (settings.data?.election_date) setDate(settings.data.election_date); }, [settings.data?.election_date]);

  const save = useMutation({
    mutationFn: (weeks: { week_start: string; target: number }[]) => api<Plan>("/election/plan", { method: "PUT", body: { weeks } }),
    onSuccess: (p) => { qc.setQueryData(["plan"], p); qc.invalidateQueries({ queryKey: ["dashboard"] }); setDraft(null); toast.success("Plan saved"); },
    onError: (e) => toast.error(e.message),
  });

  const p = plan.data;
  const weeksToVote = useMemo(() => {
    if (!p?.election_date) return [];
    const out: string[] = [];
    for (let m = mondayOf(new Date()); m <= day(p.election_date); m.setUTCDate(m.getUTCDate() + 7)) out.push(iso(m));
    return out;
  }, [p?.election_date]);

  const build = () => {
    if (!p) return;
    const remaining = Math.max(p.target_total - p.achieved, 0);
    const parts = spread(remaining, weeksToVote.length, shape);
    setDraft(weeksToVote.map((w, i) => ({ week_start: w, target: parts[i] })));
  };

  const rows = draft
    ? draft.map((d) => p?.weeks.find((w) => w.week_start === d.week_start) ? { ...p!.weeks.find((w) => w.week_start === d.week_start)!, target: d.target } : { week_start: d.week_start, target: d.target, actual: null, cumulative_target: 0, cumulative_actual: null, current: false, past: false })
    : p?.weeks ?? [];
  const chart = useMemo(() => {
    let cum = p?.before_plan ?? 0;
    return rows.map((w) => { cum += w.target; return { week: w.week_start, plan: cum, actual: w.cumulative_actual }; });
  }, [rows, p?.before_plan]);

  if (plan.error) return <Card><ErrorState error={plan.error} onRetry={plan.refetch} /></Card>;
  if (!p) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-80 rounded-3xl" /></div>;
  const ahead = p.vs_plan != null && p.vs_plan >= 0;

  return (
    <>
      <PageHeader eyebrow="Planning" title="Campaign plan"
        subtitle="Set election day, then plan how many people to capture each week. Every week is measured against what the team actually did." />

      <div className="grid gap-4 md:grid-cols-3">
        {/* Election day */}
        <div className="relative overflow-hidden rounded-3xl bg-[#06101f] p-5 text-white">
          <div aria-hidden className="absolute inset-x-0 top-0 flex h-1"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
          <p className="flex items-center gap-2 text-xs font-bold tracking-[.16em] text-gold uppercase"><Flag className="size-4" /> Election day</p>
          {p.election_date ? (
            <>
              <p className="mt-3 font-display text-5xl leading-none font-extrabold tabular-nums">{p.days_left}<span className="ml-2 text-lg font-bold text-slate-300">days</span></p>
              <p className="mt-1 text-sm text-slate-300">{fmt(p.election_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {Math.ceil((p.days_left ?? 0) / 7)} weeks</p>
            </>
          ) : <p className="mt-3 text-sm text-slate-300">Not set yet. The countdown, required pace and plan all start from this date.</p>}
          {hq && (
            <div className="mt-4 flex gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Election date"
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 text-base text-white [color-scheme:dark] focus:border-gold focus:outline-none" />
              <Button variant="gold" size="sm" disabled={!date || date === p.election_date || !settings.data} loading={saveSettings.isPending}
                onClick={() => saveSettings.mutate({ ...settings.data!, election_date: date }, {
                  onSuccess: () => { toast.success("Election day set"); qc.invalidateQueries({ queryKey: ["plan"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
                  onError: (e) => toast.error(e.message),
                })}>Save</Button>
            </div>
          )}
        </div>

        {/* Target */}
        <div className="rounded-3xl bg-white p-5 ring-1 ring-line">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[.16em] text-slate-500 uppercase"><Target className="size-4 text-kenya-green" /> County target</p>
          <p className="mt-3 font-display text-4xl font-extrabold text-navy-900 tabular-nums">{num(p.target_total)}</p>
          <p className="mt-1 text-sm text-slate-500"><b className="text-navy-900">{num(p.achieved)}</b> captured so far · <b className="text-navy-900">{num(Math.max(p.target_total - p.achieved, 0))}</b> to go</p>
          <p className="mt-3 text-xs text-slate-500">The total of all ward targets. Change it under Targets &amp; Captures → Plan targets.</p>
        </div>

        {/* Today vs plan */}
        <div className={cn("rounded-3xl p-5 ring-1", p.vs_plan == null ? "bg-white ring-line" : ahead ? "bg-kenya-green-50 ring-kenya-green/25" : "bg-red-50 ring-kenya-red/25")}>
          <p className="flex items-center gap-2 text-xs font-bold tracking-[.16em] text-slate-500 uppercase"><CalendarDays className="size-4 text-ocean" /> Today against the plan</p>
          {p.vs_plan == null ? <p className="mt-3 text-sm text-slate-600">Build a plan below to track this.</p> : (
            <>
              <p className={cn("mt-3 flex items-center gap-2 font-display text-4xl font-extrabold tabular-nums", ahead ? "text-kenya-green" : "text-kenya-red")}>
                {ahead ? <TrendingUp className="size-8" /> : <TrendingDown className="size-8" />}{ahead ? "+" : "−"}{num(Math.abs(p.vs_plan))}
              </p>
              <p className="mt-1 text-sm text-slate-600">{ahead ? "ahead of" : "behind"} plan · planned by today <b className="text-navy-900">{num(p.planned_by_today)}</b>, actual <b className="text-navy-900">{num(p.achieved)}</b></p>
            </>
          )}
        </div>
      </div>

      {/* Plan vs actual */}
      {rows.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-2 px-5 pt-5">
            <div><p className="font-bold text-navy-900">Plan against actual</p><p className="text-sm text-slate-500">Everyone captured, week by week, to election day.</p></div>
            <div className="flex gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-navy-900" />Plan</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-kenya-green/40" />Actual</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-kenya-red" />Target</span>
            </div>
          </div>
          <div className="h-72 px-2 pt-3 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs><linearGradient id="pl-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#006b3f" stopOpacity={0.35} /><stop offset="1" stopColor="#006b3f" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="week" tickFormatter={(v: string) => fmt(v)} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                  domain={[0, (max: number) => Math.max(max, p.target_total) * 1.05]} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} labelFormatter={(v) => `Week of ${fmt(String(v))}`}
                  formatter={(v, n) => [num(Number(v)), n === "plan" ? "Planned" : "Actual"]} />
                {p.target_total > 0 && <ReferenceLine y={p.target_total} stroke="#bb1e10" strokeWidth={2} />}
                <Area type="monotone" dataKey="actual" stroke="#006b3f" strokeWidth={2.5} fill="url(#pl-a)" connectNulls={false} />
                <Line type="stepAfter" dataKey="plan" stroke="#0b1f3a" strokeWidth={2} strokeDasharray="6 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Builder */}
      {hq && (
        <Card className="mt-6 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 font-bold text-navy-900"><Sparkles className="size-4 text-gold" /> Build the plan</p>
              <p className="text-sm text-slate-500">
                {p.election_date ? <>Share the remaining <b>{num(Math.max(p.target_total - p.achieved, 0))}</b> over the {weeksToVote.length} weeks to election day. You can edit any week after.</> : "Set election day first."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Plan shape" className="inline-flex rounded-xl bg-slate-100 p-1">
                {([["even", "Even"], ["ramp", "Build up"], ["front", "Early push"]] as const).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={shape === k} onClick={() => setShape(k)}
                    className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", shape === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-500")}>{l}</button>
                ))}
              </div>
              <Button variant="secondary" disabled={!p.election_date || !weeksToVote.length} onClick={build}>Fill the weeks</Button>
            </div>
          </div>
          {draft && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-50 px-4 py-3 ring-1 ring-gold/30">
              <p className="text-sm text-navy-900">Draft: <b>{num(draft.reduce((a, w) => a + w.target, 0))}</b> across {draft.length} weeks. Nothing is saved yet.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
                <Button size="sm" icon={<Check className="size-3.5" />} loading={save.isPending}
                  onClick={async () => { if (await confirm({ title: "Save this plan?", body: "It replaces the current weekly plan.", confirmLabel: "Save plan" })) save.mutate(draft); }}>Save plan</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Weeks */}
      <Card className="mt-6 overflow-hidden">
        <div className="hidden border-b border-line bg-slate-50 px-5 py-2.5 text-xs font-bold tracking-wider text-slate-500 uppercase sm:grid sm:grid-cols-[minmax(0,1.3fr)_7rem_6rem_6rem_minmax(0,1fr)_7rem] sm:gap-4">
          <span>Week</span><span className="text-right">Plan</span><span className="text-right">Per day</span><span className="text-right">Actual</span><span>Progress</span><span>Status</span>
        </div>
        {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">No plan yet. {hq ? "Set election day and press “Fill the weeks”." : "HQ hasn't built one yet."}</p> : (
          <ul className="divide-y divide-line">
            {rows.map((w, i) => {
              const status = w.current ? ["This week", "bg-ocean-50 text-ocean ring-ocean/20"] : !w.past ? ["Upcoming", "bg-slate-100 text-slate-600 ring-slate-200"]
                : (w.actual ?? 0) >= w.target ? ["Hit", "bg-kenya-green-50 text-kenya-green ring-kenya-green/20"] : ["Missed", "bg-red-50 text-kenya-red ring-kenya-red/20"];
              const pct = w.target ? Math.min(((w.actual ?? 0) / w.target) * 100, 100) : 0;
              return (
                <li key={w.week_start} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[minmax(0,1.3fr)_7rem_6rem_6rem_minmax(0,1fr)_7rem]", w.current && "bg-ocean-50/40")}>
                  <span className="col-span-2 font-semibold text-navy-900 sm:col-span-1">
                    <span className="mr-2 font-mono text-xs text-slate-400">W{String(i + 1).padStart(2, "0")}</span>
                    {fmt(w.week_start)} – {fmt(iso(new Date(day(w.week_start).getTime() + 6 * 864e5)))}
                  </span>
                  <span className="text-right">
                    {draft || hq ? (
                      <input inputMode="numeric" aria-label={`Plan for week of ${fmt(w.week_start)}`} value={w.target}
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(/\D/g, "")) || 0;
                          setDraft((cur) => (cur ?? rows.map((r) => ({ week_start: r.week_start, target: r.target }))).map((r) => (r.week_start === w.week_start ? { ...r, target: v } : r)));
                        }}
                        className="h-10 w-full max-w-28 rounded-lg border border-line px-2.5 text-right text-base font-semibold text-navy-900 tabular-nums focus:border-ocean focus:outline-none sm:max-w-none" />
                    ) : <b className="text-navy-900 tabular-nums">{num(w.target)}</b>}
                  </span>
                  <span className="text-right text-sm text-slate-500 tabular-nums"><span className="sm:hidden">≈ </span>{num(Math.round(w.target / 7))}<span className="sm:hidden"> a day</span></span>
                  <span className="text-right text-sm font-semibold text-navy-900 tabular-nums">{w.actual == null ? "—" : num(w.actual)}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-kenya-green" style={{ width: `${pct}%` }} /></span>
                  <span><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", status[1])}>{status[0]}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
