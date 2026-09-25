"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, LocateFixed, MapPin, Trophy, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

import { Skeleton, Spinner } from "@/components/loaders";
import { Card, EmptyState, ErrorState, StatusBadge } from "@/components/ui";
import { CountUp, Ring } from "@/components/ui/Motion";
import { useBoundaries, useMapOverview } from "@/features/map/api";
import type { Layers } from "@/features/map/CoverageMap";
import { QuickVisitModal } from "@/features/visits/QuickVisit";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num, timeAgo } from "@/lib/format";
import type { VoterStatus } from "@/lib/types";

const CoverageMap = dynamic(() => import("@/features/map/CoverageMap").then((m) => m.CoverageMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-100"><Spinner /></div>,
});
const LAYERS: Layers = { wards: true, visited: true, stations: true, visits: true, labels: true };

type Area = {
  ward: { id: string; name: string; constituency: string; target: number; captured: number; today: number; week: number; gap: number; percent: number | null; visits_done: number };
  me: { total: number; today: number; week: number; verified: number };
  rank: { position: number | null; of: number; top: { name: string; week: number; me: boolean }[] };
  visits_today: { id: string; title: string; venue: string; at: string; status: string }[];
  recent: { id: string; reference: string; full_name: string; status: VoterStatus; at: string }[];
};

/**
 * A field agent's own workspace: their ward and their work, nothing campaign-wide.
 * Two big actions (capture, "I'm here now"), how the ward is doing, where they stand
 * among the team this week, today's visits and a map of the ward.
 */
