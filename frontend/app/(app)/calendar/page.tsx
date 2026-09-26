"use client";

import { CalendarPlus, ChevronLeft, ChevronRight, Flag, Lock, MapPinOff, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/loaders";
import { Button, Card, ErrorState, Modal, PageHeader } from "@/components/ui";
import { useCalendar, useGaps } from "@/features/calendar/api";
import { type Draft, EventDialog } from "@/features/calendar/EventDialog";
import { EntryDetails } from "@/features/calendar/EntryDetails";
import { type Entry, FAMILY, type Family, kindOf } from "@/features/calendar/meta";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num, timeAgo } from "@/lib/format";
import { can } from "@/lib/roles";

type View = "month" | "week" | "agenda";
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" });
const keyOf = (iso: string | Date) => DAY.format(typeof iso === "string" ? new Date(iso) : iso);
const addDays = (key: string, n: number) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (key: string) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const startOf = (key: string) => new Date(`${key}T00:00:00+03:00`);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
const label = (key: string, o: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-KE", { timeZone: "UTC", ...o });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const user = useUser();
  const editor = can.manageStations(user.role);
  const today = keyOf(new Date());
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(today);
  const [hidden, setHidden] = useState<Set<Family>>(new Set());
  const [open, setOpen] = useState<Entry | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dayList, setDayList] = useState<string | null>(null);

  useEffect(() => { if (window.innerWidth < 768) setView("agenda"); }, []);

  const range = useMemo(() => {
    if (view === "month") { const first = `${cursor.slice(0, 7)}-01`; const s = addDays(first, -weekday(first)); return { from: s, days: 42 }; }
    if (view === "week") return { from: addDays(cursor, -weekday(cursor)), days: 7 };
    return { from: cursor, days: 35 };
  }, [view, cursor]);
  const start = useMemo(() => startOf(range.from), [range]);
  const end = useMemo(() => startOf(addDays(range.from, range.days)), [range]);
  const cal = useCalendar(start, end);

  const { byDay, targets, election } = useMemo(() => {
    const byDay = new Map<string, Entry[]>();
    const targets = new Map<string, number>();
    let election: string | null = null;
    for (const e of cal.data ?? []) {
      if (e.source === "plan") { targets.set(keyOf(e.starts_at), e.target ?? 0); continue; }
      if (e.source === "election") { election = keyOf(e.starts_at); continue; }
      if (hidden.has(kindOf(e.kind).family)) continue;
      const first = keyOf(e.starts_at);
      const last = e.ends_at ? keyOf(new Date(new Date(e.ends_at).getTime() - (e.all_day ? 1 : 0))) : first;
      for (let k = first, i = 0; k <= last && i < 14; k = addDays(k, 1), i++) byDay.set(k, [...(byDay.get(k) ?? []), e]);
    }
    for (const list of byDay.values()) list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
    return { byDay, targets, election };
  }, [cal.data, hidden]);

  const step = (dir: number) => setCursor((c) => view === "month" ? `${addDays(`${c.slice(0, 7)}-15`, dir * 30).slice(0, 7)}-01` : addDays(c, dir * 7));
  const title = view === "month" ? label(`${cursor.slice(0, 7)}-01`, { month: "long", year: "numeric" })
    : view === "week" ? `Week of ${label(range.from, { day: "numeric", month: "long", year: "numeric" })}`
    : `From ${label(cursor, { day: "numeric", month: "long" })}`;
  const toggle = (f: Family) => setHidden((h) => { const n = new Set(h); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  return (
    <>
      <PageHeader eyebrow="Command" title="Campaign Calendar"
        subtitle="Every rally, visit, interview, deadline and weekly target in one place. Opening it needs a quick identity check, and it locks again after a few minutes."
        actions={editor && <Button icon={<CalendarPlus className="size-4" />} onClick={() => setDraft({ date: cursor < today ? today : cursor })}>New</Button>} />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
            <div className="flex items-center gap-1">
              <button onClick={() => step(-1)} className="grid size-9 place-items-center rounded-lg ring-1 ring-line hover:bg-slate-50" aria-label="Previous"><ChevronLeft className="size-4" /></button>
              <button onClick={() => step(1)} className="grid size-9 place-items-center rounded-lg ring-1 ring-line hover:bg-slate-50" aria-label="Next"><ChevronRight className="size-4" /></button>
              <button onClick={() => setCursor(today)} className="h-9 rounded-lg px-3 text-sm font-semibold ring-1 ring-line hover:bg-slate-50">Today</button>
            </div>
            <h2 className="mr-auto min-w-0 truncate font-display text-lg font-bold text-navy-900 sm:text-xl">{title}</h2>
            <div role="tablist" aria-label="View" className="inline-flex rounded-xl bg-slate-100 p-1">
              {(["month", "week", "agenda"] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold capitalize", view === v ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900")}>{v}</button>
              ))}
            </div>
          </div>
          {/* Legend = filter */}
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2.5 sm:px-4" aria-label="Show or hide kinds of entries">
            {(Object.keys(FAMILY) as Family[]).map((f) => (
              <button key={f} onClick={() => toggle(f)} aria-pressed={!hidden.has(f)}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition", hidden.has(f) ? "text-slate-400 ring-line line-through" : "text-navy-900 ring-line hover:bg-slate-50")}>
                <span className="size-2.5 rounded-full" style={{ background: hidden.has(f) ? "#cbd5e1" : FAMILY[f].color }} />{FAMILY[f].label}
              </button>
            ))}
          </div>

          {cal.error ? <ErrorState error={cal.error} onRetry={cal.refetch} /> : !cal.data ? <Skeleton className="m-4 h-[560px] rounded-2xl" /> : (
            view === "agenda" ? <Agenda from={range.from} days={range.days} byDay={byDay} today={today} election={election} onOpen={setOpen} />
            : <Grid from={range.from} weeks={range.days / 7} month={view === "month" ? cursor.slice(0, 7) : null} byDay={byDay} targets={targets}
                today={today} election={election} onOpen={setOpen} onMore={setDayList} onNew={editor ? (date) => setDraft({ date }) : undefined} />
          )}
        </Card>

        <Gaps onPlan={editor ? (ward_id) => setDraft({ date: addDays(today, 1), kind: "visit", ward_id }) : undefined} />
      </div>

      {dayList && (
        <Modal open onClose={() => setDayList(null)} title={label(dayList, { weekday: "long", day: "numeric", month: "long" })}>
          <ul className="space-y-1.5">{(byDay.get(dayList) ?? []).map((e) => <li key={e.id + dayList}><Chip e={e} wide onOpen={(x) => { setDayList(null); setOpen(x); }} /></li>)}</ul>
        </Modal>
      )}
      {open && <EntryDetails entry={open} onClose={() => setOpen(null)} />}
      {draft && <EventDialog draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}

