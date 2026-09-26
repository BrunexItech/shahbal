"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark, LoaderCircle, MapPin, Search, Vote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export type SearchHit = { kind: "ward" | "station" | "place"; id: string; label: string; sub: string; lat: number; lng: number };

const ICON = { ward: Landmark, station: Vote, place: MapPin };

/** Type a ward, polling centre or any real place in Mombasa; pick it and the map flies there. */
export function MapSearch({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = window.setTimeout(() => setQ(text.trim()), 300); return () => window.clearTimeout(t); }, [text]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const res = useQuery({ queryKey: ["map-search", q], queryFn: () => api<SearchHit[]>("/map/search", { query: { q } }), enabled: q.length >= 2, staleTime: 5 * 60_000 });
  const hits = res.data ?? [];
  useEffect(() => setActive(0), [q]);

  const pick = (h: SearchHit) => { onPick(h); setText(h.label); setOpen(false); };

  return (
    <div ref={box} className="relative">
      <label className="flex h-11 items-center gap-2 rounded-xl bg-white px-3 shadow-lg ring-1 ring-line focus-within:ring-2 focus-within:ring-ocean">
        {res.isFetching ? <LoaderCircle className="size-4 shrink-0 animate-spin text-slate-400" /> : <Search className="size-4 shrink-0 text-slate-400" />}
        <input value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && hits[active]) { e.preventDefault(); pick(hits[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search a place, ward or polling centre" aria-label="Search the map" role="combobox" aria-expanded={open && hits.length > 0}
          aria-controls="map-search-list" className="min-w-0 flex-1 bg-transparent text-base text-navy-900 placeholder:text-slate-400 focus:outline-none sm:text-sm" />
        {text && <button onClick={() => { setText(""); setQ(""); }} aria-label="Clear search" className="text-slate-400 hover:text-navy-900"><X className="size-4" /></button>}
      </label>
      {open && q.length >= 2 && !res.isFetching && (
        <ul id="map-search-list" role="listbox" className="absolute inset-x-0 z-30 mt-1.5 max-h-80 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-2xl ring-1 ring-line">
          {hits.map((h, i) => {
            const Icon = ICON[h.kind];
            return (
              <li key={h.id} role="option" aria-selected={i === active}>
                <button onMouseEnter={() => setActive(i)} onClick={() => pick(h)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", i === active ? "bg-slate-100" : "hover:bg-slate-50")}>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", h.kind === "place" ? "bg-ocean-50 text-ocean" : "bg-navy-950 text-gold")}><Icon className="size-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy-900">{h.label}</span>
                    <span className="block truncate text-xs text-slate-500">{h.sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {!hits.length && <li className="px-3 py-3 text-sm text-slate-500">Nothing found in Mombasa for “{q}”.</li>}
        </ul>
      )}
    </div>
  );
}
