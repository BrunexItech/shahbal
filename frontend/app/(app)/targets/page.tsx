"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { Skeleton } from "@/components/loaders";
import { Card, ErrorState, PageHeader } from "@/components/ui";
import { useBreakdown } from "@/features/dashboard/api";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { ConstituencyCards } from "@/features/targets/ConstituencyCards";
import { CountyBand } from "@/features/targets/CountyBand";
import { pctLabel } from "@/features/targets/status";
import { WardList, type WardRow } from "@/features/targets/WardList";
import { useUser } from "@/lib/auth";
import { num } from "@/lib/format";
import { can } from "@/lib/roles";

/**
 * Targets & captures: who has been captured where, read top-down.
 *   County → constituency (cards) → ward (ranked bars) → polling station (drill-down).
 */
export default function TargetsPage() {
  const user = useUser();
  const { data, isLoading, error, refetch } = useBreakdown();
  const [selected, setSelected] = useState<string | null>(null);

  const cons = data?.constituencies.find((c) => c.id === selected) ?? null;
  const wards = useMemo<WardRow[]>(() => (data?.constituencies ?? [])
    .filter((c) => !selected || c.id === selected)
    .flatMap((c) => c.wards.map((w) => ({ ...w, constituency: c.name }))), [data, selected]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-52 rounded-3xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
      </div>
    );
  }
  if (error || !data) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;
  const countyPct = data.county.percent;

  return (
    <>
      <PageHeader eyebrow="Planning" title="Targets & captures"
        subtitle="How many people have been captured in each constituency, ward and polling station, against target. Live." />

      <div className="space-y-8">
        <CountyBand county={data.county} />

        <section aria-labelledby="by-constituency">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="by-constituency" className="text-lg font-bold text-navy-900">By constituency</h2>
              <p className="text-sm text-slate-500">Select one to see its wards. Each small square is a ward.</p>
            </div>
          </div>
          <ConstituencyCards rows={data.constituencies} countyPercent={countyPct} selected={selected} onSelect={setSelected} />
        </section>

        <section aria-labelledby="by-ward">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
              <div className="min-w-0">
                <h2 id="by-ward" className="flex items-center gap-2 text-lg font-bold text-navy-900">
                  {cons && <span className="size-3 rounded-full" style={{ background: CONSTITUENCY_COLORS[cons.name] ?? "#94a3b8" }} />}
                  {cons ? `Wards in ${cons.name}` : "All 30 wards"}
                </h2>
                <p className="text-sm text-slate-500 tabular-nums">
                  {num(wards.reduce((a, w) => a + w.captured, 0))} captured of {num(wards.reduce((a, w) => a + w.target, 0))}
                  {cons && ` · ${pctLabel(cons.percent)}`} · tap a ward for its polling stations
                </p>
              </div>
              {cons && (
                <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-navy-900 hover:bg-slate-200">
                  <X className="size-3.5" /> Show all wards
                </button>
              )}
            </div>
            <WardList wards={wards} countyPercent={countyPct} editable={can.setTargets(user.role)} showConstituency={!cons} />
          </Card>
        </section>
      </div>
    </>
  );
}
