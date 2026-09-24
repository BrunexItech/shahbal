"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection, MultiPolygon, Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { MAP_STYLE } from "@/lib/config";
import type { MapOverview, MapWard } from "@/lib/types";

/** Sequential single-hue ramp (magnitude): light → Kenyan green. No target = neutral grey. */
export const RAMP: [number, string][] = [
  [0, "#e8f5ee"],
  [25, "#b7e0cb"],
  [50, "#6fc29a"],
  [75, "#23985f"],
  [100, "#006b3f"],
];

const FILL = [
  "case",
  ["==", ["get", "percent"], null], "#e2e8f0",
  ["interpolate", ["linear"], ["min", ["get", "percent"], 100], ...RAMP.flat()],
] as unknown as ExpressionSpecification;

export type Layers = { wards: boolean; visited: boolean; stations: boolean; visits: boolean; labels: boolean };

export function CoverageMap({ data, boundaries, layers, selected, onSelect }: {
  data: MapOverview;
  boundaries: FeatureCollection;
  layers: Layers;
  selected: string | null;
  onSelect: (wardId: string | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const byCode = useMemo(() => new Map<string, MapWard>(data.wards.map((w) => [w.code, w])), [data.wards]);

  const wardFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: boundaries.features
      .filter((f) => byCode.has(String(f.properties?.code)))
      .map((f, i) => {
        const w = byCode.get(String(f.properties?.code))!;
        return {
          ...f,
          id: i,
          properties: { ...f.properties, ward_id: w.id, percent: w.target ? w.percent : null, achieved: w.achieved, target: w.target, visited: w.visits_completed > 0 },
        };
      }),
  }), [boundaries, byCode]);

  const stationFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: data.stations.map((s) => ({
      type: "Feature",
      properties: { name: s.name, captured: s.captured, code: s.code },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  }), [data.stations]);

  const visitFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: data.visits.filter((v) => v.lat != null && v.lng != null).map((v) => ({
      type: "Feature",
      properties: { title: v.title, status: v.status, when: v.scheduled_at },
      geometry: { type: "Point", coordinates: [v.lng!, v.lat!] },
    })),
  }), [data.visits]);

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // served from public/, see scripts/copy-maplibre-worker.mjs
    const m = new maplibregl.Map({
      container: el.current,
      style: MAP_STYLE,
      center: [39.66, -4.04],
      zoom: 10.6,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      m.addSource("wards", { type: "geojson", data: empty });
      m.addSource("stations", { type: "geojson", data: empty });
      m.addSource("visits", { type: "geojson", data: empty });
      m.addLayer({
        id: "ward-fill", type: "fill", source: "wards",
        paint: { "fill-color": FILL, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.92, 0.78] },
      });
      m.addLayer({ id: "ward-line", type: "line", source: "wards", paint: { "line-color": "#ffffff", "line-width": 1.5 } });
      m.addLayer({ id: "ward-visited", type: "line", source: "wards", filter: ["==", ["get", "visited"], true], paint: { "line-color": "#c9a227", "line-width": 3 } });
      m.addLayer({ id: "ward-selected", type: "line", source: "wards", filter: ["==", ["get", "ward_id"], ""], paint: { "line-color": "#0b1f3a", "line-width": 3.5 } });
      m.addLayer({
        id: "ward-label", type: "symbol", source: "wards",
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-max-width": 7 },
        paint: { "text-color": "#0b1f3a", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.4 },
      });
      m.addLayer({
        id: "stations", type: "circle", source: "stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "captured"], 0, 4, 20, 7, 80, 12],
          "circle-color": "#0b1f3a", "circle-opacity": 0.85, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
        },
      });
      m.addLayer({
        id: "visits", type: "circle", source: "visits",
        paint: {
          "circle-radius": 7,
          "circle-color": ["match", ["get", "status"], "completed", "#006b3f", "in_progress", "#0b7fa6", "#c9a227"],
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "chq-popup" });
      const show = (at: maplibregl.LngLatLike, title: string, sub: string) => {
        popup.setLngLat(at).setDOMContent(tooltip(title, sub)).addTo(m);
      };

      let hovered: number | string | undefined;
      m.on("mousemove", "ward-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = f.id;
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: true });
        m.getCanvas().style.cursor = "pointer";
        const p = f.properties as { name: string; percent: number | null; achieved: number; target: number };
        show(e.lngLat, p.name, p.target
          ? `${p.achieved.toLocaleString()} of ${p.target.toLocaleString()} · ${p.percent ?? 0}%`
          : `${p.achieved.toLocaleString()} captured · no target set`);
      });
      m.on("mouseleave", "ward-fill", () => {
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = undefined;
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      for (const layer of ["stations", "visits"] as const) {
        m.on("mouseenter", layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, string>;
          const at = (f.geometry as Point).coordinates as [number, number];
          m.getCanvas().style.cursor = "pointer";
          if (layer === "stations") show(at, p.name, `${p.code} · ${Number(p.captured).toLocaleString()} captured`);
          else show(at, p.title, `${p.status.replace("_", " ")} · ${new Date(p.when).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}`);
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
          popup.remove();
        });
      }
      m.on("click", "ward-fill", (e) => onSelectRef.current(String(e.features?.[0]?.properties?.ward_id ?? "") || null));
      setLoaded(true);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    (m.getSource("wards") as GeoJSONSource).setData(wardFc);
    (m.getSource("stations") as GeoJSONSource).setData(stationFc);
    (m.getSource("visits") as GeoJSONSource).setData(visitFc);
  }, [loaded, wardFc, stationFc, visitFc]);

  // Fit to what the viewer can see: a ward coordinator gets their ward, HQ the whole county.
  const fitted = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m || fitted.current || !wardFc.features.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const f of wardFc.features) {
      for (const poly of (f.geometry as MultiPolygon).coordinates) for (const [x, y] of poly[0]) b.extend([x, y]);
    }
    m.fitBounds(b, { padding: 40, duration: 0 });
    fitted.current = true;
  }, [loaded, wardFc]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    m.setLayoutProperty("ward-fill", "visibility", vis(layers.wards));
    m.setLayoutProperty("ward-visited", "visibility", vis(layers.visited));
    m.setLayoutProperty("stations", "visibility", vis(layers.stations));
    m.setLayoutProperty("visits", "visibility", vis(layers.visits));
    m.setLayoutProperty("ward-label", "visibility", vis(layers.labels));
  }, [loaded, layers]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setFilter("ward-selected", ["==", ["get", "ward_id"], selected ?? ""]);
  }, [loaded, selected]);

  // MapLibre's (unlayered) CSS forces `position: relative` on its container, which beats
  // Tailwind's layered utilities, so the positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="region" aria-label="Coverage map of Mombasa wards" />
    </div>
  );
}

/** Tooltip built from DOM nodes with textContent, never from HTML strings. */
function tooltip(title: string, sub: string) {
  const wrap = document.createElement("div");
  const t = document.createElement("p");
  t.className = "text-[13px] font-semibold text-white";
  t.textContent = title;
  const s = document.createElement("p");
  s.className = "text-[11px] text-slate-300";
  s.textContent = sub;
  wrap.append(t, s);
  return wrap;
}
