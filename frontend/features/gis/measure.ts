/** Great-circle measuring for the GIS Lab ruler (no GIS library needed at this scale). */
export type LngLat = [number, number];

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function distance(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const pathLength = (pts: LngLat[]) => pts.slice(1).reduce((sum, p, i) => sum + distance(pts[i], p), 0);

/** Spherical polygon area (m²), good to well under 1% at city scale. */
export function area(pts: LngLat[]): number {
  if (pts.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    total += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((total * R * R) / 2);
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`);
export const fmtArea = (m2: number) => (m2 < 1_000_000 ? `${Math.round(m2).toLocaleString()} m²` : `${(m2 / 1_000_000).toFixed(2)} km²`);
