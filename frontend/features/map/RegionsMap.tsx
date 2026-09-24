"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { tooltip } from "@/features/map/CoverageMap";
import { CONSTITUENCY_COLORS, PROGRESS_STEPS } from "@/features/map/regions";
import { MAP_STYLE } from "@/lib/config";
import type { MapOverview } from "@/lib/types";

export type RegionView = "constituencies" | "progress";

const BY_CONSTITUENCY = [
  "match", ["get", "constituency"], ...Object.entries(CONSTITUENCY_COLORS).flat(), "#94a3b8",
] as unknown as ExpressionSpecification;

const BY_PROGRESS = [
  "case", ["==", ["get", "percent"], null], "#e2e8f0",
  ["step", ["get", "percent"], PROGRESS_STEPS[0][1], ...PROGRESS_STEPS.slice(1).flatMap(([v, c]) => [v, c])],
] as unknown as ExpressionSpecification;

/** Every outer ring of a Polygon/MultiPolygon, for fitting bounds. */
function rings(f: Feature): Position[][] {
  const g = f.geometry as Polygon | MultiPolygon;
  return g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
}

export function boundsOf(features: Feature[]) {
  const b = new maplibregl.LngLatBounds();
  for (const f of features) for (const ring of rings(f)) for (const [x, y] of ring) b.extend([x, y]);
  return b;
}

/**
 * Mombasa's political geography at a glance: the six constituencies in their own
 * colours, the 30 IEBC wards inside them, and the polling stations. Switch to
 * "progress" to shade each ward by how close it is to target.
 */
