"use client";

import { ArrowRight, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

import { Skeleton } from "@/components/loaders";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { LiveDot } from "@/components/ui/Motion";
import { FlagTabs, readHash } from "@/components/ui/FlagTabs";
import { SectionTitle } from "@/components/ui/SectionNav";
import { Avatar } from "@/components/ui/Avatar";
import { useDashboard } from "@/features/dashboard/api";
import { SupporterProfile } from "@/features/analytics/SupporterProfile";
import { TrendStudio } from "@/features/analytics/TrendStudio";
import { CallWall, InsightCards, LiveActivity } from "@/features/dashboard/components/Mission";
import { WardTable } from "@/features/dashboard/components/WardTable";
import { useUser } from "@/lib/auth";
import { num } from "@/lib/format";
import { useLive } from "@/lib/live";
import { can } from "@/lib/roles";

const SECTIONS = [
  { id: "trends", label: "Trends", hint: "Headline numbers and daily captures" },
  { id: "insights", label: "Insights", hint: "What the numbers mean, in plain language" },
  { id: "wards", label: "Wards", hint: "Targets and gaps for every ward" },
  { id: "supporters", label: "Supporters", hint: "Support mix and capture channels" },
  { id: "team", label: "Field team", hint: "Top agents this week" },
  { id: "activity", label: "Live", hint: "Activity feed and call wall" },
] as const;

export default function AnalyticsPage() {
  const user = useUser();
  const { data: d, isLoading, error, refetch } = useDashboard();
  const { events, calls, connected } = useLive();
  const ids = SECTIONS.map((x) => x.id);
  const [tab, setTab] = useState<string>("trends");
  const [switching, setSwitching] = useState(0);
  useEffect(() => {
    setTab(readHash(ids, "trends"));
    const onHash = () => setTab(readHash(ids, "trends"));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids is static
  }, []);
  const go = (id: string) => {
    if (id === tab) return;
    setTab(id);
    setSwitching((n) => n + 1);
    history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!(can.manageUsers(user.role) || user.role === "viewer")) {
    return <Card><EmptyState title="Analytics is for HQ and coordinators" body="Your Command Centre shows everything you need for your area." /></Card>;
  }
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-10 w-56" /><Skeleton className="h-80 rounded-2xl" /></div>;
  if (error || !d) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;

  return (
    <>
      <PageHeader eyebrow="Command" title="Analytics" subtitle="The detail behind the Command Centre. Every figure is live from the campaign database." />
      <FlagTabs tabs={SECTIONS} active={tab} onChange={go} label="Analytics" switching={switching} />

      <div key={tab} id={`panel-${tab}`} role="tabpanel" className="tab-in">
        {tab === "trends" && (
        <section id="trends" className="scroll-mt-36 space-y-4">
          <SectionTitle n={1} title="Trends" hint="How capturing is moving over time, overall and in each constituency." />
          <TrendStudio target={d.overall.target} />
        </section>
        )}

        {tab === "insights" && (
        <section id="insights" className="scroll-mt-36">
          <SectionTitle n={2} title="Insights" hint="What the numbers mean, most urgent first." />
          <InsightCards cards={d.insights.cards} />
        </section>
        )}

        {tab === "wards" && (
        <section id="wards" className="scroll-mt-36">
          <SectionTitle n={3} title="Wards" hint="Targets and gaps for all 30 wards."
            action={<Link href="/targets" className="inline-flex items-center gap-1 text-sm font-semibold text-ocean hover:underline">Full breakdown by polling station <ArrowRight className="size-4" /></Link>} />
          <Card className="overflow-hidden">
            <CardHeader title="Ward targets & gaps" subtitle="Sorted by largest gap. Click a column to re-sort." />
            <WardTable wards={d.wards} />
          </Card>
        </section>
        )}

        {tab === "supporters" && (
        <section id="supporters" className="scroll-mt-36">
          <SectionTitle n={4} title="Supporters" hint="Who our supporters are, and where the next ones will come from." />
          <SupporterProfile />
        </section>
        )}

        {tab === "team" && (
        <section id="team" className="scroll-mt-36">
          <SectionTitle n={5} title="Field team" hint="Who captured the most people in the last 7 days." />
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
        )}

        {tab === "activity" && (
        <section id="activity" className="scroll-mt-36">
          <SectionTitle n={6} title="Live" hint="Everything happening right now, as it happens." />
          <div className="grid gap-6 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Live activity" action={<LiveDot on={connected} className="mt-1" />} />
            <LiveActivity events={events} />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Call centre, live" subtitle="Who is on a call right now" />
            <CallWall calls={calls} />
          </Card>
          </div>
        </section>
        )}
      </div>
    </>
  );
}
