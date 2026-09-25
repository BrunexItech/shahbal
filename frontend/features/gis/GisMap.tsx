"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { tooltip } from "@/features/map/CoverageMap";
import { CONSTITUENCY_COLORS, PROGRESS_STEPS } from "@/features/map/regions";
import { MAP_STYLE, MAPILLARY_TOKEN } from "@/lib/config";
import type { MapOverview } from "@/lib/types";

import { area, type LngLat, pathLength } from "./measure";

export type Base = "streets" | "satellite";
export type Theme = "constituency" | "progress" | "visits" | "captures";
export type GisLayers = { wards: boolean; labels: boolean; stations: boolean; places: boolean; density: boolean; street: boolean };
export type Selection = { kind: "ward"; id: string } | { kind: "place"; key: string } | { kind: "street"; id: string } | null;
export type MeasureResult = { points: number; distance: number; area: number };
export type GisMapHandle = { image: () => string | null; home: () => void };

export const VISIT_STEPS: [number, string, string][] = [[0, "#eef2f6", "Never"], [1, "#9dd2e8", "1"], [2, "#4fb0d4", "2"], [3, "#1587b3", "3–4"], [5, "#07506b", "5+"]];
export const CAPTURE_STEPS: [number, string, string][] = [[0, "#fdf6e3", "0–9"], [10, "#f5dc8f", "10+"], [50, "#e3b53a", "50+"], [100, "#b8860b", "100+"], [200, "#6b4f07", "200+"]];

const step = (prop: string, steps: [number, string, string][]) =>
  ["step", ["to-number", ["get", prop], 0], steps[0][1], ...steps.slice(1).flatMap(([v, c]) => [v, c])] as unknown as ExpressionSpecification;

const THEME_FILL: Record<Theme, ExpressionSpecification> = {
  constituency: ["match", ["get", "constituency"], ...Object.entries(CONSTITUENCY_COLORS).flat(), "#94a3b8"] as unknown as ExpressionSpecification,
  progress: ["case", ["==", ["get", "percent"], null], "#e2e8f0", step("percent", PROGRESS_STEPS)] as unknown as ExpressionSpecification,
  visits: step("visits", VISIT_STEPS),
  captures: step("achieved", CAPTURE_STEPS),
};

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const placeKey = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

function rings(f: Feature) {
  const g = f.geometry as Polygon | MultiPolygon;
  return g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
}