export function RegionsMap({ data, wards, constituencies, view, showStations, selected, onSelect, flyTo }: {
  data: MapOverview;
  wards: FeatureCollection;
  constituencies: FeatureCollection;
  view: RegionView;
  showStations: boolean;
  selected: string | null;
  onSelect: (sel: { kind: "ward"; id: string } | null) => void;
  /** Constituency name to frame; "county" frames all of Mombasa. */
  flyTo: { target: string; key: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const byCode = useMemo(() => new Map(data.wards.map((w) => [w.code, w])), [data.wards]);

  const wardFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: wards.features.filter((f) => byCode.has(String(f.properties?.code))).map((f, i) => {
      const w = byCode.get(String(f.properties?.code))!;
      return { ...f, id: i, properties: { ...f.properties, ward_id: w.id, percent: w.target ? w.percent : null, achieved: w.achieved, target: w.target } };
    }),
  }), [wards, byCode]);

  const visibleCons = useMemo(() => new Set(data.wards.map((w) => w.constituency)), [data.wards]);
  const consFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: constituencies.features.filter((f) => visibleCons.has(String(f.properties?.name))),
  }), [constituencies, visibleCons]);
  const consLabels = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: consFc.features.map((f) => ({
      type: "Feature", properties: { name: String(f.properties?.name).toUpperCase() },
      geometry: { type: "Point", coordinates: [Number(f.properties?.label_lng), Number(f.properties?.label_lat)] },
    })),
  }), [consFc]);

  const stationFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: data.stations.map((s) => ({
      type: "Feature", properties: { name: s.name, code: s.code, captured: s.captured },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  }), [data.stations]);

  useEffect(() => {
    if (!el.current || map.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const m = new maplibregl.Map({ container: el.current, style: MAP_STYLE, center: [39.665, -4.03], zoom: 10.8, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const id of ["wards", "cons", "cons-labels", "stations"]) m.addSource(id, { type: "geojson", data: empty });
      m.addLayer({
        id: "ward-fill", type: "fill", source: "wards",
        paint: { "fill-color": BY_CONSTITUENCY, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.75, 0.5] },
      });
      m.addLayer({ id: "ward-line", type: "line", source: "wards", paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 2] } });
      m.addLayer({ id: "cons-line", type: "line", source: "cons", paint: { "line-color": "#0b1f3a", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 13, 3.5] } });
      m.addLayer({ id: "ward-selected", type: "line", source: "wards", filter: ["==", ["get", "ward_id"], ""], paint: { "line-color": "#c9a227", "line-width": 4 } });
      m.addLayer({
        id: "stations", type: "circle", source: "stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6],
          "circle-color": "#0b1f3a", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2,
        },
      });
      m.addLayer({
        id: "ward-label", type: "symbol", source: "wards", minzoom: 11.4,
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Regular"], "text-max-width": 7 },
        paint: { "text-color": "#0b1f3a", "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 1.6 },
      });
      m.addLayer({
        id: "cons-label", type: "symbol", source: "cons-labels", maxzoom: 12.8,
        layout: { "text-field": ["get", "name"], "text-size": ["interpolate", ["linear"], ["zoom"], 9.5, 12, 12, 17], "text-font": ["Noto Sans Bold"], "text-letter-spacing": 0.12, "text-allow-overlap": true },
        paint: { "text-color": "#0b1f3a", "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 2.2 },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "chq-popup" });
      let hovered: number | string | undefined;
      m.on("mousemove", "ward-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = f.id;
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: true });
        m.getCanvas().style.cursor = "pointer";
        const p = f.properties as { name: string; constituency: string; percent: number | null; achieved: number; target: number };
        popup.setLngLat(e.lngLat).setDOMContent(tooltip(`${p.name} · ${p.constituency}`, p.target
          ? `${p.achieved.toLocaleString()} of ${p.target.toLocaleString()} reached (${p.percent ?? 0}%)`
          : `${p.achieved.toLocaleString()} captured · no target set`)).addTo(m);
      });
      m.on("mouseleave", "ward-fill", () => {
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = undefined;
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      m.on("mouseenter", "stations", (e) => {
        const p = e.features?.[0]?.properties as { name: string; code: string; captured: number } | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(tooltip(p.name, `Polling station ${p.code} · ${Number(p.captured).toLocaleString()} captured`)).addTo(m);
      });
      m.on("mouseleave", "stations", () => popup.remove());
      m.on("click", "ward-fill", (e) => {
        const id = String(e.features?.[0]?.properties?.ward_id ?? "");
        onSelectRef.current(id ? { kind: "ward", id } : null);
      });
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
    (m.getSource("cons") as GeoJSONSource).setData(consFc);
    (m.getSource("cons-labels") as GeoJSONSource).setData(consLabels);
    (m.getSource("stations") as GeoJSONSource).setData(stationFc);
  }, [loaded, wardFc, consFc, consLabels, stationFc]);

  // Frame the county (or this viewer's area) once, and keep the map on Mombasa.
  const fitted = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m || fitted.current || !consFc.features.length) return;
    const b = boundsOf(consFc.features);
    m.fitBounds(b, { padding: 28, duration: 0 });
    const pad = 0.12;
    m.setMaxBounds([[b.getWest() - pad, b.getSouth() - pad], [b.getEast() + pad, b.getNorth() + pad]]);
    fitted.current = true;
  }, [loaded, consFc]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setPaintProperty("ward-fill", "fill-color", view === "constituencies" ? BY_CONSTITUENCY : BY_PROGRESS);
    m.setPaintProperty("ward-fill", "fill-opacity", view === "constituencies"
      ? ["case", ["boolean", ["feature-state", "hover"], false], 0.75, 0.5]
      : ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.88]);
    m.setLayoutProperty("stations", "visibility", showStations ? "visible" : "none");
  }, [loaded, view, showStations]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setFilter("ward-selected", ["==", ["get", "ward_id"], selected ?? ""]);
  }, [loaded, selected]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m || !flyTo) return;
    const feats = flyTo.target === "county" ? consFc.features : consFc.features.filter((f) => f.properties?.name === flyTo.target);
    if (feats.length) m.fitBounds(boundsOf(feats), { padding: 40, duration: 900, maxZoom: 13.2 });
  }, [loaded, flyTo, consFc]);

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="region" aria-label="Map of Mombasa constituencies and wards" />
    </div>
  );
}
