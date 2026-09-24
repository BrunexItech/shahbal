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

/** Sequential ocean ramp for how many times the team has been to a ward (0 = neutral, never visited). */
export const VISIT_STEPS: [number, string, string][] = [
  [0, "#f4f5f7", "Never"],
  [1, "#9dd2e8", "1"],
  [2, "#4fb0d4", "2"],
  [3, "#1587b3", "3–4"],
  [5, "#07506b", "5+"],
];

const VISIT_FILL = [
  "step", ["get", "visits"], VISIT_STEPS[0][1], ...VISIT_STEPS.slice(1).flatMap(([v, c]) => [v, c]),
] as unknown as ExpressionSpecification;

export type MapMode = "visits" | "progress";
export type Layers = { wards: boolean; visited: boolean; stations: boolean; visits: boolean; labels: boolean };

export function CoverageMap({ data, boundaries, layers, selected, onSelect, focus, mode = "visits" }: {
  data: MapOverview;
  mode?: MapMode;
  boundaries: FeatureCollection;
  layers: Layers;
  selected: string | null;
  onSelect: (wardId: string | null) => void;
  /** Fly to this point (e.g. an exact visit location) when it changes. */
  focus?: { lng: number; lat: number; key: string } | null;
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
          properties: {
            ...f.properties, ward_id: w.id, percent: w.target ? w.percent : null, achieved: w.achieved, target: w.target,
            visited: w.visits_completed > 0, visits: w.visits_completed, last_visit: w.last_visit_at ?? "",
          },
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
    features: data.visits.filter((v) => v.lat != null && v.lng != null && v.status === "scheduled").map((v) => ({
      type: "Feature",
      properties: {
        title: v.title, status: v.status, when: v.scheduled_at, exact: v.exact, ward: v.ward, venue: v.venue,
        by: v.checkin_by ?? "", checkin: v.checkin_at ?? "", attendance: v.attendance ?? -1,
      },
      geometry: { type: "Point", coordinates: [v.lng!, v.lat!] },
    })),
  }), [data.visits]);

  const placeFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: data.places.map((p) => ({
      type: "Feature",
      properties: { venue: p.venue, ward: p.ward, count: p.count, exact: p.exact, last: p.last_at ?? "", attendance: p.attendance, titles: p.titles.join(" · ") },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  }), [data.places]);

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
      m.addSource("places", { type: "geojson", data: empty });
      m.addLayer({
        id: "ward-fill", type: "fill", source: "wards",
        paint: { "fill-color": FILL, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.92, 0.78] },
      });
      m.addLayer({ id: "ward-line", type: "line", source: "wards", paint: { "line-color": "#ffffff", "line-width": 1.5 } });
      // Visits view: wards nobody has been to yet get a dashed red outline, so gaps jump out.
      m.addLayer({
        id: "ward-never", type: "line", source: "wards", filter: ["==", ["get", "visits"], 0],
        paint: { "line-color": "#bb1e10", "line-width": 1.6, "line-dasharray": [2, 1.5], "line-opacity": 0.8 },
      });
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
      // Places the team has been: size and number = how many times.
      m.addLayer({
        id: "places-halo", type: "circle", source: "places",
        paint: { "circle-radius": ["+", 10, ["*", 4, ["sqrt", ["get", "count"]]]], "circle-color": "#006b3f", "circle-opacity": 0.18 },
      });
      m.addLayer({
        id: "places", type: "circle", source: "places",
        paint: {
          "circle-radius": ["+", 6, ["*", 3, ["sqrt", ["get", "count"]]]],
          "circle-color": ["case", ["get", "exact"], "#006b3f", "#7a8a99"],
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5,
        },
      });
      m.addLayer({
        id: "places-count", type: "symbol", source: "places",
        layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
      // Planned visits: hollow pins at the planned location.
      m.addLayer({
        id: "visits", type: "circle", source: "visits",
        paint: {
          "circle-radius": ["case", ["get", "exact"], 7.5, 6],
          "circle-color": ["case", ["get", "exact"], ["match", ["get", "status"], "completed", "#006b3f", "in_progress", "#0b7fa6", "#c9a227"], "#ffffff"],
          "circle-stroke-color": ["case", ["get", "exact"], "#ffffff", ["match", ["get", "status"], "completed", "#006b3f", "in_progress", "#0b7fa6", "#c9a227"]],
          "circle-stroke-width": ["case", ["get", "exact"], 2.5, 3],
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
        const p = f.properties as { name: string; percent: number | null; achieved: number; target: number; visits: number };
        const visits = p.visits ? `visited ${p.visits} ${p.visits === 1 ? "time" : "times"}` : "not visited yet";
        show(e.lngLat, p.name, p.target
          ? `${visits} · ${p.achieved.toLocaleString()} of ${p.target.toLocaleString()} captured (${p.percent ?? 0}%)`
          : `${visits} · ${p.achieved.toLocaleString()} captured`);
      });
      m.on("mouseleave", "ward-fill", () => {
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = undefined;
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      m.on("mouseenter", "places", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { venue: string; ward: string; count: number; last: string; exact: boolean };
        m.getCanvas().style.cursor = "pointer";
        show((f.geometry as Point).coordinates as [number, number], p.venue,
          `${p.ward} · visited ${p.count} ${Number(p.count) === 1 ? "time" : "times"}${p.last ? ` · last ${fmt(p.last)}` : ""}`);
      });
      m.on("mouseleave", "places", () => {
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
          else show(at, p.title, visitLine(p));
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
          popup.remove();
        });
      }
      m.on("click", "ward-fill", (e) => {
        if (m.queryRenderedFeatures(e.point, { layers: ["visits", "places"] }).length) return; // a pin was clicked
        onSelectRef.current(String(e.features?.[0]?.properties?.ward_id ?? "") || null);
      });
      // Click a visit: pinned details card (who, when, attendance, exact vs approximate).
      const pin = new maplibregl.Popup({ closeButton: true, offset: 14, className: "chq-popup", maxWidth: "280px" });
      m.on("click", "places", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        popup.remove();
        pin.setLngLat((f.geometry as Point).coordinates as [number, number]).setDOMContent(placeCard(f.properties as Record<string, unknown>)).addTo(m);
      });
      m.on("click", "visits", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        popup.remove();
        pin.setLngLat((f.geometry as Point).coordinates as [number, number]).setDOMContent(visitCard(f.properties as Record<string, unknown>)).addTo(m);
      });

      // Keep the map on Mombasa County: no drifting off to the rest of Kenya.
      const b = new maplibregl.LngLatBounds();
      for (const f of boundaries.features) for (const poly of (f.geometry as MultiPolygon).coordinates) for (const [x, y] of poly[0]) b.extend([x, y]);
      if (!b.isEmpty()) {
        const pad = 0.12;
        m.setMaxBounds([[b.getWest() - pad, b.getSouth() - pad], [b.getEast() + pad, b.getNorth() + pad]]);
        m.setMinZoom(9.4);
      }
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
    (m.getSource("places") as GeoJSONSource).setData(placeFc);
  }, [loaded, wardFc, stationFc, visitFc, placeFc]);

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
    for (const id of ["places", "places-halo", "places-count"]) m.setLayoutProperty(id, "visibility", vis(layers.visits));
    m.setLayoutProperty("ward-label", "visibility", vis(layers.labels));
  }, [loaded, layers]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setPaintProperty("ward-fill", "fill-color", mode === "visits" ? VISIT_FILL : FILL);
    m.setLayoutProperty("ward-visited", "visibility", mode === "progress" && layers.visited ? "visible" : "none");
    m.setLayoutProperty("ward-never", "visibility", mode === "visits" && layers.wards ? "visible" : "none");
  }, [loaded, mode, layers.visited, layers.wards]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setFilter("ward-selected", ["==", ["get", "ward_id"], selected ?? ""]);
  }, [loaded, selected]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m || !focus) return;
    m.flyTo({ center: [focus.lng, focus.lat], zoom: 16, speed: 1.4 });
  }, [loaded, focus]);

  // MapLibre's (unlayered) CSS forces `position: relative` on its container, which beats
  // Tailwind's layered utilities, so the positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="region" aria-label="Coverage map of Mombasa wards" />
    </div>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });

