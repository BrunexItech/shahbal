"use client";

import { ChevronRight, MessageCircle, MessageSquareText, Search, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Skeleton, Spinner } from "@/components/loaders";
import { Card, EmptyState, ErrorState, PageHeader, SUPPORT, SupportBadge } from "@/components/ui";
import { type AudienceConstituency, type AudienceWard, useAudiencePeople, useAudienceTree } from "@/features/audience/api";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { can } from "@/lib/roles";
import type { Support } from "@/lib/types";

type Sel = { c: Set<string>; w: Set<string>; s: Set<string> };
const EMPTY: Sel = { c: new Set(), w: new Set(), s: new Set() };
const SUPPORT_FILTERS: Support[] = ["supporter", "leaning", "undecided", "unknown"];

/**
 * Audiences: everyone we can reach, organised by place. Tick any mix of constituencies,
 * wards and polling stations, check who's in it, and send an SMS or WhatsApp to exactly
 * that group. Counts come from the same filter messaging uses, so they always agree.
 */
export default function AudiencesPage() {
  const user = useUser();
  const router = useRouter();
  const tree = useAudienceTree();
  const [sel, setSel] = useState<Sel>(EMPTY);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [find, setFind] = useState("");
  const [support, setSupport] = useState<Support[]>([]);
  const [q, setQ] = useState("");

  const audience = useMemo(() => ({
    constituency_ids: [...sel.c], ward_ids: [...sel.w], station_ids: [...sel.s], support,
  }), [sel, support]);
  const people = useAudiencePeople(audience, q);
  const count = sel.c.size + sel.w.size + sel.s.size;

  const toggle = (k: keyof Sel, id: string) => setSel((cur) => {
    const next = { c: new Set(cur.c), w: new Set(cur.w), s: new Set(cur.s) };
    if (next[k].has(id)) next[k].delete(id);
    else next[k].add(id);
    return next;
  });
  const expand = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of tree.data?.constituencies ?? []) {
      m.set(c.id, c.name);
      for (const w of c.wards) { m.set(w.id, w.name); for (const s of w.stations) m.set(s.id, s.name); }
    }
    return m;
  }, [tree.data]);

  const needle = find.trim().toLowerCase();
  const visible = useMemo(() => (tree.data?.constituencies ?? []).map((c) => ({
    ...c,
    wards: c.wards.filter((w) => !needle || c.name.toLowerCase().includes(needle) || w.name.toLowerCase().includes(needle)
      || w.stations.some((s) => s.name.toLowerCase().includes(needle))),
  })).filter((c) => !needle || c.wards.length), [tree.data, needle]);

  const send = (channel: "sms" | "whatsapp") => {
    const p = new URLSearchParams({ channel });
    if (sel.c.size) p.set("c", [...sel.c].join(","));
    if (sel.w.size) p.set("w", [...sel.w].join(","));
    if (sel.s.size) p.set("s", [...sel.s].join(","));
    if (support.length) p.set("support", support.join(","));
    router.push(`/messaging/new?${p}`);
  };

  if (!can.message(user.role)) return <Card><EmptyState title="Audiences are for coordinators and HQ" body="Ask your coordinator to message your area." /></Card>;
  if (tree.error) return <Card><ErrorState error={tree.error} onRetry={tree.refetch} /></Card>;

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Audiences"
        subtitle="Everyone we can reach, by constituency, ward and polling station. Pick a region and message exactly those people." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Region tree */}
        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-line bg-slate-50/60 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-navy-900">Choose regions</p>
              {tree.data && <p className="text-xs text-slate-500 tabular-nums"><b className="text-navy-900">{num(tree.data.reachable)}</b> reachable of {num(tree.data.people)} people</p>}
            </div>
            <label className="relative mt-3 block">
              <span className="sr-only">Find a ward or polling station</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={find} onChange={(e) => setFind(e.target.value)} type="search" placeholder="Find a ward or polling station…"
                className="h-11 w-full rounded-xl border border-line bg-white pr-3 pl-9 text-base shadow-sm placeholder:text-slate-400 focus:border-ocean focus:ring-2 focus:ring-ocean/20 focus:outline-none" />
            </label>
          </div>
          {!tree.data ? (
            <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {visible.map((c) => (
                <ConstituencyNode key={c.id} c={c} sel={sel} open={open} forceOpen={!!needle} onToggle={toggle} onExpand={expand} needle={needle} />
              ))}
            </ul>
          )}
        </Card>

        {/* Selection */}
        <div className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="relative overflow-hidden rounded-3xl bg-[#06101f] p-5 text-white shadow-[0_24px_50px_-28px_rgba(6,16,31,.8)] sm:p-6">
            <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-ocean/25 blur-3xl" />
            <p className="relative text-xs font-semibold tracking-[.18em] text-gold uppercase">Your audience</p>
            <div className="relative mt-2 flex flex-wrap gap-1.5">
              {count === 0 ? <span className="text-sm text-slate-300">Everyone in your area. Tick regions on the left to narrow it.</span> : (
                [...[...sel.c].map((id) => ["c", id] as const), ...[...sel.w].map((id) => ["w", id] as const), ...[...sel.s].map((id) => ["s", id] as const)].map(([k, id]) => (
                  <button key={id} onClick={() => toggle(k, id)} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/15 hover:bg-white/15">
                    <span className="text-slate-400">{k === "c" ? "Constituency" : k === "w" ? "Ward" : "Station"}</span>{names.get(id)}<X className="size-3" />
                  </button>
                ))
              )}
              {count > 0 && <button onClick={() => setSel(EMPTY)} className="px-2 py-1 text-xs font-semibold text-gold hover:underline">Clear all</button>}
            </div>
            <div className="relative mt-5 grid grid-cols-3 gap-2">
              {([["People", people.data?.total], ["Supporters", people.data?.by_support.supporter ?? 0], ["Undecided", people.data?.by_support.undecided ?? 0]] as const).map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-white/[.05] px-3 py-3 ring-1 ring-white/[.08]">
                  <p className="font-display text-2xl font-bold tabular-nums">{v == null ? "—" : num(v)}</p>
                  <p className="text-xs text-slate-400">{k}</p>
                </div>
              ))}
            </div>
            <p className="relative mt-4 mb-2 text-xs font-bold tracking-wider text-slate-400 uppercase">Only people who are</p>
            <div className="relative flex flex-wrap gap-1.5">
              {SUPPORT_FILTERS.map((sp) => {
                const on = support.includes(sp);
                return (
                  <button key={sp} onClick={() => setSupport((cur) => (on ? cur.filter((x) => x !== sp) : [...cur, sp]))}
                    className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition", on ? "bg-gold text-navy-950 ring-gold" : "bg-white/5 text-slate-200 ring-white/15 hover:bg-white/10")}>
                    {SUPPORT[sp][1]}
                  </button>
                );
              })}
              {support.length === 0 && <span className="self-center text-xs text-slate-400">· any support level</span>}
            </div>
            <div className="relative mt-5 grid grid-cols-2 gap-2">
              <button disabled={!people.data?.total} onClick={() => send("sms")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-gold to-[#a8861a] px-4 py-3 text-sm font-bold text-navy-950 shadow-[0_10px_24px_-10px_rgba(201,162,39,.9)] transition hover:brightness-110 disabled:opacity-40">
                <MessageSquareText className="size-4" /> Send SMS
              </button>
              <button disabled={!people.data?.total} onClick={() => send("whatsapp")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1fa463] px-4 py-3 text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgba(31,164,99,.9)] transition hover:brightness-110 disabled:opacity-40">
                <MessageCircle className="size-4" /> Send WhatsApp
              </button>
            </div>
            <p className="relative mt-3 text-xs text-slate-400">People who replied STOP are never included. Messages from coordinators go to HQ for approval.</p>
          </section>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <p className="flex items-center gap-2 text-sm font-bold text-navy-900"><Users className="size-4 text-ocean" /> Who&apos;s in it</p>
              <label className="relative w-full sm:w-64">
                <span className="sr-only">Search people</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search a name…"
                  className="h-10 w-full rounded-xl border border-line bg-white pr-3 pl-9 text-base placeholder:text-slate-400 focus:border-ocean focus:ring-2 focus:ring-ocean/20 focus:outline-none" />
              </label>
            </div>
            {people.isLoading ? (
              <div className="grid h-40 place-items-center"><Spinner /></div>
            ) : people.data?.people.length ? (
              <ul className="max-h-[46vh] divide-y divide-line overflow-y-auto">
                {people.data.people.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-navy-900">
                      {p.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-navy-900">{p.full_name}</p>
                      <p className="truncate text-xs text-slate-500">
                        <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: CONSTITUENCY_COLORS[p.constituency] ?? "#94a3b8" }} />
                        {p.ward}{p.station ? ` · ${p.station}` : ""} · <span className="font-mono">{p.phone}</span>
                      </p>
                    </div>
                    <SupportBadge support={p.support} />
                  </li>
                ))}
                {people.data.total > people.data.people.length && (
                  <li className="px-5 py-3 text-center text-xs text-slate-500">Showing {people.data.people.length} of {num(people.data.total)}. All {num(people.data.total)} receive the message.</li>
                )}
              </ul>
            ) : <p className="px-5 py-8 text-center text-sm text-slate-500">Nobody matches this selection.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

