import type { MapOverview } from "@/lib/types";

/** Plain spreadsheet (CSV opens in Excel) — totals and campaign activity only, no voter details. */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // never let a cell run as a formula
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  save(blob, name);
}

export function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function wardRows(d: MapOverview) {
  return [
    ["Constituency", "Ward", "Captured", "Target", "Progress %", "Gap", "Verified", "Supporters", "Visits done", "Visits planned", "Last visit"],
    ...d.wards.map((w) => [w.constituency, w.name, w.achieved, w.target, w.percent, w.gap, w.verified, w.supporters, w.visits_completed, w.visits_upcoming, w.last_visit_at?.slice(0, 10)]),
  ];
}

export function placeRows(d: MapOverview) {
  return [
    ["Place", "Ward", "Times visited", "Attendance", "Last visit", "Photos", "Latitude", "Longitude", "Exact GPS"],
    ...d.places.map((p) => [p.venue, p.ward, p.count, p.attendance, p.last_at?.slice(0, 10), p.photos, p.lat.toFixed(6), p.lng.toFixed(6), p.exact ? "yes" : "no"]),
  ];
}

/** Printable A4 sheet: title, the map as rendered, legend and date. Uses the browser's own print / Save as PDF. */
export function printMap(image: string, title: string, subtitle: string, legend: [string, string][]) {
  const w = window.open("", "_blank", "noopener=no");
  if (!w) return;
  const doc = w.document;
  doc.title = title;
  const style = doc.createElement("style");
  style.textContent = `@page{size:A4 landscape;margin:12mm}body{font-family:system-ui,sans-serif;color:#0b1f3a;margin:0}
    h1{font-size:20px;margin:0}p{margin:2px 0 10px;color:#475569;font-size:12px}img{width:100%;border-radius:8px;border:1px solid #e2e8f0}
    .flag{display:flex;height:5px;margin-bottom:10px}.flag i{flex:1}.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:12px}
    .legend span{display:inline-flex;align-items:center;gap:6px}.legend b{width:12px;height:12px;border-radius:3px;display:inline-block}`;
  doc.head.append(style);
  const flag = doc.createElement("div");
  flag.className = "flag";
  for (const c of ["#111", "#fff", "#bb1e10", "#fff", "#006b3f"]) { const i = doc.createElement("i"); i.style.background = c; flag.append(i); }
  const h = doc.createElement("h1"); h.textContent = title;
  const p = doc.createElement("p"); p.textContent = subtitle;
  const img = doc.createElement("img"); img.src = image; img.alt = title;
  const lg = doc.createElement("div"); lg.className = "legend";
  for (const [label, color] of legend) {
    const s = doc.createElement("span"); const b = doc.createElement("b"); b.style.background = color;
    s.append(b, doc.createTextNode(label)); lg.append(s);
  }
  doc.body.append(flag, h, p, img, lg);
  img.onload = () => setTimeout(() => w.print(), 200);
}
