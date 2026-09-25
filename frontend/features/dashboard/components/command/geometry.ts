import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

export function polys(f: Feature): Position[][][] {
  const g = f.geometry as Polygon | MultiPolygon;
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/**
 * Project Mombasa's constituencies and wards into SVG space (equirectangular, true to
 * shape at this latitude). Shared by the live map and the attention radar.
 */
export function buildGeometry(constituencies: FeatureCollection, wards: FeatureCollection, W: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of constituencies.features) for (const p of polys(f)) for (const [x, y] of p[0]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const scale = W / ((maxX - minX) * k);
  const H = Math.round((maxY - minY) * scale);
  const pt = ([x, y]: Position) => [((x - minX) * k * scale).toFixed(1), ((maxY - y) * scale).toFixed(1)] as const;
  const path = (f: Feature) => polys(f).map((p) => p.map((ring) => `M${ring.map((c) => pt(c).join(",")).join("L")}Z`).join("")).join("");
  const centre = (f: Feature): [number, number] => {
    const ring = [...polys(f)].sort((a, b) => b[0].length - a[0].length)[0][0];
    const [sx, sy] = ring.reduce(([ax, ay], c) => { const [x, y] = pt(c); return [ax + +x, ay + +y]; }, [0, 0]);
    return [sx / ring.length, sy / ring.length];
  };
  return {
    W, H, pt,
    cons: constituencies.features.map((f) => ({
      name: String(f.properties?.name), d: path(f),
      label: pt([Number(f.properties?.label_lng), Number(f.properties?.label_lat)]),
    })),
    wards: wards.features.map((f) => ({ name: String(f.properties?.name), d: path(f), c: centre(f) })),
  };
}

export type Geometry = ReturnType<typeof buildGeometry>;