function Counts({ people, reachable, supporters }: { people: number; reachable: number; supporters: number }) {
  return (
    <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500 tabular-nums">
      <span title="People"><b className="text-navy-900">{num(people)}</b></span>
      <span className="hidden sm:inline" title="Reachable by SMS">{num(reachable)} reach</span>
      <span className="hidden text-kenya-green sm:inline" title="Supporters">{num(supporters)} sup</span>
    </span>
  );
}

function Check({ on, partial, onClick, label }: { on: boolean; partial?: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="checkbox" aria-checked={partial ? "mixed" : on} aria-label={label}
      className={cn("grid size-5 shrink-0 place-items-center rounded-md ring-1 transition", on ? "bg-kenya-green ring-kenya-green" : partial ? "bg-kenya-green/20 ring-kenya-green" : "bg-white ring-slate-300 hover:ring-slate-400")}>
      {on && <svg viewBox="0 0 12 12" className="size-3 text-white" aria-hidden><path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {!on && partial && <span className="h-0.5 w-2.5 rounded bg-kenya-green" />}
    </button>
  );
}

function ConstituencyNode({ c, sel, open, forceOpen, onToggle, onExpand, needle }: {
  c: AudienceConstituency; sel: Sel; open: Set<string>; forceOpen: boolean; needle: string;
  onToggle: (k: keyof Sel, id: string) => void; onExpand: (id: string) => void;
}) {
  const on = sel.c.has(c.id);
  const partial = !on && c.wards.some((w) => sel.w.has(w.id) || w.stations.some((s) => sel.s.has(s.id)));
  const isOpen = forceOpen || open.has(c.id);
  return (
    <li>
      <div className={cn("flex items-center gap-3 px-5 py-3", on && "bg-kenya-green-50/60")}>
        <Check on={on} partial={partial} onClick={() => onToggle("c", c.id)} label={`Select ${c.name}`} />
        <button onClick={() => onExpand(c.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
          <ChevronRight className={cn("size-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-90")} />
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: CONSTITUENCY_COLORS[c.name] ?? "#94a3b8" }} />
          <span className="truncate font-bold text-navy-900">{c.name}</span>
          <span className="hidden text-xs text-slate-400 sm:inline">{c.wards.length} wards</span>
        </button>
        <Counts {...c} />
      </div>
      {isOpen && (
        <ul className="border-t border-line/60 bg-slate-50/40">
          {c.wards.map((w) => <WardNode key={w.id} w={w} sel={sel} parentOn={on} open={open} forceOpen={forceOpen} onToggle={onToggle} onExpand={onExpand} needle={needle} />)}
        </ul>
      )}
    </li>
  );
}

function WardNode({ w, sel, parentOn, open, forceOpen, onToggle, onExpand, needle }: {
  w: AudienceWard; sel: Sel; parentOn: boolean; open: Set<string>; forceOpen: boolean; needle: string;
  onToggle: (k: keyof Sel, id: string) => void; onExpand: (id: string) => void;
}) {
  const on = parentOn || sel.w.has(w.id);
  const partial = !on && w.stations.some((s) => sel.s.has(s.id));
  const matchStation = needle && !w.name.toLowerCase().includes(needle) && w.stations.some((s) => s.name.toLowerCase().includes(needle));
  const isOpen = open.has(w.id) || !!matchStation;
  const stations = matchStation ? w.stations.filter((s) => s.name.toLowerCase().includes(needle)) : w.stations;
  return (
    <li>
      <div className="flex items-center gap-3 py-2.5 pr-5 pl-12">
        <Check on={on} partial={partial} onClick={() => !parentOn && onToggle("w", w.id)} label={`Select ${w.name}`} />
        <button onClick={() => onExpand(w.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} disabled={!w.stations.length}>
          {w.stations.length > 0 && <ChevronRight className={cn("size-3.5 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-90")} />}
          <span className="truncate text-sm font-semibold text-navy-900">{w.name}</span>
          <span className="hidden text-xs text-slate-400 sm:inline">{w.stations.length} stations</span>
        </button>
        <Counts {...w} />
      </div>
      {isOpen && stations.length > 0 && (
        <ul className="pb-2">
          {stations.map((s) => {
            const sOn = on || sel.s.has(s.id);
            return (
              <li key={s.id} className="flex items-center gap-3 py-1.5 pr-5 pl-20">
                <Check on={sOn} onClick={() => !on && onToggle("s", s.id)} label={`Select ${s.name}`} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{s.name}</span>
                <Counts {...s} />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