export default function MyAreaPage() {
  const user = useUser();
  const [quick, setQuick] = useState(false);
  const q = useQuery({ queryKey: ["my-area"], queryFn: () => api<Area>("/dashboard/my-area"), refetchInterval: 30_000 });
  const overview = useMapOverview();
  const boundaries = useBoundaries();

  if (q.error) return <Card><ErrorState error={q.error} onRetry={q.refetch} /></Card>;
  const a = q.data;
  if (!a) return <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-56 rounded-3xl" /><Skeleton className="h-28 rounded-3xl" /></div>;
  const first = user.full_name.split(" ")[0];

  return (
    <div className="space-y-5">
      <header>
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[.18em] text-ocean uppercase"><MapPin className="size-3.5" />{a.ward.name} · {a.ward.constituency}</p>
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Habari, {first}</h1>
      </header>

      {/* Ward + me */}
      <section className="relative overflow-hidden rounded-3xl bg-[#06101f] p-5 text-white shadow-[0_24px_50px_-28px_rgba(6,16,31,.8)] sm:p-6">
        <div aria-hidden className="absolute inset-x-0 top-0 flex h-1.5"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-kenya-green/25 blur-3xl" />
        <div className="relative grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <div className="flex items-center gap-4">
            <Ring percent={a.ward.percent ?? 0} size={104} stroke={10}>
              <span className="font-display text-lg font-bold">{a.ward.percent == null ? "—" : `${Math.round(a.ward.percent)}%`}</span>
            </Ring>
            <div>
              <p className="text-xs font-semibold tracking-[.16em] text-gold uppercase">{a.ward.name} ward</p>
              <p className="font-display text-3xl font-extrabold tabular-nums"><CountUp value={a.ward.captured} /></p>
              <p className="text-sm text-slate-300">of {num(a.ward.target)} target · {num(a.ward.gap)} to go</p>
              <p className="text-xs text-slate-400">Team today +{num(a.ward.today)} · {num(a.ward.visits_done)} visits done</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {([["Today", a.me.today], ["This week", a.me.week], ["All time", a.me.total], ["Verified", a.me.verified]] as const).map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-white/[.06] px-1 py-3 ring-1 ring-white/[.08]">
                <p className="font-display text-2xl font-bold tabular-nums">{num(v)}</p>
                <p className="text-xs text-slate-400">{k}</p>
              </div>
            ))}
            <p className="col-span-4 text-left text-xs text-slate-400">Your captures</p>
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/voters/new" className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-gold to-[#a8861a] px-3 py-4 text-[15px] font-bold whitespace-nowrap text-navy-950 sm:text-base shadow-[0_12px_28px_-12px_rgba(201,162,39,.9)] active:scale-[.98]">
          <UserPlus className="size-5" /> Capture voter
        </Link>
        <button onClick={() => setQuick(true)} className="flex items-center justify-center gap-2 rounded-2xl bg-kenya-green px-3 py-4 text-[15px] font-bold whitespace-nowrap text-white sm:text-base shadow-[0_12px_28px_-12px_rgba(0,107,63,.9)] active:scale-[.98]">
          <LocateFixed className="size-5" /> I&apos;m here now
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Rank */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-navy-900"><Trophy className="size-4 text-gold" /> This week in {a.ward.name}</p>
          {a.rank.position ? (
            <p className="mt-2 text-sm text-slate-600">You&apos;re <b className="font-display text-2xl text-navy-900">#{a.rank.position}</b> of {a.rank.of} {a.rank.of === 1 ? "agent" : "agents"}</p>
          ) : <p className="mt-2 text-sm text-slate-600">Capture someone this week to join the board.</p>}
          <ol className="mt-3 space-y-2">
            {a.rank.top.map((r, i) => (
              <li key={i} className={cn("flex items-center gap-3 rounded-xl px-3 py-2", r.me ? "bg-gold-50 ring-1 ring-gold/30" : "bg-slate-50")}>
                <span className={cn("grid size-7 place-items-center rounded-full text-xs font-bold", i === 0 ? "bg-gold text-navy-950" : "bg-white text-slate-600 ring-1 ring-line")}>{i + 1}</span>
                <span className="flex-1 text-sm font-semibold text-navy-900">{r.me ? "You" : r.name}</span>
                <span className="font-display font-bold text-navy-900 tabular-nums">{num(r.week)}</span>
              </li>
            ))}
          </ol>
        </Card>

        {/* Today's visits */}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-navy-900"><CalendarCheck className="size-4 text-kenya-green" /> Today&apos;s visits</p>
          {a.visits_today.length ? (
            <ul className="mt-3 divide-y divide-line">
              {a.visits_today.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5">
                  <span className="rounded-lg bg-navy-950 px-2 py-1 font-mono text-xs font-bold text-gold">{v.at}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-navy-900">{v.title}</span><span className="block truncate text-xs text-slate-500">{v.venue}</span></span>
                  <Link href="/visits" className="text-xs font-bold text-ocean hover:underline">{v.status === "scheduled" ? "Check in" : "Open"}</Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">No visits planned in your ward today. Use “I&apos;m here now” when you&apos;re out.</p>}
        </Card>
      </div>

      {/* Ward map */}
      <Card className="overflow-hidden">
        <div className="px-5 pt-4 pb-3"><p className="text-sm font-bold text-navy-900">Your ward</p><p className="text-xs text-slate-500">Places the team has been, and the polling stations.</p></div>
        <div className="relative h-72 bg-slate-100 sm:h-80">
          {overview.data && boundaries.data ? (
            <CoverageMap data={overview.data} boundaries={boundaries.data} layers={LAYERS} selected={a.ward.id} onSelect={() => {}} mode="visits" fitWard={a.ward.id} />
          ) : <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
        </div>
      </Card>

      {/* Recent */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <p className="text-sm font-bold text-navy-900">Your latest captures</p>
          <Link href="/voters" className="text-xs font-bold text-ocean hover:underline">See all</Link>
        </div>
        {a.recent.length ? (
          <ul className="divide-y divide-line">
            {a.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/voters/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-navy-900">{r.full_name}</span><span className="text-xs text-slate-500">{r.reference} · {timeAgo(r.at)}</span></span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No captures yet" body="Your first capture will show here." />}
      </Card>

      {quick && <QuickVisitModal onClose={() => setQuick(false)} />}
    </div>
  );
}
