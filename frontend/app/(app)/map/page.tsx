"use client";

import { Layers as LayersIcon, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Skeleton, Spinner } from "@/components/loaders";
import { Card, ErrorState, PageHeader, ProgressBar } from "@/components/ui";
import { KpiTile } from "@/features/dashboard/components/Mission";
import { useBoundaries, useMapOverview } from "@/features/map/api";
import { RAMP, VISIT_STEPS, type Layers, type MapMode } from "@/features/map/CoverageMap";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { cn } from "@/lib/cn";
import { dateTime, num, pct } from "@/lib/format";

// MapLibre needs the browser (WebGL), so the map is client-only.
const CoverageMap = dynamic(() => import("@/features/map/CoverageMap").then((m) => m.CoverageMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-100"><Spinner size="lg" /></div>,
});

const LAYER_LABELS: [keyof Layers, string][] = [
  ["visits", "Places visited"],
  ["stations", "Polling stations"],
  ["labels", "Ward names"],
  ["wards", "Ward shading"],
];

const times = (n: number) => `${num(n)} ${n === 1 ? "time" : "times"}`;

export default function MapPage() {
  const overview = useMapOverview();
  const boundaries = useBoundaries();
  const [mode, setMode] = useState<MapMode>("visits");
  const [layers, setLayers] = useState<Layers>({ wards: true, visited: true, stations: false, visits: true, labels: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: string } | null>(null);

  const d = overview.data;
  const wards = useMemo(() => [...(d?.wards ?? [])].sort((a, b) => b.visits_completed - a.visits_completed || a.name.localeCompare(b.name)), [d]);
  const visitedWards = wards.filter((w) => w.visits_completed > 0);
  const never = wards.filter((w) => w.visits_completed === 0);
  const totalVisits = wards.reduce((a, w) => a + w.visits_completed, 0);
  const maxVisits = Math.max(1, ...wards.map((w) => w.visits_completed));
  const places = d?.places ?? [];
  const ward = d?.wards.find((w) => w.id === selected) ?? null;
  const wardPlaces = ward ? places.filter((p) => p.ward_id === ward.id) : [];
  const fly = (lng: number, lat: number, key: string) => setFocus({ lng, lat, key: `${key}-${Date.now()}` });

  return (
    <>
      <PageHeader eyebrow="Command" title="Coverage map"
        subtitle="Where the team has actually been in Mombasa, how many times, and which wards are still waiting for a visit." />

      {overview.error || boundaries.error ? (
        <Card><ErrorState error={overview.error ?? boundaries.error} onRetry={() => { overview.refetch(); boundaries.refetch(); }} /></Card>
      ) : (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile cap="green" label="Visits completed" value={totalVisits} foot={<span className="text-xs text-muted">All time, across Mombasa</span>} />
            <KpiTile cap="ocean" label="Places visited" value={places.length} foot={<span className="text-xs text-muted">{num(places.filter((p) => p.count > 1).length)} visited more than once</span>} />
            <KpiTile cap="black" label="Wards visited" value={`${visitedWards.length}/${wards.length || 30}`} foot={<span className="text-xs text-muted">{pct(wards.length ? (visitedWards.length / wards.length) * 100 : null)} of the county</span>} />
            <KpiTile cap="red" label="Never visited" value={never.length} foot={<span className="text-xs text-muted">{never.length ? "wards waiting for the team" : "every ward reached"}</span>} />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="relative h-[62vh] min-h-[420px] overflow-hidden xl:h-[calc(100vh-300px)] xl:min-h-[560px]">
              {d && boundaries.data ? (
                <CoverageMap data={d} boundaries={boundaries.data} layers={layers} selected={selected} onSelect={setSelected} focus={focus} mode={mode} />
              ) : (
                <Skeleton className="absolute inset-0 rounded-none" />
              )}
              <div className="absolute top-3 left-3 inline-flex rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-line backdrop-blur" role="tablist" aria-label="Shade wards by">
                {([["visits", "Visits"], ["progress", "Progress to target"]] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                    className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold transition", mode === k ? "bg-navy-900 text-white" : "text-slate-600 hover:text-navy-900")}>
                    {label}
                  </button>
                ))}
              </div>
              <MapLegend mode={mode} />
            </Card>

            <div className="min-w-0 space-y-4">
              {ward ? (
                <Card className="animate-fade-up overflow-hidden">
                  <div className="flex items-start justify-between gap-3 bg-navy-950 px-5 py-4 text-white">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-gold uppercase">
                        <span className="size-2 rounded-full" style={{ background: CONSTITUENCY_COLORS[ward.constituency] ?? "#94a3b8" }} />{ward.constituency}
                      </p>
                      <p className="font-display text-xl font-bold">{ward.name}</p>
                    </div>
                    <button onClick={() => setSelected(null)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close ward details">
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="space-y-4 p-5">
                    <div className="grid grid-cols-2 gap-3">
                      <Stat k="Visits done" v={num(ward.visits_completed)} strong />
                      <Stat k="Visits planned" v={num(ward.visits_upcoming)} />
                    </div>
                    <p className="text-sm text-slate-600">Last visit: <b className="text-navy-900">{ward.last_visit_at ? dateTime(ward.last_visit_at) : "never"}</b></p>
                    {wardPlaces.length > 0 && (
                      <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
                        {wardPlaces.map((p) => (
                          <li key={`${p.lat},${p.lng}`}>
                            <button onClick={() => fly(p.lng, p.lat, p.venue)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
                              <span className="min-w-0 flex-1 truncate text-sm text-navy-900">{p.venue}</span>
                              <span className="rounded-full bg-kenya-green-50 px-2 py-0.5 text-xs font-bold text-kenya-green tabular-nums">×{p.count}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between text-sm">
                        <span className="text-slate-600">Captured <b className="text-navy-900">{num(ward.achieved)}</b> of {ward.target ? num(ward.target) : "—"}</span>
                        <span className="text-xs font-semibold text-navy-900">{pct(ward.percent)}</span>
                      </div>
                      <ProgressBar percent={ward.percent} />
                    </div>
                    <div className="flex gap-2">
                      <Link href="/targets" className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-center text-sm font-semibold text-navy-900 hover:bg-slate-200">Captures</Link>
                      <Link href="/visits" className="flex-1 rounded-xl bg-kenya-green px-3 py-2 text-center text-sm font-semibold text-white hover:bg-kenya-green-600">Plan a visit</Link>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                    <p className="text-sm font-semibold text-navy-900">Visits by ward</p>
                    <span className="text-xs text-muted">Tap to focus</span>
                  </div>
                  {visitedWards.length ? (
                    <ul className="max-h-[340px] divide-y divide-line overflow-y-auto">
                      {visitedWards.map((w) => (
                        <li key={w.id}>
                          <button onClick={() => setSelected(w.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-semibold text-navy-900">{w.name}</span>
                                <span className="shrink-0 text-xs text-slate-500">{times(w.visits_completed)}</span>
                              </span>
                              <span className="mt-1.5 block h-2 rounded-full bg-slate-100">
                                <span className="block h-full rounded-full bg-ocean" style={{ width: `${(w.visits_completed / maxVisits) * 100}%` }} />
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="px-5 py-5 text-sm text-muted">No completed visits yet. Once the team checks in and completes a visit, it's counted here.</p>}
                  {never.length > 0 && (
                    <div className="border-t border-line bg-red-50/40 px-5 py-4">
                      <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wider text-kenya-red uppercase">
                        <span className="size-2 rounded-full bg-kenya-red" /> Not visited yet · {never.length}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {never.map((w) => (
                          <button key={w.id} onClick={() => setSelected(w.id)}
                            className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-navy-900 ring-1 ring-line hover:ring-kenya-red/40">{w.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <p className="text-sm font-semibold text-navy-900">Most visited places</p>
                  <span className="text-xs text-muted">Exact GPS where available</span>
                </div>
                {places.length ? (
                  <ul className="divide-y divide-line">
                    {places.slice(0, 6).map((p) => (
                      <li key={`${p.lat},${p.lng}`}>
                        <button onClick={() => fly(p.lng, p.lat, p.venue)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-kenya-green font-display text-sm font-bold text-white tabular-nums">{p.count}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-navy-900">{p.venue}</span>
                            <span className="block truncate text-xs text-muted">{p.ward} · last {p.last_at ? dateTime(p.last_at) : "—"}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-5 py-5 text-sm text-muted">No places yet. Each GPS check-in adds its exact spot here.</p>}
              </Card>

              <Card className="p-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-navy-900"><LayersIcon className="size-4" /> Layers</p>
                <div className="space-y-1.5">
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
                <p className="mt-4 text-xs leading-relaxed text-muted">Ward boundaries: IEBC. Base map © OpenFreeMap, © OpenStreetMap contributors.</p>
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl px-3 py-2 ring-1", strong ? "bg-ocean-50 ring-ocean/20" : "bg-slate-50 ring-line")}>
      <p className="text-xs text-slate-500">{k}</p>
      <p className="font-display text-2xl font-bold text-navy-900 tabular-nums">{v}</p>
    </div>
  );
}

function MapLegend({ mode }: { mode: MapMode }) {
  const steps = mode === "visits" ? VISIT_STEPS.map(([v, c, l]) => [v, c, l] as const) : RAMP.map(([v, c]) => [v, c, `${v}%`] as const);
  return (
    <div className="absolute bottom-9 left-3 max-w-[calc(100%-24px)] rounded-xl bg-white/95 p-3 shadow-lg ring-1 ring-line backdrop-blur">
      <p className="mb-1.5 text-xs font-semibold text-navy-900">{mode === "visits" ? "Times each ward has been visited" : "Progress to target"}</p>
      <div className="flex">
        {steps.map(([v, c, l]) => (
          <div key={v} className="w-12">
            <span className="block h-2.5 border-r-2 border-white" style={{ background: c }} />
            <span className="mt-1 block text-xs text-slate-600">{l}</span>
          </div>
        ))}
      </div>
      <ul className="mt-2 hidden space-y-1 text-xs text-slate-600 sm:block">
        {mode === "visits" && (
          <li className="flex items-center gap-2"><span className="h-0 w-5 border-t-2 border-dashed border-kenya-red" /> Ward not visited yet</li>
        )}
        <li className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-full bg-kenya-green text-xs font-bold text-white ring-2 ring-white">3</span>
          Place visited (exact GPS) · number = times
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-full bg-[#7a8a99] text-xs font-bold text-white ring-2 ring-white">1</span>
          Place visited (at its polling station)
        </li>
        <li className="flex items-center gap-2"><span className="size-4 rounded-full border-[3px] border-gold bg-white" /> Visit planned</li>
      </ul>
    </div>
  );
}
