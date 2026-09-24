"use client";

import { Trophy } from "lucide-react";

import { Skeleton } from "@/components/loaders";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, SOURCE_LABEL, SUPPORT } from "@/components/ui";
import { LiveDot } from "@/components/ui/Motion";
import { Avatar } from "@/components/ui/Avatar";
import { useDashboard } from "@/features/dashboard/api";
import { BarList } from "@/features/dashboard/components/BarList";
import { DailyChart } from "@/features/dashboard/components/DailyChart";
import { CallWall, InsightCards, KpiTile, LiveActivity } from "@/features/dashboard/components/Mission";
import { WardTable } from "@/features/dashboard/components/WardTable";
import { useUser } from "@/lib/auth";
import { num, pct } from "@/lib/format";
import { useLive } from "@/lib/live";
import { can } from "@/lib/roles";
import type { Source, Support } from "@/lib/types";

const SECTIONS = [["trends", "Trends"], ["insights", "Insights"], ["wards", "Wards"], ["supporters", "Supporters"], ["team", "Field team"], ["activity", "Live"]] as const;

export default function AnalyticsPage() {
  const user = useUser();
  const { data: d, isLoading, error, refetch } = useDashboard();
  const { events, calls, connected, pulse } = useLive();

  if (!(can.manageUsers(user.role) || user.role === "viewer")) {
    return <Card><EmptyState title="Analytics is for HQ and coordinators" body="Your Command Centre shows everything you need for your area." /></Card>;
  }
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-10 w-56" /><Skeleton className="h-80 rounded-2xl" /></div>;
  if (error || !d) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;

  return (
    <>
      <PageHeader eyebrow="Command" title="Analytics" subtitle="The detail behind the Command Centre. Every figure is live from the campaign database." />
      <nav className="sticky top-16 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line bg-canvas/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-white/90 sm:px-2">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-slate-100 hover:text-navy-900">{label}</a>
        ))}
      </nav>

      <div className="space-y-8">
        <section id="trends" className="scroll-mt-32 space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile cap="green" label="Verified supporters" value={d.totals.verified} foot={<span className="text-xs text-muted">{pct(d.totals.achieved ? (d.totals.verified / d.totals.achieved) * 100 : null)} of live records</span>} />
            <KpiTile cap="ocean" label="Messages today" value={pulse?.messages_today ?? d.ops.messages_today} foot={<span className="text-xs text-muted">{num(d.ops.delivered_today)} delivered</span>} />
            <KpiTile cap="gold" label="Wards visited" value={`${d.ops.wards_visited}/${d.wards.length}`} foot={<span className="text-xs text-muted">{num(d.ops.visits_upcoming)} visits planned</span>} />
            <KpiTile cap="red" label="Opted out" value={d.totals.opted_out} foot={<span className="text-xs text-muted">Never messaged again</span>} />
          </div>
          <Card>
            <CardHeader title="Daily captures" subtitle="Last 14 days, all channels" />
            <div className="p-4"><DailyChart data={d.daily} /></div>
          </Card>
        </section>

        <section id="insights" className="scroll-mt-32">
          <h2 className="mb-3 text-base font-bold text-navy-900">All insights</h2>
          <InsightCards cards={d.insights.cards} />
        </section>

        <section id="wards" className="scroll-mt-32">
          <Card className="overflow-hidden">
            <CardHeader title="Ward targets & gaps" subtitle="Sorted by largest gap. Click a column to re-sort." />
            <WardTable wards={d.wards} />
          </Card>
        </section>

        <section id="supporters" className="grid scroll-mt-32 gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title="Support mix" />
            <div className="p-5"><BarList color="bg-kenya-green" rows={(Object.keys(SUPPORT) as Support[]).map((s) => ({ key: s, label: SUPPORT[s][1], value: d.by_support[s] ?? 0 }))} /></div>
          </Card>
          <Card>
            <CardHeader title="Capture channel" />
            <div className="p-5"><BarList color="bg-ocean" rows={(Object.keys(SOURCE_LABEL) as Source[]).map((s) => ({ key: s, label: SOURCE_LABEL[s], value: d.by_source[s] ?? 0 }))} /></div>
          </Card>
        </section>

        <section id="team" className="scroll-mt-32">
          <Card>
            <CardHeader title="Top field agents" subtitle="Captures in the last 7 days" />
            {d.top_agents.length ? (
              <ol className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
                {d.top_agents.map((a, idx) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-line">
                    <div className="relative">
                      <Avatar userId={a.id} name={a.name} size={44} />
                      {idx === 0 && <Trophy className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-gold p-0.5 text-navy-950" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy-900">{a.name}</p>
                      <p className="text-xs text-muted">{num(a.count)} captures</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="p-5 text-sm text-muted">No field captures this week yet.</p>}
          </Card>
        </section>

        <section id="activity" className="grid scroll-mt-32 gap-6 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Live activity" action={<LiveDot on={connected} className="mt-1" />} />
            <LiveActivity events={events} />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Call centre, live" subtitle="Who is on a call right now" />
            <CallWall calls={calls} />
          </Card>
        </section>
      </div>
    </>
  );
}
