"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { LocateFixed, Map as MapIcon, Maximize2, Minimize2, Satellite } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MAP_STYLE } from "@/lib/config";
import { cn } from "@/lib/cn";
import type { MapOverview } from "@/lib/types";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function rings(f: Feature): Position[][] {
  const g = f.geometry as Polygon | MultiPolygon;
  return g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
}

const pt = (lng: number, lat: number, properties: Record<string, unknown>): Feature => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lng, lat] } });

/**
 * A field agent's own ward, spotlit: the ward glows over satellite imagery while the rest of the county
 * dims, with its polling centres, the places the team has been, today's visits and where the agent is now.
 */
export function AreaMap({ data, boundaries, wardId, visitIdsToday }: { data: MapOverview; boundaries: FeatureCollection; wardId: string; visitIdsToday: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const me = useRef<maplibregl.Marker | null>(null);
  const pulses = useRef<maplibregl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sat, setSat] = useState(true);
  const [full, setFull] = useState(false);
  const [locating, setLocating] = useState(false);

  const ward = data.wards.find((w) => w.id === wardId);
  const shape = useMemo(() => boundaries.features.find((f) => String(f.properties?.code) === ward?.code), [boundaries, ward?.code]);

  const layers = useMemo(() => {
    const stations = data.stations.filter((s) => s.ward_id === wardId);
    const places = data.places.filter((p) => p.ward_id === wardId);
    const today = new Set(visitIdsToday);
    const visits = data.visits.filter((v) => today.has(v.id) && v.lat != null && v.lng != null);
    return {
      ward: shape ? { type: "FeatureCollection", features: [shape] } as FeatureCollection : EMPTY,
      // Everything except the ward, darkened: a world polygon with the ward cut out.
      mask: shape ? {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...rings(shape)] } }],
      } as FeatureCollection : EMPTY,
      stations: { type: "FeatureCollection", features: stations.map((s) => pt(s.lng, s.lat, { name: s.name, exact: s.location === "exact" })) } as FeatureCollection,
      places: { type: "FeatureCollection", features: places.map((p) => pt(p.lng, p.lat, { venue: p.venue, count: p.count })) } as FeatureCollection,
      visits,
    };
  }, [data, wardId, shape, visitIdsToday]);

  useEffect(() => {
    if (!el.current || map.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const m = new maplibregl.Map({ container: el.current, style: MAP_STYLE, center: [39.66, -4.04], zoom: 12, attributionControl: { compact: true }, pitchWithRotate: false });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
      m.addSource("imagery", { type: "raster", tiles: [IMAGERY], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
      m.addLayer({ id: "imagery", type: "raster", source: "imagery" }, firstSymbol);
      for (const id of ["mask", "ward", "stations", "places"]) m.addSource(id, { type: "geojson", data: EMPTY });
      m.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#06101f", "fill-opacity": 0.62 } });
      m.addLayer({ id: "ward-tint", type: "fill", source: "ward", paint: { "fill-color": "#c9a227", "fill-opacity": 0.06 } });
      m.addLayer({ id: "ward-glow", type: "line", source: "ward", paint: { "line-color": "#c9a227", "line-width": 12, "line-opacity": 0.28, "line-blur": 8 } });
      m.addLayer({ id: "ward-edge", type: "line", source: "ward", paint: { "line-color": "#f3d774", "line-width": 2.5 } });
      m.addLayer({
        id: "places-halo", type: "circle", source: "places",
        paint: { "circle-radius": ["+", 12, ["*", 4, ["sqrt", ["get", "count"]]]], "circle-color": "#34c77b", "circle-opacity": 0.22 },
      });
      m.addLayer({
        id: "places", type: "circle", source: "places",
        paint: { "circle-radius": ["+", 7, ["*", 2.5, ["sqrt", ["get", "count"]]]], "circle-color": "#006b3f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      });
      m.addLayer({
        id: "places-count", type: "symbol", source: "places",
        layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 11, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });
      m.addLayer({
        id: "stations", type: "circle", source: "stations",
        paint: {
          "circle-radius": 6.5, "circle-color": ["case", ["get", "exact"], "#0b1f3a", "#ffffff"],
          "circle-stroke-color": ["case", ["get", "exact"], "#f3d774", "#0b1f3a"], "circle-stroke-width": 2.5,
        },
      });
      m.addLayer({
        id: "stations-label", type: "symbol", source: "stations", minzoom: 13.2,
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 9 },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(6,16,31,.9)", "text-halo-width": 1.5 },
      });
      const tip = new maplibregl.Popup({ closeButton: false, offset: 12, className: "chq-popup" });
      const show = (layer: string, text: (p: Record<string, unknown>) => string) => {
        m.on("click", layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const node = document.createElement("div");
          node.className = "text-xs font-semibold text-white";
          node.textContent = text(f.properties as Record<string, unknown>);
          tip.setLngLat(e.lngLat).setDOMContent(node).addTo(m);
        });
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      };
      show("stations", (p) => `${p.name}${p.exact ? "" : " (approximate location)"}`);
      show("places", (p) => `${p.venue}: visited ${p.count} ${Number(p.count) === 1 ? "time" : "times"}`);
      setLoaded(true);
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Data, and frame the ward.
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    (m.getSource("mask") as GeoJSONSource).setData(layers.mask);
    (m.getSource("ward") as GeoJSONSource).setData(layers.ward);
    (m.getSource("stations") as GeoJSONSource).setData(layers.stations);
    (m.getSource("places") as GeoJSONSource).setData(layers.places);
    for (const p of pulses.current) p.remove();
    pulses.current = layers.visits.map((v) => {
      const dot = document.createElement("div");
      dot.className = "area-pulse";
      dot.title = `${v.title}, ${new Date(v.scheduled_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}`;
      return new maplibregl.Marker({ element: dot }).setLngLat([v.lng!, v.lat!]).addTo(m);
    });
    if (shape) {
      const b = new maplibregl.LngLatBounds();
      for (const ring of rings(shape)) for (const [x, y] of ring) b.extend([x, y]);
      m.fitBounds(b, { padding: 36, duration: 0, maxZoom: 15.5 });
      m.setMaxBounds([[b.getWest() - 0.08, b.getSouth() - 0.08], [b.getEast() + 0.08, b.getNorth() + 0.08]]);
    }
  }, [loaded, layers, shape]);

  // Satellite or street map: the overlays adapt so they stay readable on both.
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m) return;
    m.setLayoutProperty("imagery", "visibility", sat ? "visible" : "none");
    m.setPaintProperty("mask", "fill-opacity", sat ? 0.62 : 0.45);
    m.setPaintProperty("ward-edge", "line-color", sat ? "#f3d774" : "#0b1f3a");
    m.setPaintProperty("stations-label", "text-color", sat ? "#ffffff" : "#0b1f3a");
    m.setPaintProperty("stations-label", "text-halo-color", sat ? "rgba(6,16,31,.9)" : "rgba(255,255,255,.95)");
  }, [loaded, sat]);

  useEffect(() => { const t = setTimeout(() => map.current?.resize(), 60); return () => clearTimeout(t); }, [full]);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [full]);

  const locate = () => {
    if (!navigator.geolocation) return toast.error("This device can't share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      const m = map.current;
      if (!m) return;
      const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      if (!me.current) {
        const dot = document.createElement("div");
        dot.className = "area-me";
        me.current = new maplibregl.Marker({ element: dot });
      }
      me.current.setLngLat(at).addTo(m);
      m.setMaxBounds(null);
      m.flyTo({ center: at, zoom: Math.max(m.getZoom(), 15), duration: 900 });
    }, (err) => {
      setLocating(false);
      toast.error(err.code === err.PERMISSION_DENIED ? "Allow location access for this site to see where you are." : "Couldn't find your location. Try again outside.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };

  return (
    <div ref={box} className={cn("bg-[#06101f]", full ? "fixed inset-0 z-50" : "relative h-full w-full")}>
      {/* maplibre makes its container position:relative, so size it explicitly */}
      <div ref={el} className="size-full" />
      {ward && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 max-w-[70%] rounded-xl bg-[#06101f]/85 px-3 py-2 text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
          <p className="text-xs font-semibold tracking-wider text-gold uppercase">{ward.constituency}</p>
          <p className="font-display text-base leading-tight font-bold">{ward.name}</p>
          <p className="mt-0.5 text-xs text-slate-300">
            {ward.achieved.toLocaleString()}{ward.target ? ` of ${ward.target.toLocaleString()}` : ""} captured · {layers.stations.features.length} polling centres
          </p>
        </div>
      )}
      <div className="absolute bottom-8 left-3 z-10 flex flex-col gap-2">
        <MapBtn label={sat ? "Street map" : "Satellite"} onClick={() => setSat((s) => !s)}>{sat ? <MapIcon className="size-4" /> : <Satellite className="size-4" />}</MapBtn>
        <MapBtn label="Where am I?" onClick={locate} busy={locating}><LocateFixed className="size-4" /></MapBtn>
        <MapBtn label={full ? "Exit full screen" : "Full screen"} onClick={() => setFull((f) => !f)}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</MapBtn>
      </div>
      <ul className="pointer-events-none absolute right-3 bottom-8 z-10 space-y-1 rounded-xl bg-[#06101f]/85 px-3 py-2 text-xs text-slate-200 shadow-lg ring-1 ring-white/10 backdrop-blur">
        <Legend dot="bg-[#0b1f3a] ring-2 ring-[#f3d774]">Polling centre</Legend>
        <Legend dot="bg-white ring-2 ring-[#0b1f3a]">Centre, location approximate</Legend>
        <Legend dot="bg-[#006b3f] ring-2 ring-white">Team has been here</Legend>
        {layers.visits.length > 0 && <Legend dot="bg-gold">Visit today</Legend>}
      </ul>
    </div>
  );
}

function MapBtn({ label, onClick, busy, children }: { label: string; onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn("grid size-10 place-items-center rounded-xl bg-[#06101f]/85 text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-[#0b1f3a]", busy && "animate-pulse")}>
      {children}
    </button>
  );
}

function Legend({ dot, children }: { dot: string; children: React.ReactNode }) {
  return <li className="flex items-center gap-2"><span className={cn("size-2.5 shrink-0 rounded-full", dot)} />{children}</li>;
}
