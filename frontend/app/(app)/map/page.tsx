"use client";

import { ArrowRight, Layers as LayersIcon, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Skeleton, Spinner } from "@/components/loaders";
import { Badge, Card, ErrorState, PageHeader, ProgressBar } from "@/components/ui";
import { useBoundaries, useMapOverview } from "@/features/map/api";
import { RAMP, type Layers } from "@/features/map/CoverageMap";
import { cn } from "@/lib/cn";
import { dateTime, num, pct } from "@/lib/format";

// MapLibre needs the browser (WebGL), so the map is client-only.
const CoverageMap = dynamic(() => import("@/features/map/CoverageMap").then((m) => m.CoverageMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-100"><Spinner size="lg" /></div>,
});

const LAYER_LABELS: [keyof Layers, string][] = [
  ["wards", "Ward progress"],
  ["visited", "Visited wards"],
  ["stations", "Polling stations"],
  ["visits", "Campaign visits"],
  ["labels", "Ward names"],
];

export default function MapPage() {
  const overview = useMapOverview();
  const boundaries = useBoundaries();
  const [layers, setLayers] = useState<Layers>({ wards: true, visited: true, stations: true, visits: true, labels: true });
  const [selected, setSelected] = useState<string | null>(null);

  const ward = overview.data?.wards.find((w) => w.id === selected) ?? null;
  const behind = useMemo(
    () => [...(overview.data?.wards ?? [])].filter((w) => w.target).sort((a, b) => b.gap - a.gap).slice(0, 8),
    [overview.data],
  );
  const visited = overview.data?.wards.filter((w) => w.visits_completed > 0).length ?? 0;

  return (
    <>
      <PageHeader eyebrow="Command" title="Coverage map"
        subtitle="Where the campaign is strong, where it has been, and where it needs to go next. Updates every 30 seconds." />
      {overview.error || boundaries.error ? (
        <Card><ErrorState error={overview.error ?? boundaries.error} onRetry={() => { overview.refetch(); boundaries.refetch(); }} /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <Card className="relative h-[calc(100vh-230px)] min-h-[520px] overflow-hidden">
            {overview.data && boundaries.data ? (
              <CoverageMap data={overview.data} boundaries={boundaries.data} layers={layers} selected={selected} onSelect={setSelected} />
            ) : (
              <Skeleton className="absolute inset-0 rounded-none" />
            )}
            {overview.data && (
              <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-2">
                <Badge tone="navy" className="pointer-events-auto shadow-lg">{visited} / {overview.data.wards.length} wards visited</Badge>
                <Badge tone="slate" className="pointer-events-auto bg-white shadow-lg">{overview.data.stations.length} stations mapped</Badge>
              </div>
            )}
          </Card>

          <div className="space-y-4">
            {ward ? (
              <Card className="animate-fade-up overflow-hidden">
                <div className="flex items-start justify-between gap-3 bg-navy-950 px-5 py-4 text-white">
                  <div>
                    <p className="text-[11px] font-semibold tracking-wider text-gold uppercase">{ward.constituency}</p>
                    <p className="font-display text-xl font-bold">{ward.name}</p>
                  </div>
                  <button onClick={() => setSelected(null)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close ward details">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="space-y-4 p-5">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-semibold text-navy-900">{num(ward.achieved)} / {ward.target ? num(ward.target) : "—"}</span>
                      <span className="text-xs font-semibold text-navy-900">{pct(ward.percent)}</span>
                    </div>
                    <ProgressBar percent={ward.percent} />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ["Gap", num(ward.gap)],
                      ["Verified", num(ward.verified)],
                      ["Supporters", num(ward.supporters)],
                      ["Registered (IEBC)", num(ward.registered_voters)],
                      ["Visits done", num(ward.visits_completed)],
                      ["Visits planned", num(ward.visits_upcoming)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-line">
                        <dt className="text-[11px] text-muted">{k}</dt>
                        <dd className="font-display text-lg font-bold text-navy-900 tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted">Last visit: {ward.last_visit_at ? dateTime(ward.last_visit_at) : "never"}</p>
                  <div className="flex gap-2">
                    <Link href={`/voters?ward=${ward.id}`} className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-navy-900 hover:bg-slate-200">Voters</Link>
                    <Link href="/visits" className="flex-1 rounded-xl bg-kenya-green px-3 py-2 text-center text-xs font-semibold text-white hover:bg-kenya-green-600">Plan a visit</Link>
                  </div>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <p className="text-sm font-semibold text-navy-900">Furthest behind target</p>
                  <span className="text-[11px] text-muted">Click to focus</span>
                </div>
                <ul className="divide-y divide-line">
                  {behind.map((w) => (
                    <li key={w.id}>
                      <button onClick={() => setSelected(w.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-navy-900">{w.name}</p>
                          <ProgressBar percent={w.percent} thin className="mt-1.5" />
                        </div>
                        <span className="text-xs font-semibold text-kenya-red tabular-nums">−{num(w.gap)}</span>
                        <ArrowRight className="size-3.5 text-slate-300" />
                      </button>
                    </li>
                  ))}
                  {!behind.length && <li className="px-5 py-6 text-center text-sm text-muted">Set ward targets to see gaps here.</li>}
                </ul>
              </Card>
            )}

            <Card className="p-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-navy-900"><LayersIcon className="size-4" /> Layers</p>
              <div className="space-y-2">
                {LAYER_LABELS.map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center justify-between rounded-lg px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
                    {label}
                    <button type="button" role="switch" aria-checked={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
                      className={cn("relative h-5 w-9 rounded-full transition", layers[k] ? "bg-kenya-green" : "bg-slate-300")}>
                      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", layers[k] ? "left-[18px]" : "left-0.5")} />
                    </button>
                  </label>
                ))}
              </div>

              <p className="mt-5 mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Progress to target</p>
              <div className="flex h-2.5 overflow-hidden rounded-full">
                {RAMP.map(([stop, color]) => <span key={stop} className="flex-1" style={{ background: color }} />)}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted tabular-nums"><span>0%</span><span>50%</span><span>100%+</span></div>
              <ul className="mt-4 space-y-1.5 text-xs text-slate-700">
                <li className="flex items-center gap-2"><span className="h-2.5 w-5 rounded-sm bg-slate-200" /> No target set</li>
                <li className="flex items-center gap-2"><span className="h-0 w-5 border-t-[3px] border-gold" /> Ward visited by the team</li>
                <li className="flex items-center gap-2"><span className="size-3 rounded-full bg-navy-900 ring-2 ring-white" /> Polling station (size = captures)</li>
                <li className="flex items-center gap-2"><span className="size-3 rounded-full bg-gold ring-2 ring-white" /> Upcoming visit</li>
                <li className="flex items-center gap-2"><span className="size-3 rounded-full bg-kenya-green ring-2 ring-white" /> Completed visit</li>
              </ul>
              <p className="mt-4 text-[10px] leading-relaxed text-muted">Ward boundaries: IEBC. Base map © OpenFreeMap, © OpenStreetMap contributors.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
