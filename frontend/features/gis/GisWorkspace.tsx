"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import {
  Box, Camera, ChevronDown, Download, ExternalLink, FileSpreadsheet, Flame, House, Image as ImageIcon, Layers as LayersIcon,
  Map as MapIcon, Pause, Play, Printer, Ruler, Satellite, X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Skeleton, Spinner } from "@/components/loaders";
import { useBoundaries, useConstituencyOutlines, useMapOverview } from "@/features/map/api";
import { CONSTITUENCY_COLORS, PROGRESS_STEPS } from "@/features/map/regions";
import { PhotoImg, useVisitPhotos } from "@/features/visits/photos";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { API_URL, GIS_URL, MAPILLARY_TOKEN } from "@/lib/config";
import { dateTime, num, pct } from "@/lib/format";
import type { MapOverview, VisitedPlace } from "@/lib/types";

import { downloadCsv, placeRows, printMap, save, wardRows } from "./exports";
import { CAPTURE_STEPS, type Base, type GisLayers, type GisMapHandle, type MeasureResult, type Selection, type Theme, VISIT_STEPS } from "./GisMap";
import { fmtArea, fmtDistance } from "./measure";

const GisMap = dynamic(() => import("./GisMap").then((m) => m.GisMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-100"><Spinner size="lg" /></div>,
});

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "constituency", label: "Constituencies", hint: "The six constituencies" },
  { id: "captures", label: "Captures", hint: "People captured per ward" },
  { id: "progress", label: "Progress", hint: "% of each ward's target" },
  { id: "visits", label: "Visits", hint: "Times the team has visited" },
];

const LEGENDS: Record<Theme, [string, string][]> = {
  constituency: Object.entries(CONSTITUENCY_COLORS).map(([n, c]) => [n, c]),
  captures: CAPTURE_STEPS.map(([, c, l]) => [l, c]),
  progress: PROGRESS_STEPS.map(([, c, l]) => [l, c]),
  visits: VISIT_STEPS.map(([, c, l]) => [l === "Never" ? "Never" : `${l}×`, c]),
};

type Panel = "layers" | "measure" | null;

