"use client";

import { Trophy } from "lucide-react";

import { Skeleton } from "@/components/loaders";
import { Card, CardHeader, ErrorState, SOURCE_LABEL, SUPPORT } from "@/components/ui";
import { useDashboard } from "@/features/dashboard/api";
import { BarList } from "@/features/dashboard/components/BarList";
import { DailyChart } from "@/features/dashboard/components/DailyChart";
import {
  CallWall,
  ConstituencyLeague,
  Delta,
  InsightCards,
  KpiTile,
  LiveActivity,
  MissionHero,
} from "@/features/dashboard/components/Mission";
import { WardTable } from "@/features/dashboard/components/WardTable";
import { LiveDot } from "@/components/ui/Motion";
import { useUser } from "@/lib/auth";
import { num, pct } from "@/lib/format";
import { useLive } from "@/lib/live";
import { can } from "@/lib/roles";
import type { Source, Support } from "@/lib/types";

export default function DashboardPage() {
  const user = useUser();
  const { data: d, isLoading, error, refetch } = useDashboard();
  const { pulse, events, calls, connected } = useLive();
  const firstName = user.full_name.split(" ")[0];
  const hq = can.audit(user.role) || user.role === "viewer";
  const supervisor = can.manageUsers(user.role) || user.role === "viewer";

  if (isLoading) return <DashboardSkeleton />;
  if (error || !d) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;
  const i = d.insights;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="animate-fade-up">
          <p className="text-xs font-semibold tracking-[.18em] text-ocean uppercase">Mission control</p>
          <h1 className="text-2xl font-extrabold text-navy-900 sm:text-[28px]">Karibu, {firstName}</h1>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 ring-1 ring-line">
          <LiveDot on={connected} className="size-2" /> {connected ? "Live across all wards" : "Reconnecting to live data…"}
        </span>
      </div>

      <MissionHero d={d} pulse={pulse} connected={connected} />

      <section>
        <h2 className="mb-3 text-sm font-bold tracking-wide text-navy-900">What the numbers are saying</h2>
        <InsightCards cards={i.cards} />
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Captured today" value={pulse?.captures_today ?? i.today} spark={i.hourly} foot={<Delta now={i.today} before={i.yesterday_same_time} suffix=" vs yday" />} />
        <KpiTile label="This week" value={i.last7} spark={d.daily.slice(-7).map((x) => x.count)} sparkColor="#0b7fa6" foot={<Delta now={i.last7} before={i.prev7} suffix=" vs last wk" />} />
        <KpiTile label="Verified supporters" value={d.totals.verified} href="/verification"
          foot={<span className="text-xs text-muted">{pct(d.totals.achieved ? (d.totals.verified / d.totals.achieved) * 100 : null)} of live records</span>} />
        <KpiTile label="Awaiting verification" value={d.totals.pending} href="/verification"
          foot={<span className={`text-xs font-semibold ${(i.backlog_days ?? 99) > 7 ? "text-amber-700" : "text-muted"}`}>{i.backlog_days != null && i.backlog_days <= 60 ? `≈${Math.round(i.backlog_days)} days to clear` : "Needs call-centre focus"}</span>} />
        <KpiTile label="Messages today" value={pulse?.messages_today ?? d.ops.messages_today} href="/messaging"
          foot={<span className="text-xs text-muted">{num(d.ops.delivered_today)} delivered</span>} />
        <KpiTile label="Calls today" value={pulse?.calls_today ?? d.ops.calls_today} href="/calls"
          foot={<span className="text-xs text-muted">{num(d.ops.answered_today)} answered · {num(pulse?.on_call ?? 0)} live now</span>} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Constituency league" subtitle="Ranked by progress. The light shows whether current pace reaches the target by election day." />
          <ConstituencyLeague rows={i.constituencies} />
        </Card>
        {hq ? (
          <Card className="overflow-hidden">
            <CardHeader title="Live activity" subtitle="Everything the team is doing, as it happens" action={<LiveDot on={connected} className="mt-1" />} />
            <LiveActivity events={events} />
          </Card>
        ) : (
          <Card>
            <CardHeader title="Daily captures" subtitle="Last 14 days" />
            <div className="p-4"><DailyChart data={d.daily} /></div>
          </Card>
        )}
      </div>

      {supervisor && (
        <Card className="overflow-hidden">
          <CardHeader title="Call centre, live" subtitle="Who is on a call right now" action={<span className="text-xs font-semibold text-kenya-green">{num(pulse?.on_call ?? 0)} on calls</span>} />
          <CallWall calls={calls} />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        {hq && (
          <Card>
            <CardHeader title="Daily captures" subtitle="Last 14 days, all channels" />
            <div className="p-4"><DailyChart data={d.daily} /></div>
          </Card>
        )}
        <Card className={hq ? "" : "xl:col-span-2"}>
          <CardHeader title="Top field agents" subtitle="Last 7 days" />
          {d.top_agents.length ? (
            <ol className="space-y-3 p-5">
              {d.top_agents.map((a, idx) => (
                <li key={a.id} className="flex items-center gap-3">
                  <span className={`grid size-8 place-items-center rounded-full text-xs font-bold ${idx === 0 ? "bg-gold text-navy-950" : "bg-slate-100 text-slate-600"}`}>
                    {idx === 0 ? <Trophy className="size-4" /> : idx + 1}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-navy-900">{a.name}</span>
                  <span className="text-sm font-semibold text-navy-900 tabular-nums">{num(a.count)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="p-5 text-sm text-muted">No field captures this week yet.</p>}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Ward targets & gaps" subtitle="Sorted by largest gap. Click a column to re-sort." />
          <WardTable wards={d.wards} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Support mix" />
            <div className="p-5">
              <BarList color="bg-kenya-green" rows={(Object.keys(SUPPORT) as Support[]).map((s) => ({ key: s, label: SUPPORT[s][1], value: d.by_support[s] ?? 0 }))} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Capture channel" />
            <div className="p-5">
              <BarList color="bg-ocean" rows={(Object.keys(SOURCE_LABEL) as Source[]).map((s) => ({ key: s, label: SOURCE_LABEL[s], value: d.by_source[s] ?? 0 }))} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-64 rounded-3xl" />
      <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
    </div>
  );
}