function visitLine(p: Record<string, unknown>) {
  const status = String(p.status).replace("_", " ");
  return p.exact ? `${status} · exact GPS check-in · click for details` : `${status} · ${fmt(String(p.when))} · planned location`;
}

/** Pinned place details: how many times the team has been here, and what happened. */
function placeCard(p: Record<string, unknown>) {
  const rows: [string, string][] = [
    ["Ward", String(p.ward)],
    ["Times visited", String(p.count)],
    ["Last visit", p.last ? fmt(String(p.last)) : "—"],
    ["Total attendance", Number(p.attendance) ? Number(p.attendance).toLocaleString() : "not recorded"],
    ["Location", p.exact ? "Exact GPS at check-in" : "Planned polling station"],
    ["Recent visits", String(p.titles)],
  ];
  return detailCard(String(p.venue), rows);
}

function detailCard(title: string, rows: [string, string][]) {
  const wrap = document.createElement("div");
  const t = document.createElement("p");
  t.className = "mb-1.5 text-sm font-semibold text-white";
  t.textContent = title;
  wrap.append(t);
  for (const [k, v] of rows) {
    const r = document.createElement("p");
    r.className = "text-xs leading-5 text-slate-300";
    const b = document.createElement("span");
    b.className = "text-slate-500";
    b.textContent = `${k}: `;
    r.append(b, document.createTextNode(v));
    wrap.append(r);
  }
  return wrap;
}

/** Pinned visit details, built from DOM nodes (textContent only). */
function visitCard(p: Record<string, unknown>) {
  const wrap = document.createElement("div");
  const rows: [string, string][] = [
    ["Ward", `${p.ward}`],
    ["Venue", `${p.venue}`],
    ["Status", String(p.status).replace("_", " ")],
    ["Location", p.exact ? "Exact GPS at check-in" : "Planned (polling station)"],
  ];
  if (p.by) rows.push(["Checked in by", String(p.by)]);
  if (p.checkin) rows.push(["Checked in", fmt(String(p.checkin))]);
  else rows.push(["Scheduled", fmt(String(p.when))]);
  if (Number(p.attendance) >= 0) rows.push(["Attendance", Number(p.attendance).toLocaleString()]);
  const t = document.createElement("p");
  t.className = "mb-1.5 text-sm font-semibold text-white";
  t.textContent = String(p.title);
  wrap.append(t);
  for (const [k, v] of rows) {
    const r = document.createElement("p");
    r.className = "text-xs leading-5 text-slate-300";
    const b = document.createElement("span");
    b.className = "text-slate-500";
    b.textContent = `${k}: `;
    r.append(b, document.createTextNode(v));
    wrap.append(r);
  }
  return wrap;
}

/** Tooltip built from DOM nodes with textContent, never from HTML strings. */
export function tooltip(title: string, sub: string) {
  const wrap = document.createElement("div");
  const t = document.createElement("p");
  t.className = "text-sm font-semibold text-white";
  t.textContent = title;
  const s = document.createElement("p");
  s.className = "text-xs text-slate-300";
  s.textContent = sub;
  wrap.append(t, s);
  return wrap;
}