export const GisMap = forwardRef<GisMapHandle, {
  data: MapOverview;
  wards: FeatureCollection;
  constituencies: FeatureCollection;
  density: FeatureCollection | null;
  base: Base;
  threeD: boolean;
  theme: Theme;
  layers: GisLayers;
  measuring: "off" | "distance" | "area";
  measureReset: number;
  onMeasure: (m: MeasureResult) => void;
  replayAt: number | null;
  onSelect: (s: Selection) => void;
  selected: Selection;
  focus: { lng: number; lat: number; zoom?: number; key: number } | null;
}>(function GisMap(props, ref) {
  const { data, wards, constituencies, density, base, threeD, theme, layers, measuring, measureReset, onMeasure, replayAt, onSelect, selected, focus } = props;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cb = useRef({ onSelect, onMeasure, measuring });
  useEffect(() => {
    cb.current = { onSelect, onMeasure, measuring };
  }, [onSelect, onMeasure, measuring]);
  const pts = useRef<LngLat[]>([]);

  const byCode = useMemo(() => new Map(data.wards.map((w) => [w.code, w])), [data.wards]);
  const wardFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: wards.features.filter((f) => byCode.has(String(f.properties?.code))).map((f, i) => {
      const w = byCode.get(String(f.properties?.code))!;
      return {
        ...f, id: i,
        properties: { ...f.properties, ward_id: w.id, percent: w.target ? w.percent : null, achieved: w.achieved, target: w.target, visits: w.visits_completed },
      };
    }),
  }), [wards, byCode]);
  const maxAchieved = useMemo(() => Math.max(1, ...data.wards.map((w) => w.achieved)), [data.wards]);

  const visible = useMemo(() => new Set(data.wards.map((w) => w.constituency)), [data.wards]);
  const consFc = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features: constituencies.features.filter((f) => visible.has(String(f.properties?.name))) }), [constituencies, visible]);
  const consLabels = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: consFc.features.map((f) => ({ type: "Feature", properties: { name: String(f.properties?.name).toUpperCase() }, geometry: { type: "Point", coordinates: [Number(f.properties?.label_lng), Number(f.properties?.label_lat)] } })),
  }), [consFc]);

  const stationFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: data.stations.map((s) => ({ type: "Feature", properties: { name: s.name, code: s.code, captured: s.captured }, geometry: { type: "Point", coordinates: [s.lng, s.lat] } })),
  }), [data.stations]);

  // Replay: only visits up to the chosen moment count.
  const placeFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: data.places.flatMap((p) => {
      const n = replayAt == null ? p.count : p.dates.filter((d) => new Date(d).getTime() <= replayAt).length;
      if (!n) return [];
      return [{ type: "Feature" as const, properties: { key: placeKey(p), venue: p.venue, ward: p.ward, count: n, exact: p.exact, photos: p.photos }, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } }];
    }),
  }), [data.places, replayAt]);

  const heatFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: (density?.features ?? []).map((f) => {
      const ring = (f.geometry as Polygon).coordinates[0];
      return { type: "Feature", properties: { w: Number(f.properties?.captures ?? 0) }, geometry: { type: "Point", coordinates: [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2] } };
    }),
  }), [density]);

  useImperativeHandle(ref, () => ({
    image: () => {
      const m = map.current;
      if (!m) return null;
      m.triggerRepaint();
      return m.getCanvas().toDataURL("image/png");
    },
    home: () => {
      const m = map.current;
      if (!m || !consFc.features.length) return;
      const b = new maplibregl.LngLatBounds();
      for (const f of consFc.features) for (const r of rings(f)) for (const [x, y] of r) b.extend([x, y]);
      m.fitBounds(b, { padding: 40, duration: 900, pitch: m.getPitch() });
    },
  }), [consFc]);

  // ---- create once ---------------------------------------------------------------
  useEffect(() => {
    if (!el.current || map.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const m = new maplibregl.Map({
      container: el.current, style: MAP_STYLE, center: [39.665, -4.03], zoom: 10.8, maxPitch: 70,
      attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    m.doubleClickZoom.disable();

    m.on("load", () => {
      const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
      m.addSource("imagery", { type: "raster", tiles: [IMAGERY], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
      m.addLayer({ id: "imagery", type: "raster", source: "imagery", layout: { visibility: "none" } }, firstSymbol);
      // 3D buildings from the base map's own vector tiles.
      m.addLayer({
        id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13.5,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#cbd5e1",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      });

      for (const id of ["wards", "cons", "cons-labels", "stations", "places", "heat", "measure"]) m.addSource(id, { type: "geojson", data: EMPTY });
      if (MAPILLARY_TOKEN) {
        m.addSource("mly", { type: "vector", tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${MAPILLARY_TOKEN}`], minzoom: 6, maxzoom: 14 });
      }

      m.addLayer({ id: "heat", type: "heatmap", source: "heat", layout: { visibility: "none" }, paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "w"], 0, 0, 60, 1],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 18, 15, 60],
        "heatmap-intensity": 1.1, "heatmap-opacity": 0.8,
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "#fde68a", 0.5, "#f59e0b", 0.8, "#dc2626", 1, "#7f1d1d"],
      } });
      m.addLayer({ id: "ward-fill", type: "fill", source: "wards", paint: { "fill-color": THEME_FILL.constituency, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.85, 0.62] } });
      m.addLayer({ id: "ward-3d", type: "fill-extrusion", source: "wards", layout: { visibility: "none" }, paint: {
        "fill-extrusion-color": THEME_FILL.constituency, "fill-extrusion-opacity": 0.88,
        "fill-extrusion-height": ["*", ["/", ["to-number", ["get", "achieved"], 0], maxAchieved], 2500],
      } });
      m.addLayer({ id: "ward-line", type: "line", source: "wards", paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.5] } });
      m.addLayer({ id: "cons-line", type: "line", source: "cons", paint: { "line-color": "#0b1f3a", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 4] } });
      m.addLayer({ id: "ward-selected", type: "line", source: "wards", filter: ["==", ["get", "ward_id"], ""], paint: { "line-color": "#c9a227", "line-width": 4.5 } });
      if (MAPILLARY_TOKEN) {
        m.addLayer({ id: "mly-seq", type: "line", source: "mly", "source-layer": "sequence", layout: { visibility: "none", "line-cap": "round" }, paint: { "line-color": "#05cb63", "line-width": 2, "line-opacity": 0.8 } });
        m.addLayer({ id: "mly-img", type: "circle", source: "mly", "source-layer": "image", minzoom: 14, layout: { visibility: "none" }, paint: { "circle-radius": 5, "circle-color": "#05cb63", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      }
      m.addLayer({ id: "stations", type: "circle", source: "stations", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7], "circle-color": "#0b1f3a", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
      } });
      m.addLayer({ id: "places-halo", type: "circle", source: "places", paint: { "circle-radius": ["+", 12, ["*", 4, ["sqrt", ["get", "count"]]]], "circle-color": "#006b3f", "circle-opacity": 0.2 } });
      m.addLayer({ id: "places", type: "circle", source: "places", paint: {
        "circle-radius": ["+", 8, ["*", 3, ["sqrt", ["get", "count"]]]],
        "circle-color": ["case", ["get", "exact"], "#006b3f", "#64748b"], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5,
      } });
      m.addLayer({ id: "places-count", type: "symbol", source: "places", layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }, paint: { "text-color": "#fff" } });
      m.addLayer({ id: "ward-label", type: "symbol", source: "wards", minzoom: 11.4, layout: { "text-field": ["get", "name"], "text-size": 13, "text-font": ["Noto Sans Bold"], "text-max-width": 7 },
        paint: { "text-color": "#0b1f3a", "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 1.8 } });
      m.addLayer({ id: "cons-label", type: "symbol", source: "cons-labels", maxzoom: 12, layout: { "text-field": ["get", "name"], "text-size": ["interpolate", ["linear"], ["zoom"], 9.5, 13, 12, 18], "text-font": ["Noto Sans Bold"], "text-letter-spacing": 0.14, "text-allow-overlap": true },
        paint: { "text-color": "#0b1f3a", "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 2.4 } });
      m.addLayer({ id: "measure-fill", type: "fill", source: "measure", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#c9a227", "fill-opacity": 0.18 } });
      m.addLayer({ id: "measure-line", type: "line", source: "measure", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#c9a227", "line-width": 3, "line-dasharray": [2, 1] } });
      m.addLayer({ id: "measure-pt", type: "circle", source: "measure", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#c9a227", "circle-stroke-width": 3 } });

      // ---- interactions ----
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "chq-popup" });
      let hovered: number | string | undefined;
      const hover = (e: maplibregl.MapLayerMouseEvent) => {
        if (cb.current.measuring !== "off") return;
        const f = e.features?.[0];
        if (!f) return;
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = f.id;
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: true });
        m.getCanvas().style.cursor = "pointer";
        const p = f.properties as { name: string; constituency: string; achieved: number; target: number; percent: number | null; visits: number };
        popup.setLngLat(e.lngLat).setDOMContent(tooltip(`${p.name} · ${p.constituency}`,
          `${Number(p.achieved).toLocaleString()} of ${Number(p.target).toLocaleString()} captured · ${p.visits} visit${Number(p.visits) === 1 ? "" : "s"}`)).addTo(m);
      };
      const leave = () => {
        if (hovered !== undefined) m.setFeatureState({ source: "wards", id: hovered }, { hover: false });
        hovered = undefined;
        m.getCanvas().style.cursor = cb.current.measuring !== "off" ? "crosshair" : "";
        popup.remove();
      };
      for (const l of ["ward-fill", "ward-3d"]) { m.on("mousemove", l, hover); m.on("mouseleave", l, leave); }
      m.on("mouseenter", "places", (e) => {
        const p = e.features?.[0]?.properties as { venue: string; count: number; photos: number } | undefined;
        if (!p || cb.current.measuring !== "off") return;
        m.getCanvas().style.cursor = "pointer";
        popup.setLngLat(e.lngLat).setDOMContent(tooltip(p.venue, `Visited ${p.count} ${Number(p.count) === 1 ? "time" : "times"}${Number(p.photos) ? ` · ${p.photos} photo${Number(p.photos) > 1 ? "s" : ""}` : ""} · click for details`)).addTo(m);
      });
      m.on("mouseleave", "places", leave);
      m.on("mouseenter", "stations", (e) => {
        const p = e.features?.[0]?.properties as { name: string; code: string; captured: number } | undefined;
        if (!p || cb.current.measuring !== "off") return;
        popup.setLngLat(e.lngLat).setDOMContent(tooltip(p.name, `Polling station ${p.code} · ${Number(p.captured).toLocaleString()} captured`)).addTo(m);
      });
      m.on("mouseleave", "stations", leave);
      if (m.getLayer("mly-img")) {
        m.on("mouseenter", "mly-img", () => { if (cb.current.measuring === "off") m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "mly-img", () => { m.getCanvas().style.cursor = cb.current.measuring !== "off" ? "crosshair" : ""; });
      }

      const redrawMeasure = () => {
        const p = pts.current;
        const mode = cb.current.measuring;
        const feats: Feature[] = p.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
        if (p.length > 1) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: mode === "area" && p.length > 2 ? [...p, p[0]] : p } });
        if (mode === "area" && p.length > 2) feats.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...p, p[0]]] } });
        (m.getSource("measure") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
        cb.current.onMeasure({ points: p.length, distance: pathLength(mode === "area" && p.length > 2 ? [...p, p[0]] : p), area: mode === "area" ? area(p) : 0 });
      };
      (m as unknown as { __redrawMeasure: () => void }).__redrawMeasure = redrawMeasure;

      m.on("click", (e) => {
        if (cb.current.measuring !== "off") {
          pts.current = [...pts.current, [e.lngLat.lng, e.lngLat.lat]];
          redrawMeasure();
          return;
        }
        // Points are small (and fingers aren't), so a few pixels around the tap count for them.
        const shown = (ids: string[]) => ids.filter((l) => m.getLayer(l) && m.getLayoutProperty(l, "visibility") !== "none");
        const pad = 10;
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
        const f = m.queryRenderedFeatures(box, { layers: shown(["places", "mly-img"]) })[0]
          ?? m.queryRenderedFeatures(e.point, { layers: shown(["ward-fill", "ward-3d"]) })[0];
        if (!f) return cb.current.onSelect(null);
        if (f.layer.id === "places") cb.current.onSelect({ kind: "place", key: String(f.properties?.key) });
        else if (f.layer.id === "mly-img") cb.current.onSelect({ kind: "street", id: String(f.properties?.id) });
        else cb.current.onSelect({ kind: "ward", id: String(f.properties?.ward_id) });
      });

      // Keep the map on Mombasa County.
      const b = new maplibregl.LngLatBounds();
      for (const f of constituencies.features) for (const r of rings(f)) for (const [x, y] of r) b.extend([x, y]);
      if (!b.isEmpty()) {
        m.fitBounds(b, { padding: 40, duration: 0 });
        m.setMaxBounds([[b.getWest() - 0.15, b.getSouth() - 0.15], [b.getEast() + 0.15, b.getNorth() + 0.15]]);
        m.setMinZoom(9.2);
      }
      setLoaded(true);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once
  }, []);

  // ---- data ----------------------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    (m.getSource("wards") as GeoJSONSource).setData(wardFc);
    (m.getSource("cons") as GeoJSONSource).setData(consFc);
    (m.getSource("cons-labels") as GeoJSONSource).setData(consLabels);
    (m.getSource("stations") as GeoJSONSource).setData(stationFc);
    (m.getSource("places") as GeoJSONSource).setData(placeFc);
    (m.getSource("heat") as GeoJSONSource).setData(heatFc);
    m.setPaintProperty("ward-3d", "fill-extrusion-height", ["*", ["/", ["to-number", ["get", "achieved"], 0], maxAchieved], 2500]);
  }, [loaded, wardFc, consFc, consLabels, stationFc, placeFc, heatFc, maxAchieved]);

  // ---- look & layers -------------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    m.setPaintProperty("ward-fill", "fill-color", THEME_FILL[theme]);
    m.setPaintProperty("ward-3d", "fill-extrusion-color", THEME_FILL[theme]);
    m.setPaintProperty("ward-fill", "fill-opacity", ["case", ["boolean", ["feature-state", "hover"], false], base === "satellite" ? 0.7 : 0.85, base === "satellite" ? 0.42 : 0.62]);
    vis("imagery", base === "satellite");
    vis("ward-fill", layers.wards && !threeD);
    vis("ward-3d", layers.wards && threeD);
    vis("buildings-3d", threeD);
    vis("ward-label", layers.labels);
    vis("cons-label", layers.labels);
    vis("stations", layers.stations);
    for (const id of ["places", "places-halo", "places-count"]) vis(id, layers.places);
    vis("heat", layers.density);
    vis("mly-seq", layers.street);
    vis("mly-img", layers.street);
    m.setPaintProperty("cons-label", "text-color", base === "satellite" ? "#ffffff" : "#0b1f3a");
    m.setPaintProperty("cons-label", "text-halo-color", base === "satellite" ? "rgba(6,16,31,.85)" : "rgba(255,255,255,.95)");
    m.setPaintProperty("cons-line", "line-color", base === "satellite" ? "#ffffff" : "#0b1f3a");
  }, [loaded, base, threeD, theme, layers]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.easeTo({ pitch: threeD ? 58 : 0, bearing: threeD ? -18 : 0, duration: 1100 });
  }, [loaded, threeD]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setFilter("ward-selected", ["==", ["get", "ward_id"], selected?.kind === "ward" ? selected.id : ""]);
  }, [loaded, selected]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    pts.current = [];
    m.getCanvas().style.cursor = measuring !== "off" ? "crosshair" : "";
    (m as unknown as { __redrawMeasure?: () => void }).__redrawMeasure?.();
  }, [loaded, measuring, measureReset]);

  useEffect(() => {
    const m = map.current;
    if (!loaded || !m || !focus) return;
    m.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 16.5, speed: 1.3 });
  }, [loaded, focus]);

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="region" aria-label="Mombasa GIS map" />
    </div>
  );
});