function Chip({ e, wide, wrap, onOpen }: { e: Entry; wide?: boolean; wrap?: boolean; onOpen: (e: Entry) => void }) {
  const m = kindOf(e.kind);
  const fam = FAMILY[m.family];
  const off = e.status === "cancelled";
  return (
    <button onClick={(ev) => { ev.stopPropagation(); onOpen(e); }} title={`${m.label}${e.all_day ? "" : ` · ${time(e.starts_at)}`}: ${e.title}`}
      className={cn("flex w-full min-w-0 gap-1.5 rounded-md border-l-[3px] px-1.5 py-1 text-left transition hover:brightness-95", wrap ? "items-start" : "items-center",
        wide ? "py-2 text-sm" : "text-xs", off && "opacity-50")}
      style={{ background: fam.soft, borderColor: fam.color }}>
      <m.icon className={cn("shrink-0", wide ? "size-4" : "size-3.5")} style={{ color: fam.color }} />
      {wrap ? (
        <span className="min-w-0">
          {!e.all_day && <span className="block font-semibold text-slate-600 tabular-nums">{time(e.starts_at)}</span>}
          <span className={cn("line-clamp-2 font-semibold text-navy-900", off && "line-through")}>{e.title}</span>
        </span>
      ) : (
        <>
          {wide && !e.all_day && <span className="shrink-0 font-semibold text-slate-600 tabular-nums">{time(e.starts_at)}</span>}
          <span className={cn("min-w-0 truncate font-semibold text-navy-900", off && "line-through")}>{e.title}</span>
        </>
      )}
      {e.hq_only && <Lock className="size-3 shrink-0 text-slate-500" aria-label="HQ only" />}
    </button>
  );
}