export function GisWorkspace() {
  const overview = useMapOverview();
  const wards = useBoundaries();
  const cons = useConstituencyOutlines();
  const density = useQuery({ queryKey: ["map", "density"], queryFn: () => api<FeatureCollection>("/map/density"), staleTime: 5 * 60_000 });
  const mapRef = useRef<GisMapHandle>(null);

  const [base, setBase] = useState<Base>("streets");
  const [threeD, setThreeD] = useState(false);
  const [theme, setTheme] = useState<Theme>("captures");
  const [layers, setLayers] = useState<GisLayers>({ wards: true, labels: true, stations: false, places: true, density: false, street: false });
  const [panel, setPanel] = useState<Panel>(null);
  const [measuring, setMeasuring] = useState<"off" | "distance" | "area">("off");
  const [measureReset, setMeasureReset] = useState(0);
  const [measure, setMeasure] = useState<MeasureResult>({ points: 0, distance: 0, area: 0 });
  const [selected, setSelected] = useState<Selection>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; zoom?: number; key: number } | null>(null);
  const [replay, setReplay] = useState<{ on: boolean; t: number; playing: boolean }>({ on: false, t: 0, playing: false });
  const [menu, setMenu] = useState(false);

  const d = overview.data;
  const range = useMemo(() => {
    const ts = (d?.places ?? []).flatMap((p) => p.dates.map((x) => new Date(x).getTime()));
    return ts.length ? { min: Math.min(...ts), max: Math.max(...ts) } : null;
  }, [d]);

  // Replay animation: sweep from the first visit to the last in ~12 seconds.
  useEffect(() => {
    if (!replay.playing || !range) return;
    const span = Math.max(range.max - range.min, 1);
    const id = window.setInterval(() => setReplay((r) => {
      const t = r.t + span / 120;
      return t >= range.max ? { ...r, t: range.max, playing: false } : { ...r, t };
    }), 100);
    return () => window.clearInterval(id);
  }, [replay.playing, range]);

  const toggleMeasure = () => {
    if (measuring === "off") { setMeasuring("distance"); setPanel("measure"); setSelected(null); }
    else { setMeasuring("off"); setPanel(null); }
  };
  const toggleReplay = () => {
    if (!range) return toast.info("No completed visits to replay yet.");
    setReplay((r) => (r.on ? { on: false, t: 0, playing: false } : { on: true, t: range.min, playing: true }));
  };
  const toggleStreet = () => {
    if (!MAPILLARY_TOKEN) return toast.info("Street photos need a free Mapillary key. Ask your administrator to add it.");
    setLayers((l) => ({ ...l, street: !l.street }));
    if (!layers.street) toast.info("Zoom in on a street and click a green dot to see its photo.");
  };

  const legend = LEGENDS[theme];
  const stamp = new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
  const doPrint = () => {
    const img = mapRef.current?.image();
    if (!img) return;
    printMap(img, `Mombasa County · ${THEMES.find((t) => t.id === theme)!.label}`, `Team Shahbal campaign map · ${stamp}`, legend);
  };
  const doImage = async () => {
    const img = mapRef.current?.image();
    if (!img) return;
    save(await (await fetch(img)).blob(), `mombasa-${theme}-${new Date().toISOString().slice(0, 10)}.png`);
  };

  if (overview.error) return <div className="p-6 text-sm text-kenya-red">Couldn&apos;t load the map data. {overview.error.message}</div>;

  return (
    <div className="relative -mx-4 -mt-6 -mb-24 h-[calc(100dvh-9rem)] overflow-hidden sm:-mx-6 lg:-mx-8 lg:-mb-12 lg:h-[calc(100dvh-4rem)]">
      {d && wards.data && cons.data ? (
        <GisMap ref={mapRef} data={d} wards={wards.data} constituencies={cons.data} density={density.data ?? null}
          base={base} threeD={threeD} theme={theme} layers={layers} measuring={measuring} measureReset={measureReset} onMeasure={setMeasure}
          replayAt={replay.on ? replay.t : null} onSelect={setSelected} selected={selected} focus={focus} />
      ) : <Skeleton className="absolute inset-0 rounded-none" />}

      {/* Title + actions */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
        <div className="pointer-events-auto rounded-2xl bg-navy-950/90 px-4 py-2.5 text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
          <div aria-hidden className="mb-1.5 flex h-1 w-16 overflow-hidden rounded-full"><i className="flex-1 bg-kenya-black" /><i className="flex-1 bg-kenya-red" /><i className="flex-1 bg-kenya-green" /></div>
          <p className="text-xs font-semibold tracking-[.18em] text-gold uppercase">GIS Lab</p>
          <p className="font-display text-lg leading-tight font-bold">Mombasa County</p>
        </div>
        <div className="pointer-events-auto mr-12 flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-navy-900 shadow-lg ring-1 ring-line hover:bg-slate-50">
              <Download className="size-4" /> <span className="hidden sm:inline">Download</span> <ChevronDown className="size-4" />
            </button>
            {menu && (
              <div className="absolute right-0 z-20 mt-2 w-64 animate-fade-up overflow-hidden rounded-2xl bg-white p-1.5 shadow-2xl ring-1 ring-line" onMouseLeave={() => setMenu(false)}>
                {([
                  [Printer, "Print or save as PDF", doPrint],
                  [ImageIcon, "Map picture (PNG)", doImage],
                  [FileSpreadsheet, "Wards spreadsheet (Excel)", () => d && downloadCsv("mombasa-wards.csv", wardRows(d))],
                  [FileSpreadsheet, "Visited places (Excel)", () => d && downloadCsv("mombasa-visited-places.csv", placeRows(d))],
                ] as const).map(([Icon, label, fn]) => (
                  <button key={label} onClick={() => { setMenu(false); fn(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-navy-900 hover:bg-slate-50">
                    <Icon className="size-4 text-ocean" /> {label}
                  </button>
                ))}
                <div className="my-1 h-px bg-line" />
                <AdvancedButton />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tool rail */}
      <nav aria-label="Map tools" className="absolute top-24 left-3 flex flex-col gap-1.5 rounded-2xl bg-navy-950/90 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur sm:left-4">
        <Tool icon={LayersIcon} label="Layers & colours" on={panel === "layers"} onClick={() => { setPanel(panel === "layers" ? null : "layers"); if (measuring !== "off") setMeasuring("off"); }} />
        <Tool icon={Ruler} label="Measure distance or area" on={measuring !== "off"} onClick={toggleMeasure} />
        <Tool icon={Box} label="3D view" on={threeD} onClick={() => setThreeD((v) => !v)} />
        <Tool icon={base === "satellite" ? MapIcon : Satellite} label={base === "satellite" ? "Street map" : "Satellite"} on={base === "satellite"} onClick={() => setBase((b) => (b === "satellite" ? "streets" : "satellite"))} />
        <Tool icon={Camera} label="Street-level photos" on={layers.street} onClick={toggleStreet} />
        <Tool icon={Flame} label="Capture heatmap" on={layers.density} onClick={() => setLayers((l) => ({ ...l, density: !l.density }))} />
        <Tool icon={replay.playing ? Pause : Play} label="Replay the campaign" on={replay.on} onClick={toggleReplay} />
        <div className="mx-2 h-px bg-white/10" />
        <Tool icon={House} label="Whole county" onClick={() => mapRef.current?.home()} />
      </nav>

      {/* Layers panel */}
      {panel === "layers" && (
        <section className="absolute top-24 left-[4.5rem] w-[min(300px,calc(100vw-6rem))] animate-fade-up rounded-2xl bg-white/95 p-4 shadow-2xl ring-1 ring-line backdrop-blur sm:left-20">
          <PanelHead title="Colour wards by" onClose={() => setPanel(null)} />
          <div className="grid grid-cols-2 gap-1.5">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)} title={t.hint}
                className={cn("rounded-xl px-3 py-2 text-left text-sm font-semibold ring-1 transition", theme === t.id ? "bg-navy-950 text-white ring-navy-950" : "bg-white text-navy-900 ring-line hover:bg-slate-50")}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-4 mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">Show on map</p>
          {([["wards", "Ward colours"], ["places", "Places visited"], ["stations", "Polling stations"], ["labels", "Names"], ["density", "Capture heatmap"]] as const).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between rounded-lg px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              {label}
              <Switch on={layers[k]} onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />
            </label>
          ))}
        </section>
      )}

      {/* Measure panel */}
      {panel === "measure" && measuring !== "off" && (
        <section className="absolute top-24 left-[4.5rem] w-[min(300px,calc(100vw-6rem))] animate-fade-up rounded-2xl bg-white/95 p-4 shadow-2xl ring-1 ring-line backdrop-blur sm:left-20">
          <PanelHead title="Measure" onClose={() => { setMeasuring("off"); setPanel(null); }} />
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {(["distance", "area"] as const).map((k) => (
              <button key={k} onClick={() => setMeasuring(k)} className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold capitalize", measuring === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-500")}>{k}</button>
            ))}
          </div>
          <p className="mt-4 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {measuring === "area" ? (measure.points > 2 ? fmtArea(measure.area) : "—") : measure.points > 1 ? fmtDistance(measure.distance) : "—"}
          </p>
          {measuring === "area" && measure.points > 2 && <p className="text-sm text-slate-500">Perimeter {fmtDistance(measure.distance)}</p>}
          <p className="mt-2 text-sm text-slate-600">
            {measure.points === 0 ? "Click on the map to place the first point." : measuring === "area" ? "Keep clicking to outline the area." : "Click to add more points along the route."}
          </p>
          {measure.points > 0 && (
            <button onClick={() => setMeasureReset((n) => n + 1)} className="mt-3 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-navy-900 hover:bg-slate-200">Clear</button>
          )}
        </section>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-2xl bg-white/95 px-3.5 py-2.5 shadow-xl ring-1 ring-line backdrop-blur sm:bottom-4 sm:left-4">
        <p className="mb-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">{THEMES.find((t) => t.id === theme)!.hint}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {legend.map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-xs text-slate-700"><span className="size-3 rounded-sm ring-1 ring-black/5" style={{ background: color }} />{label}</span>
          ))}
        </div>
        {threeD && layers.wards && <p className="mt-1.5 text-xs text-slate-500">Column height = people captured</p>}
      </div>

      {/* Replay bar */}
      {replay.on && range && (
        <div className="absolute bottom-24 left-1/2 w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2 animate-fade-up rounded-2xl bg-navy-950/95 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur sm:bottom-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setReplay((r) => ({ ...r, playing: !r.playing, t: !r.playing && r.t >= range.max ? range.min : r.t }))}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-gold text-navy-950" aria-label={replay.playing ? "Pause" : "Play"}>
              {replay.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-lg font-bold">{new Date(replay.t).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" })}</p>
                <p className="text-xs text-slate-300">{num((d?.places ?? []).reduce((a, p) => a + p.dates.filter((x) => new Date(x).getTime() <= replay.t).length, 0))} visits so far</p>
              </div>
              <input type="range" min={range.min} max={range.max} value={replay.t} step={Math.max(1, (range.max - range.min) / 200)} aria-label="Replay date"
                onChange={(e) => setReplay((r) => ({ ...r, t: Number(e.target.value), playing: false }))} className="w-full accent-[#c9a227]" />
            </div>
            <button onClick={() => setReplay({ on: false, t: 0, playing: false })} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close replay"><X className="size-4" /></button>
          </div>
        </div>
      )}

      {/* Details */}
      {selected && d && <Details d={d} selected={selected} onClose={() => setSelected(null)} onFocus={(p) => setFocus({ lng: p.lng, lat: p.lat, key: Date.now() })} />}
    </div>
  );
}

