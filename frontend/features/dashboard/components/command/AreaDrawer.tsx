"use client";

import { Camera, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Spinner } from "@/components/loaders";
import { ProgressBar } from "@/components/ui";
import { useBoundaries, useMapOverview } from "@/features/map/api";
import type { Layers } from "@/features/map/CoverageMap";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { PhotoImg } from "@/features/visits/photos";
import { dateTime, num, pct } from "@/lib/format";

const CoverageMap = dynamic(() => import("@/features/map/CoverageMap").then((m) => m.CoverageMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-100"><Spinner size="lg" /></div>,
});

const LAYERS: Layers = { wards: true, visited: true, stations: true, visits: true, labels: true };

/**
 * Street-level view of one ward, opened from the Command Centre map: exact places
 * the team has been (with photos), how often, and how the ward is doing.
 */
export function AreaDrawer({ wardName, onClose }: { wardName: string; onClose: () => void }) {
  const overview = useMapOverview();
  const boundaries = useBoundaries();
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: string } | null>(null);
  const ward = overview.data?.wards.find((w) => w.name === wardName) ?? null;
  const places = (overview.data?.places ?? []).filter((p) => p.ward_id === ward?.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${wardName} ward`}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 animate-fade-up bg-navy-950/50 backdrop-blur-sm" />
      <aside className="absolute inset-y-0 right-0 flex w-full animate-fade-up flex-col overflow-hidden bg-white shadow-2xl sm:w-[600px]">
        <header className="flex items-start justify-between gap-3 bg-navy-950 px-5 py-4 text-white">
          <div className="min-w-0">
            {ward && (
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[.16em] text-gold uppercase">
                <span className="size-2 rounded-full" style={{ background: CONSTITUENCY_COLORS[ward.constituency] ?? "#94a3b8" }} />{ward.constituency}
              </p>
            )}
            <h2 className="truncate font-display text-2xl font-bold">{wardName}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="size-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative h-[300px] bg-slate-100 sm:h-[340px]">
            {overview.data && boundaries.data && ward ? (
              <CoverageMap data={overview.data} boundaries={boundaries.data} layers={LAYERS} selected={ward.id} onSelect={() => {}}
                focus={focus} mode="visits" fitWard={ward.id} />
            ) : <div className="absolute inset-0 grid place-items-center"><Spinner size="lg" /></div>}
          </div>

          {ward && (
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {([["Visits done", ward.visits_completed], ["Planned", ward.visits_upcoming], ["Places", places.length]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 px-2 py-3 ring-1 ring-line">
                    <p className="font-display text-2xl font-bold text-navy-900 tabular-nums">{num(v)}</p>
                    <p className="text-xs text-slate-500">{k}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-slate-600">Captured <b className="text-navy-900">{num(ward.achieved)}</b> of {ward.target ? num(ward.target) : "—"}</span>
                  <span className="font-semibold text-navy-900">{pct(ward.percent)}</span>
                </div>
                <ProgressBar percent={ward.percent} />
                <p className="mt-2 text-xs text-slate-500">Last visit: {ward.last_visit_at ? dateTime(ward.last_visit_at) : "never"}</p>
              </div>

              <section>
                <h3 className="mb-2 text-sm font-bold text-navy-900">Where the team has been</h3>
                {places.length ? (
                  <ul className="space-y-2">
                    {places.map((p) => (
                      <li key={`${p.lat},${p.lng}`}>
                        <button onClick={() => setFocus({ lng: p.lng, lat: p.lat, key: `${p.venue}-${Date.now()}` })}
                          className="flex w-full items-center gap-3 rounded-2xl p-2 text-left ring-1 ring-line transition hover:bg-slate-50">
                          {p.photo_url ? (
                            <PhotoImg url={p.photo_url} alt={`Photo at ${p.venue}`} className="size-16 shrink-0 rounded-xl" />
                          ) : (
                            <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><Camera className="size-5" /></span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-navy-900">{p.venue}</span>
                            <span className="block text-xs text-slate-500">
                              Visited {p.count} {p.count === 1 ? "time" : "times"} · last {p.last_at ? dateTime(p.last_at) : "—"}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {p.exact ? "Exact GPS" : "At its polling station"}{p.attendance ? ` · ${num(p.attendance)} attended` : ""}{p.photos ? ` · ${p.photos} photo${p.photos > 1 ? "s" : ""}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="rounded-xl bg-red-50/60 px-4 py-3 text-sm text-slate-700 ring-1 ring-kenya-red/15">The team hasn't visited {wardName} yet.</p>}
              </section>

              <div className="flex gap-2">
                <Link href="/visits" className="flex-1 rounded-xl bg-kenya-green px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-kenya-green-600">Plan a visit</Link>
                <Link href="/targets" className="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-center text-sm font-semibold text-navy-900 hover:bg-slate-200">Captures by station</Link>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
