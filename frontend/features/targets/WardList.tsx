"use client";

import { Check, ChevronDown, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { useUpdateWard } from "@/features/geo/api";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { STATUS, pctLabel, statusOf } from "@/features/targets/status";
import { cn } from "@/lib/cn";
import { dateTime, num } from "@/lib/format";
import type { WardBreakdown } from "@/lib/types";

export type WardRow = WardBreakdown & { constituency: string };
type Sort = "gap" | "captured" | "percent" | "name";
const SORTS: [Sort, string][] = [["gap", "Biggest gap"], ["captured", "Most captured"], ["percent", "% of target"], ["name", "A–Z"]];

export function WardList({ wards, countyPercent, editable, showConstituency }: {
  wards: WardRow[];
  countyPercent: number | null;
  editable: boolean;
  showConstituency: boolean;
}) {
  const [sort, setSort] = useState<Sort>("gap");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => [...wards].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "percent") return (b.percent ?? -1) - (a.percent ?? -1);
    return b[sort] - a[sort];
  }), [wards, sort]);
  const scale = Math.max(1, ...wards.map((w) => Math.max(w.target, w.captured)));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          {(["ahead", "near", "behind"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", STATUS[k].dot)} />{STATUS[k].label}</span>
          ))}
          <span className="text-slate-500">compared with the county ({pctLabel(countyPercent)})</span>
        </div>
        <div role="tablist" aria-label="Sort wards" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {SORTS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={sort === k} onClick={() => setSort(k)}
              className={cn("rounded-lg px-3 py-1 text-sm font-semibold transition", sort === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ol className="divide-y divide-line">
        {rows.map((w, i) => (
          <WardItem key={w.id} w={w} rank={i + 1} scale={scale} countyPercent={countyPercent} editable={editable}
            showConstituency={showConstituency} open={open === w.id} onToggle={() => setOpen(open === w.id ? null : w.id)} />
        ))}
      </ol>
    </div>
  );
}

function WardItem({ w, rank, scale, countyPercent, editable, showConstituency, open, onToggle }: {
  w: WardRow; rank: number; scale: number; countyPercent: number | null; editable: boolean; showConstituency: boolean; open: boolean; onToggle: () => void;
}) {
  const st = statusOf(w, countyPercent);
  const [editing, setEditing] = useState(false);
  return (
    <li className={cn("transition", open && "bg-slate-50/70")}>
      <div className="flex items-start gap-3 px-5 py-4 sm:items-center">
        <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs font-semibold text-slate-400 sm:mt-0">{String(rank).padStart(2, "0")}</span>
        <button onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-navy-900">{w.name}</span>
            {showConstituency && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <span className="size-2 rounded-full" style={{ background: CONSTITUENCY_COLORS[w.constituency] ?? "#94a3b8" }} />{w.constituency}
              </span>
            )}
            <span className={cn("rounded-full px-2 py-px text-xs font-semibold ring-1", STATUS[st].chip)}>{STATUS[st].label}</span>
          </div>
          {/* Bullet bar: grey track = target, fill = captured, both on one scale so wards compare honestly. */}
          <div className="relative mt-2 h-3 rounded-full bg-slate-100">
            <span className="absolute inset-y-0 left-0 rounded-full bg-slate-300/70" style={{ width: `${(w.target / scale) * 100}%` }} />
            <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${(w.captured / scale) * 100}%`, background: STATUS[st].fill }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600 tabular-nums">
            <span><b className="text-navy-900">{num(w.captured)}</b> of {num(w.target)} · <b className="text-navy-900">{pctLabel(w.percent)}</b></span>
            <span>Gap <b className="text-navy-900">{num(w.gap)}</b></span>
            <span>Today <b className="text-navy-900">+{num(w.today)}</b></span>
            <span>Visits <b className="text-navy-900">{num(w.visits_done)}</b></span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {editable && (
            <button onClick={() => setEditing((e) => !e)} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-navy-900" aria-label={`Edit ${w.name} target`}>
              <Pencil className="size-4" />
            </button>
          )}
          <button onClick={onToggle} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-navy-900" aria-label={open ? "Hide polling stations" : "Show polling stations"}>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>
      {editing && <TargetEditor w={w} onDone={() => setEditing(false)} />}
      {open && <StationBreakdown w={w} />}
    </li>
  );
}

function StationBreakdown({ w }: { w: WardRow }) {
  const max = Math.max(1, ...w.stations.map((s) => s.captured), w.no_station);
  return (
    <div className="animate-fade-up px-5 pb-5 sm:pl-14">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["Verified", w.verified], ["Supporters", w.supporters], ["This week", w.week], ["Registered (IEBC)", w.registered_voters]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white px-3 py-2 ring-1 ring-line">
            <p className="text-xs text-slate-500">{k}</p>
            <p className="font-semibold text-navy-900 tabular-nums">{num(v)}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
        Captured by polling station · last visit {w.last_visit_at ? dateTime(w.last_visit_at) : "never"}
      </p>
      <ul className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
        {w.stations.map((s) => (
          <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <span className="min-w-0 truncate text-sm text-navy-900" title={s.name}>{s.name}</span>
            <span className="col-span-2 row-start-2 h-2 rounded-full bg-slate-100 sm:col-span-1 sm:row-start-auto">
              <span className="block h-full rounded-full bg-ocean" style={{ width: `${(s.captured / max) * 100}%` }} />
            </span>
            <span className="text-right text-sm font-semibold text-navy-900 tabular-nums">{num(s.captured)}{s.target ? <span className="font-normal text-slate-500"> / {num(s.target)}</span> : null}</span>
          </li>
        ))}
        {w.no_station > 0 && (
          <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 px-3 py-2.5 text-sm text-slate-500 italic">
            <span>No polling station recorded</span><span className="font-semibold not-italic tabular-nums">{num(w.no_station)}</span>
          </li>
        )}
        {!w.stations.length && !w.no_station && <li className="px-3 py-4 text-center text-sm text-slate-500">No captures in this ward yet.</li>}
      </ul>
    </div>
  );
}

function TargetEditor({ w, onDone }: { w: WardRow; onDone: () => void }) {
  const [target, setTarget] = useState(String(w.target || ""));
  const [reg, setReg] = useState(w.registered_voters?.toString() ?? "");
  const update = useUpdateWard();
  const save = () => update.mutate(
    { id: w.id, target: +target || 0, registered_voters: reg ? +reg : null },
    { onSuccess: () => { toast.success(`${w.name} updated`); onDone(); }, onError: (e) => toast.error(e.message) },
  );
  return (
    <div className="mx-5 mb-4 flex animate-fade-up flex-wrap items-end gap-3 rounded-xl bg-white p-3 ring-1 ring-line sm:ml-14">
      <label className="text-xs font-semibold text-navy-900">Target
        <input autoFocus inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))}
          className="mt-1 block h-10 w-28 rounded-lg border border-line bg-white px-2.5 text-base focus:border-ocean focus:outline-none" />
      </label>
      <label className="text-xs font-semibold text-navy-900">Registered voters (IEBC)
        <input inputMode="numeric" value={reg} onChange={(e) => setReg(e.target.value.replace(/\D/g, ""))}
          className="mt-1 block h-10 w-36 rounded-lg border border-line bg-white px-2.5 text-base focus:border-ocean focus:outline-none" />
      </label>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" loading={update.isPending} onClick={save} icon={<Check className="size-3.5" />}>Save</Button>
      </div>
    </div>
  );
}