function Tool({ icon: Icon, label, on, onClick }: { icon: typeof Ruler; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} title={label} aria-label={label}
      className={cn("group relative grid size-11 place-items-center rounded-xl transition", on ? "bg-gold text-navy-950" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
      <Icon className="size-5" />
      <span className="pointer-events-none absolute left-full ml-3 hidden rounded-lg bg-navy-950 px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition group-hover:opacity-100 sm:block">{label}</span>
    </button>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className={cn("relative h-5 w-9 rounded-full transition", on ? "bg-kenya-green" : "bg-slate-300")}>
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <p className="text-sm font-bold text-navy-900">{title}</p>
      <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-900" aria-label="Close"><X className="size-4" /></button>
    </div>
  );
}

function Details({ d, selected, onClose, onFocus }: { d: MapOverview; selected: NonNullable<Selection>; onClose: () => void; onFocus: (p: VisitedPlace) => void }) {
  const ward = selected.kind === "ward" ? d.wards.find((w) => w.id === selected.id) : null;
  const place = selected.kind === "place" ? d.places.find((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` === selected.key) : null;
  return (
    <aside className="absolute inset-x-3 bottom-3 max-h-[60%] animate-fade-up overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-line sm:inset-x-auto sm:top-24 sm:right-4 sm:bottom-4 sm:max-h-none sm:w-[360px]">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-navy-950 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[.16em] text-gold uppercase">
            {selected.kind === "ward" ? ward?.constituency : selected.kind === "place" ? place?.ward : "Street level"}
          </p>
          <p className="truncate font-display text-lg font-bold">{ward?.name ?? place?.venue ?? "Street photo"}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10" aria-label="Close details"><X className="size-4" /></button>
      </div>
      <div className="p-4">
        {ward && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {([["Captured", num(ward.achieved)], ["Target", num(ward.target)], ["Progress", pct(ward.percent)], ["Gap", num(ward.gap)], ["Supporters", num(ward.supporters)], ["Visits done", num(ward.visits_completed)]] as const).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-line">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="font-display text-xl font-bold text-navy-900 tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">Last visit: {ward.last_visit_at ? dateTime(ward.last_visit_at) : "never"}</p>
            {d.places.filter((p) => p.ward_id === ward.id).map((p) => (
              <button key={`${p.lat},${p.lng}`} onClick={() => onFocus(p)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left ring-1 ring-line hover:bg-slate-50">
                {p.photo_url ? <PhotoImg url={p.photo_url} alt={p.venue} className="size-12 shrink-0 rounded-lg" /> : <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><Camera className="size-4" /></span>}
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-navy-900">{p.venue}</span><span className="text-xs text-slate-500">Visited {p.count}× · zoom to it</span></span>
              </button>
            ))}
          </div>
        )}
        {place && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Visited <b className="text-navy-900">{place.count} {place.count === 1 ? "time" : "times"}</b>{place.attendance ? <> · <b className="text-navy-900">{num(place.attendance)}</b> attended</> : null}</p>
            <p className="text-xs text-slate-500">{place.exact ? "Exact GPS where the team checked in" : "Located at its polling station"} · last {place.last_at ? dateTime(place.last_at) : "—"}</p>
            {place.visit_ids.map((vid) => <VisitGallery key={vid} vid={vid} />)}
            {!place.photos && <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600 ring-1 ring-line">No photos yet. The team can add them from the visit card.</p>}
          </div>
        )}
        {selected.kind === "street" && <StreetPhoto id={selected.id} />}
      </div>
    </aside>
  );
}

function VisitGallery({ vid }: { vid: string }) {
  const { data = [] } = useVisitPhotos(vid);
  if (!data.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {data.map((p) => (
        <figure key={p.id} className="overflow-hidden rounded-xl ring-1 ring-line">
          <PhotoImg url={p.url} alt={`Visit photo by ${p.taken_by}`} className="aspect-[4/3] w-full" />
          <figcaption className="px-2 py-1 text-xs text-slate-500">{p.taken_by} · {dateTime(p.created_at)}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function StreetPhoto({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["mapillary", id],
    queryFn: async () => {
      const r = await fetch(`https://graph.mapillary.com/${id}?fields=thumb_1024_url,captured_at&access_token=${MAPILLARY_TOKEN}`);
      if (!r.ok) throw new Error("Couldn't load the street photo");
      return (await r.json()) as { thumb_1024_url: string; captured_at: number };
    },
    staleTime: Infinity,
  });
  if (q.isLoading) return <div className="grid h-48 place-items-center"><Spinner /></div>;
  if (!q.data) return <p className="text-sm text-slate-600">Couldn&apos;t load this street photo.</p>;
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image */}
      <img src={q.data.thumb_1024_url} alt="Street-level photo" className="w-full rounded-xl" />
      <figcaption className="mt-1.5 text-xs text-slate-500">Mapillary · {new Date(q.data.captured_at).toLocaleDateString("en-KE")}</figcaption>
    </figure>
  );
}

/** The expert GIS (GeoLibre) stays one click away, behind the same one-time secure link. */
function AdvancedButton() {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const win = window.open("about:blank", "_blank");
    if (win) {
      win.document.title = "Opening advanced analysis…";
      const msg = win.document.createElement("p");
      msg.style.cssText = "font:16px system-ui,sans-serif;color:#0b1f3a;text-align:center;margin-top:30vh";
      msg.textContent = "Preparing a secure link… If you're asked to confirm it's you, do that in the other tab.";
      win.document.body.append(msg);
    }
    setBusy(true);
    try {
      const origin = window.location.origin;
      const apiBase = API_URL.startsWith("http") ? API_URL : `${origin}${API_URL}`;
      const link = await api<{ url: string }>("/map/export/project-link?mode=workspace", { method: "POST" });
      const lab = `${GIS_URL}?url=${encodeURIComponent(`${apiBase}${link.url}`)}&welcome=0`;
      if (win) { win.opener = null; win.location.href = lab; } else window.location.href = lab;
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Couldn't open the advanced workspace");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={open} disabled={busy} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50">
      {busy ? <Spinner size="sm" /> : <ExternalLink className="size-4" />} Advanced analysis (expert)
    </button>
  );
}
