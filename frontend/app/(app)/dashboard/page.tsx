"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/loaders";
import { Card, CardHeader, ErrorState } from "@/components/ui";
import { LiveDot } from "@/components/ui/Motion";
import { useDashboard } from "@/features/dashboard/api";
import { AttentionRadar } from "@/features/dashboard/components/command/AttentionRadar";
import { CommandStage } from "@/features/dashboard/components/command/CommandStage";
import { Heartbeat } from "@/features/dashboard/components/command/Heartbeat";
import { RaceLanes } from "@/features/dashboard/components/command/RaceLanes";
import { InsightCards, LiveActivity } from "@/features/dashboard/components/Mission";
import { useUser } from "@/lib/auth";
import { num } from "@/lib/format";
import { useLive } from "@/lib/live";
import { can } from "@/lib/roles";
import type { InsightCard } from "@/lib/types";

const URGENCY: Record<InsightCard["tone"], number> = { bad: 0, warn: 1, info: 2, good: 3 };

/**
 * Command Centre: four questions, nothing else.
 *   Are we winning? · What needs attention now? · Where? · What's happening right now?
 * Everything deeper lives in Analytics.
 */
export default function CommandCentrePage() {
  const user = useUser();
  const { data: d, isLoading, error, refetch } = useDashboard();
  const { pulse, events, connected } = useLive();
  const hq = can.audit(user.role) || user.role === "viewer";
  const analytics = can.manageUsers(user.role) || user.role === "viewer";

  if (isLoading) return <CommandSkeleton />;
  if (error || !d) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;
  const i = d.insights;
  const attention = [...i.cards].sort((a, b) => URGENCY[a.tone] - URGENCY[b.tone]).slice(0, 3);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[.18em] text-ocean uppercase">Command Centre</p>
          <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Karibu, {user.full_name.split(" ")[0]}</h1>
        </div>
      </header>

      {/* 1 · Are we winning, how fast, and where? */}
      <CommandStage d={d} pulse={pulse} events={events} connected={connected} />

      {/* 2 · What needs attention now, and where? */}
      {i.alerts?.length ? (
        <AttentionRadar alerts={i.alerts} connected={connected} />
      ) : (
        <section aria-labelledby="attention">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="attention" className="text-base font-bold text-navy-900">Needs attention now</h2>
            {analytics && <Link href="/analytics#insights" className="inline-flex items-center gap-1 text-sm font-semibold text-ocean hover:underline">All insights <ArrowRight className="size-4" /></Link>}
          </div>
          <InsightCards cards={attention} featured />
        </section>
      )}

      {/* 3 · Who is winning the race? */}
      <Card className="overflow-hidden">
        <CardHeader title="The race to target" subtitle="Each constituency's runner shows where it is now, and the hollow marker where today's pace takes it by election day." />
        <RaceLanes rows={i.constituencies} />
      </Card>

      {/* 4 · What's happening right now? */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Today's heartbeat" subtitle="Captures per hour, today against yesterday" />
          <Heartbeat today={i.hourly} yesterday={i.hourly_yesterday} />
        </Card>
        {hq ? (
          <Card className="overflow-hidden">
            <CardHeader title="Happening now" subtitle="The latest actions across Mombasa" action={<LiveDot on={connected} className="mt-1" />} />
            <LiveActivity events={events.slice(0, 8)} />
            {analytics && (
              <Link href="/analytics#activity" className="block border-t border-line px-5 py-3 text-center text-sm font-semibold text-ocean hover:bg-slate-50">
                Full activity and call wall
              </Link>
            )}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader title="Your area today" />
            <ul className="divide-y divide-line text-sm">
              {[["Captured today", i.today], ["Verified today", pulse?.verified_today ?? 0], ["Marked voted", pulse?.voted ?? d.ops.voted], ["Messages delivered today", d.ops.delivered_today]].map(([k, v]) => (
                <li key={k as string} className="flex items-center justify-between px-5 py-3"><span className="text-slate-600">{k}</span><b className="text-navy-900 tabular-nums">{num(v as number)}</b></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function CommandSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-[520px] rounded-3xl" />
      <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }).map((_, n) => <Skeleton key={n} className="h-28 rounded-2xl" />)}</div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, n) => <Skeleton key={n} className="h-36 rounded-2xl" />)}</div>
    </div>
  );
}
