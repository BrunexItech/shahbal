"use client";

import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { Skeleton, Spinner } from "@/components/loaders";
import { Card, ErrorState } from "@/components/ui";
import { useBoundaries, useConstituencyOutlines, useMapOverview } from "@/features/map/api";
import { CONSTITUENCY_COLORS, PROGRESS_STEPS } from "@/features/map/regions";
import type { RegionView } from "@/features/map/RegionsMap";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import type { MapWard } from "@/lib/types";

const RegionsMap = dynamic(() => import("@/features/map/RegionsMap").then((m) => m.RegionsMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-100"><Spinner size="lg" /></div>,
});

type Totals = { name: string; wards: number; target: number; achieved: number; gap: number; percent: number | null };

function roll(name: string, ws: MapWard[]): Totals {
  const target = ws.reduce((a, w) => a + w.target, 0);
  const achieved = ws.reduce((a, w) => a + w.achieved, 0);
  return { name, wards: ws.length, target, achieved, gap: Math.max(target - achieved, 0), percent: target ? (achieved / target) * 100 : null };
}

const pctText = (p: number | null) => (p == null ? "No target" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`);

/** The live political map of Mombasa for the GIS Lab page: regions first, numbers on demand. */
export function RegionsExplorer() {
  const overview = useMapOverview();
  const wards = useBoundaries();
  const cons = useConstituencyOutlines();
  const [view, setView] = useState<RegionView>("constituencies");
  const [stations, setStations] = useState(true);
  const [ward, setWard] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>("county");
  const [flyTo, setFlyTo] = useState<{ target: string; key: number } | null>(null);

  const data = overview.data;
  const rows = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, MapWard[]>();
    for (const w of data.wards) by.set(w.constituency, [...(by.get(w.constituency) ?? []), w]);
    return [...by.entries()].map(([n, ws]) => roll(n, ws)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const county = useMemo(() => roll("Mombasa County", data?.wards ?? []), [data]);
  const picked = data?.wards.find((w) => w.id === ward) ?? null;

  const frame = (target: string) => {
    setFocus(target);
    setWard(null);
    setFlyTo({ target, key: Date.now() });
  };

  if (overview.error || wards.error || cons.error) {
    return <Card><ErrorState error={overview.error ?? wards.error ?? cons.error} onRetry={() => { overview.refetch(); wards.refetch(); cons.refetch(); }} /></Card>;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-navy-900">Mombasa County: 6 constituencies, 30 wards</h2>
          <p className="text-sm text-muted">IEBC boundaries with live campaign numbers. Hover or tap a ward for its figures.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Colour the map by" className="inline-flex rounded-xl bg-slate-100 p-1">
            {([["constituencies", "Constituencies"], ["progress", "Progress to target"]] as const).map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold transition", view === v ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900")}>
                {label}
              </button>
            ))}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-slate-600">
            <input type="checkbox" checked={stations} onChange={(e) => setStations(e.target.checked)} className="size-4 accent-kenya-green" />
            Polling stations
          </label>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px]">
        <div className="relative h-[440px] bg-slate-100 sm:h-[560px]">
          {data && wards.data && cons.data ? (
            <RegionsMap data={data} wards={wards.data} constituencies={cons.data} view={view} showStations={stations}
              selected={ward} onSelect={(s) => setWard(s?.id ?? null)} flyTo={flyTo} />
          ) : (
            <div className="absolute inset-0 grid place-items-center"><Spinner size="lg" /></div>
          )}
          {view === "progress" && (
            <div className="absolute bottom-9 left-3 rounded-xl bg-white/95 p-2.5 shadow-md ring-1 ring-line backdrop-blur">
              <p className="mb-1.5 text-xs font-semibold text-navy-900">Ward progress to target</p>
              <div className="flex">
                {PROGRESS_STEPS.map(([v, c, label]) => (
                  <div key={v} className="w-11">
                    <span className="block h-2.5 border-r-2 border-white last:border-r-0" style={{ background: c }} />
                    <span className="mt-1 block text-xs text-slate-600">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="border-t border-line lg:border-t-0 lg:border-l">
          {!data ? (
            <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : picked ? (
            <WardPanel w={picked} onBack={() => setWard(null)} />
          ) : (
            <div>
              <button onClick={() => frame("county")}
                className={cn("block w-full px-5 py-4 text-left transition hover:bg-slate-50", focus === "county" && "bg-slate-50")}>
                <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Whole county</p>
                <p className="mt-0.5 font-display text-2xl font-bold text-navy-900 tabular-nums">{num(county.achieved)}
                  <span className="text-base font-medium text-slate-500"> of {num(county.target)}</span></p>
                <Bar percent={county.percent} color="#006b3f" />
              </button>
              <ul className="divide-y divide-line border-t border-line">
                {rows.map((r) => (
                  <li key={r.name}>
                    <button onClick={() => frame(r.name)} aria-pressed={focus === r.name}
                      className={cn("flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50", focus === r.name && "bg-slate-50")}>
                      <span aria-hidden className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: CONSTITUENCY_COLORS[r.name] ?? "#94a3b8" }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-semibold text-navy-900">{r.name}</span>
                          <span className="text-sm font-bold text-navy-900 tabular-nums">{pctText(r.percent)}</span>
                        </span>
                        <span className="block text-xs text-slate-500 tabular-nums">{r.wards} wards · {num(r.achieved)} of {num(r.target)} · gap {num(r.gap)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-3 text-xs text-slate-500">Select a constituency to zoom in. Ward names appear as you zoom.</p>
            </div>
          )}
        </aside>
      </div>
    </Card>
  );
}

function Bar({ percent, color }: { percent: number | null; color: string }) {
  return (
    <span className="mt-2 block h-2 overflow-hidden rounded-full bg-slate-100">
      <span className="block h-full rounded-full" style={{ width: `${Math.min(percent ?? 0, 100)}%`, background: color }} />
    </span>
  );
}

function WardPanel({ w, onBack }: { w: MapWard; onBack: () => void }) {
  const stats: [string, string][] = [
    ["Reached", num(w.achieved)],
    ["Target", num(w.target)],
    ["Gap", num(w.gap)],
    ["Verified", num(w.verified)],
    ["Supporters", num(w.supporters)],
    ["Visits done", num(w.visits_completed)],
    ["Registered voters (IEBC)", w.registered_voters != null ? num(w.registered_voters) : "Not recorded"],
  ];
  return (
    <div className="p-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ocean hover:underline">
        <ArrowLeft className="size-4" /> All constituencies
      </button>
      <p className="mt-4 flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
        <span aria-hidden className="size-2.5 rounded-full" style={{ background: CONSTITUENCY_COLORS[w.constituency] ?? "#94a3b8" }} />
        {w.constituency}
      </p>
      <h3 className="mt-1 font-display text-2xl font-bold text-navy-900">{w.name}</h3>
      <p className="mt-2 text-sm text-slate-600"><b className="text-navy-900">{pctText(w.percent)}</b> of target reached</p>
      <Bar percent={w.percent} color="#006b3f" />
      <dl className="mt-5 divide-y divide-line text-sm">
        {stats.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-2.5">
            <dt className="text-slate-600">{k}</dt>
            <dd className="font-semibold text-navy-900 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