function Grid({ from, weeks, month, byDay, targets, today, election, onOpen, onMore, onNew }: {
  from: string; weeks: number; month: string | null; byDay: Map<string, Entry[]>; targets: Map<string, number>; today: string; election: string | null;
  onOpen: (e: Entry) => void; onMore: (key: string) => void; onNew?: (key: string) => void;
}) {
  const max = month ? 3 : 12;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line bg-slate-50/70">
          {WEEKDAYS.map((d) => <p key={d} className="px-2 py-2 text-xs font-bold tracking-wider text-slate-500 uppercase">{d}</p>)}
        </div>
        {Array.from({ length: weeks }).map((_, w) => {
          const monday = addDays(from, w * 7);
          const target = targets.get(monday);
          return (
            <div key={monday} className="border-b border-line last:border-b-0">
              {target ? (
                <p className="flex items-center gap-1.5 bg-gold-50 px-2 py-1 text-xs font-semibold text-[#7a5f0c]"><Target className="size-3.5" />Capture target this week: {num(target)}</p>
              ) : null}
              <div className="grid grid-cols-7">
                {Array.from({ length: 7 }).map((__, d) => {
                  const key = addDays(monday, d);
                  const list = byDay.get(key) ?? [];
                  const outside = month && key.slice(0, 7) !== month;
                  const isElection = key === election;
                  return (
                    <div key={key} onClick={() => onNew?.(key)} role={onNew ? "button" : undefined} tabIndex={onNew ? 0 : undefined}
                      onKeyDown={(ev) => { if (onNew && ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onNew(key); } }}
                      aria-label={onNew ? `Add something on ${label(key, { weekday: "long", day: "numeric", month: "long" })}` : undefined}
                      className={cn("group relative flex flex-col gap-1 border-r border-line p-1.5 last:border-r-0", month ? "min-h-28" : "min-h-72",
                        outside && "bg-slate-50/60", onNew && "cursor-pointer hover:bg-ocean-50/40", isElection && "bg-red-50/60")}>
                      {isElection && <span aria-hidden className="absolute inset-x-0 top-0 flex h-1"><i className="flex-1 bg-kenya-black" /><i className="flex-1 bg-kenya-red" /><i className="flex-1 bg-kenya-green" /></span>}
                      <div className="flex items-center justify-between">
                        <span className={cn("grid size-7 place-items-center rounded-full text-sm font-bold tabular-nums",
                          key === today ? "bg-navy-950 text-gold" : outside ? "text-slate-400" : "text-navy-900")}>{Number(key.slice(8))}</span>
                        {isElection && <span className="inline-flex items-center gap-1 text-xs font-extrabold text-kenya-red"><Flag className="size-3.5" />Election</span>}
                      </div>
                      {list.slice(0, max).map((e) => <Chip key={e.id} e={e} wrap={!month} onOpen={onOpen} />)}
                      {list.length > max && (
                        <button onClick={(ev) => { ev.stopPropagation(); onMore(key); }} className="text-left text-xs font-semibold text-ocean hover:underline">+{list.length - max} more</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ from, days, byDay, today, election, onOpen }: {
  from: string; days: number; byDay: Map<string, Entry[]>; today: string; election: string | null; onOpen: (e: Entry) => void;
}) {
  const keys = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((k) => byDay.has(k) || k === election || k === today);
  return (
    <ul className="divide-y divide-line">
      {keys.map((k) => (
        <li key={k} className="grid gap-2 p-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:p-4">
          <div>
            <p className={cn("font-display text-lg font-bold", k === today ? "text-ocean" : "text-navy-900")}>{label(k, { weekday: "short", day: "numeric", month: "short" })}</p>
            {k === today && <p className="text-xs font-semibold text-ocean">Today</p>}
            {k === election && <p className="flex items-center gap-1 text-xs font-extrabold text-kenya-red"><Flag className="size-3.5" />Election day</p>}
          </div>
          <div className="space-y-1.5">
            {(byDay.get(k) ?? []).map((e) => (
              <div key={e.id} className="min-w-0">
                <Chip e={e} wide onOpen={onOpen} />
                {(e.ward || e.location) && <p className="mt-0.5 truncate pl-3 text-xs text-slate-500">{[e.ward, e.location].filter(Boolean).join(" · ")}</p>}
              </div>
            ))}
            {!byDay.get(k)?.length && <p className="text-sm text-slate-400">Nothing planned</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Gaps({ onPlan }: { onPlan?: (wardId: string) => void }) {
  const { data, isLoading } = useGaps(14);
  return (
    <Card className="self-start overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line bg-amber-50/60 px-4 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><MapPinOff className="size-5" /></span>
        <div>
          <p className="text-sm font-bold text-navy-900">Needs a plan</p>
          <p className="text-xs text-slate-600">{data ? `${data.length} ward${data.length === 1 ? "" : "s"} with nothing planned in the next 14 days, furthest behind first.` : "Wards with nothing planned soon."}</p>
        </div>
      </div>
      {isLoading ? <Skeleton className="m-4 h-40 rounded-xl" /> : (
        <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
          {data?.slice(0, 12).map((g) => (
            <li key={g.ward_id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-navy-900">{g.ward}</span>
                <span className="block truncate text-xs text-slate-500">{g.constituency} · {g.percent != null ? `${Math.round(g.percent)}% of target` : "no target"} · {g.last_visit_at ? `last visit ${timeAgo(g.last_visit_at)}` : "never visited"}</span>
              </span>
              {onPlan && <button onClick={() => onPlan(g.ward_id)} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold text-ocean ring-1 ring-line hover:bg-ocean-50">Plan</button>}
            </li>
          ))}
          {data && !data.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Every ward has something planned.</li>}
        </ul>
      )}
    </Card>
  );
}
