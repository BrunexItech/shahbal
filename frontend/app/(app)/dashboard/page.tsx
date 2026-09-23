"use client";

import { CalendarCheck2, ClipboardCheck, ShieldCheck, Trophy, UsersRound } from "lucide-react";

import { Skeleton, SkeletonCards } from "@/components/loaders";
import { Card, CardHeader, ErrorState, PageHeader, ProgressBar, SOURCE_LABEL, SUPPORT } from "@/components/ui";
import { useDashboard } from "@/features/dashboard/api";
import { BarList } from "@/features/dashboard/components/BarList";
import { DailyChart } from "@/features/dashboard/components/DailyChart";
import { LiveFeed } from "@/features/dashboard/components/LiveFeed";
import { StatTile } from "@/features/dashboard/components/StatTile";
import { TargetHero } from "@/features/dashboard/components/TargetHero";
import { WardTable } from "@/features/dashboard/components/WardTable";
import { useUser } from "@/lib/auth";
import { num, pct } from "@/lib/format";
import type { Source, Support } from "@/lib/types";

export default function DashboardPage() {
  const user = useUser();
  const { data: d, isLoading, error, refetch } = useDashboard();
  const firstName = user.full_name.split(" ")[0];

  return (
    <>
      <PageHeader eyebrow="War room" title={`Karibu, ${firstName}`} subtitle="Live picture of the campaign across your area. Refreshes every 20 seconds." />

      {isLoading ? (
        <DashboardSkeleton />
      ) : error || !d ? (
        <Card><ErrorState error={error} onRetry={refetch} /></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[1.25fr_2fr]">
            <TargetHero overall={d.overall} verified={d.totals.verified} />
            <div className="grid grid-cols-2 gap-4">
              <StatTile label="Total captured" value={num(d.totals.total)} icon={<UsersRound className="size-[18px]" />}
                sub={<>{num(d.totals.rejected)} rejected · {num(d.totals.opted_out)} opted out</>} />
              <StatTile label="Captured today" value={num(d.totals.today)} accent="ocean" icon={<CalendarCheck2 className="size-[18px]" />} sub="Since midnight (EAT)" />
              <StatTile label="Verified" value={num(d.totals.verified)} accent="green" icon={<ShieldCheck className="size-[18px]" />}
                sub={`${pct(d.totals.achieved ? (d.totals.verified / d.totals.achieved) * 100 : null)} of live records`} />
              <StatTile label="Awaiting verification" value={num(d.totals.pending)} accent="gold" icon={<ClipboardCheck className="size-[18px]" />} sub="In the call-back queue" />
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader title="Daily captures" subtitle="Last 14 days, all channels" />
              <div className="p-4"><DailyChart data={d.daily} /></div>
            </Card>
            <Card>
              <CardHeader title="Constituency progress" subtitle="Achieved against target" />
              <ul className="space-y-4 p-5">
                {d.constituencies.map((c) => (
                  <li key={c.id}>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-semibold text-navy-900">{c.name}</span>
                      <span className="text-xs text-muted tabular-nums">{num(c.achieved)} / {c.target ? num(c.target) : "—"} · <b className="text-navy-900">{pct(c.percent)}</b></span>
                    </div>
                    <ProgressBar percent={c.percent} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader title="Ward targets & gaps" subtitle="Sorted by largest gap. Click a column to re-sort." />
              <WardTable wards={d.wards} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="Live feed" subtitle="Latest captures" action={<span className="relative mt-1 flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-kenya-green opacity-60" /><span className="relative size-2.5 rounded-full bg-kenya-green" /></span>} />
              <LiveFeed items={d.recent} />
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
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
            <Card>
              <CardHeader title="Top agents" subtitle="Last 7 days" />
              {d.top_agents.length ? (
                <ol className="space-y-3 p-5">
                  {d.top_agents.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <span className={`grid size-8 place-items-center rounded-full text-xs font-bold ${i === 0 ? "bg-gold text-navy-950" : "bg-slate-100 text-slate-600"}`}>
                        {i === 0 ? <Trophy className="size-4" /> : i + 1}
                      </span>
                      <span className="flex-1 truncate text-sm font-medium text-navy-900">{a.name}</span>
                      <span className="text-sm font-semibold text-navy-900 tabular-nums">{num(a.count)}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="p-5 text-sm text-muted">No field captures this week yet.</p>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.25fr_2fr]">
        <Skeleton className="h-56 rounded-2xl" />
        <SkeletonCards count={4} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
