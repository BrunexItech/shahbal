"use client";

import { Phone, PhoneCall, PhoneMissed, Search, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Card, Select, SupportBadge } from "@/components/ui";
import { claimVoter, type DirectoryFilters, useCallDirectory } from "@/features/calls/api";
import { useGeoTree, useStations } from "@/features/geo/api";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { cn } from "@/lib/cn";
import { num, timeAgo } from "@/lib/format";
import type { CallOutcome, Claim } from "@/lib/types";

const OUTCOME: Record<CallOutcome, [string, string]> = {
  answered: ["Answered", "bg-kenya-green-50 text-kenya-green ring-kenya-green/20"],
  no_answer: ["No answer", "bg-slate-100 text-slate-600 ring-slate-200"],
  busy: ["Busy", "bg-slate-100 text-slate-600 ring-slate-200"],
  call_back: ["Call back", "bg-ocean-50 text-ocean ring-ocean/20"],
  wrong_number: ["Wrong number", "bg-gold-50 text-[#7a5f0c] ring-gold/30"],
  do_not_call: ["Do not call", "bg-red-50 text-kenya-red ring-kenya-red/20"],
};
const CALLED: [string, string][] = [["", "Everyone"], ["never", "Never called"], ["called", "Called before"], ["answered", "Answered"], ["no_answer", "No answer"], ["call_back", "Call back"], ["wrong_number", "Wrong number"]];

/**
 * Call directory: find people by constituency, ward or polling station, see who has
 * been called and what happened, and pick exactly who to call next.
 */
export function Directory({ onPicked, disabled }: { onPicked: (c: Claim) => void; disabled: boolean }) {
  const tree = useGeoTree();
  const [f, setF] = useState<DirectoryFilters>({ called: "never", page: 1 });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const stations = useStations(f.ward_id, undefined, !!f.ward_id);
  const dir = useCallDirectory({ ...f, q: q.trim() || undefined });
  const wards = useMemo(() => (tree.data ?? []).filter((c) => !f.constituency_id || c.id === f.constituency_id).flatMap((c) => c.wards), [tree.data, f.constituency_id]);
  const set = (patch: DirectoryFilters) => setF((cur) => ({ ...cur, ...patch, page: 1 }));

  const call = async (id: string) => {
    setBusy(id);
    try {
      onPicked(await claimVoter(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reserve this person");
      void dir.refetch();
    } finally {
      setBusy(null);
    }
  };

  const d = dir.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-3 border-b border-line bg-slate-50/60 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Select label="Constituency" value={f.constituency_id ?? ""} onChange={(e) => set({ constituency_id: e.target.value || undefined, ward_id: undefined, station_id: undefined })}>
          <option value="">All constituencies</option>
          {(tree.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label="Ward" value={f.ward_id ?? ""} onChange={(e) => set({ ward_id: e.target.value || undefined, station_id: undefined })}>
          <option value="">All wards</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Select label="Polling station" value={f.station_id ?? ""} disabled={!f.ward_id} onChange={(e) => set({ station_id: e.target.value || undefined })}>
          <option value="">{f.ward_id ? "All stations" : "Choose a ward first"}</option>
          {(stations.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select label="Call record" value={f.called ?? ""} onChange={(e) => set({ called: e.target.value || undefined })}>
          {CALLED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-navy-900">Search</span>
          <span className="relative block">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setF((cur) => ({ ...cur, page: 1 })); }} type="search" placeholder="Name, reference or number"
              className="h-11 w-full rounded-xl border border-line bg-white pr-3 pl-9 text-base placeholder:text-slate-400 focus:border-ocean focus:ring-2 focus:ring-ocean/20 focus:outline-none" />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-slate-600">
        <span>{d ? <><b className="text-navy-900">{num(d.total)}</b> people</> : "Loading…"}</span>
        {dir.isFetching && <Spinner size="sm" />}
      </div>

      {d && d.items.length === 0 && <p className="px-5 pb-10 text-center text-sm text-slate-500">Nobody matches. Try another area or call record.</p>}
      <ul className="divide-y divide-line border-t border-line">
        {d?.items.map((p) => {
          const o = p.last_outcome ? OUTCOME[p.last_outcome] : null;
          return (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-semibold text-navy-900">{p.full_name} <SupportBadge support={p.support} /></p>
                <p className="font-mono text-sm text-navy-900">{p.phone}</p>
              </div>
              <p className="order-3 col-span-2 min-w-0 truncate text-xs text-slate-500 lg:order-none lg:col-span-1 lg:text-sm">
                <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: CONSTITUENCY_COLORS[p.constituency] ?? "#94a3b8" }} />
                {p.ward}{p.station ? ` · ${p.station}` : ""}
              </p>
              <div className="order-4 col-span-2 flex flex-wrap items-center gap-2 text-xs lg:order-none lg:col-span-1">
                {p.calls === 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 font-semibold text-[#7a5f0c] ring-1 ring-gold/30"><PhoneMissed className="size-3" /> Never called</span>
                ) : (
                  <>
                    {o && <span className={cn("rounded-full px-2 py-0.5 font-semibold ring-1", o[1])}>{o[0]}</span>}
                    <span className="text-slate-500">{p.calls}× · last {p.last_call_at ? timeAgo(p.last_call_at) : "—"}{p.last_agent ? ` by ${p.last_agent}` : ""}</span>
                  </>
                )}
              </div>
              <div className="flex justify-end">
                {p.busy_with ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600"><UserX className="size-3.5" /> {p.busy_with} is calling</span>
                ) : (
                  <Button size="sm" variant="gold" icon={busy === p.id ? undefined : <PhoneCall className="size-3.5" />} loading={busy === p.id} disabled={disabled}
                    onClick={() => void call(p.id)}>Call</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {d && pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
          <Button size="sm" variant="ghost" disabled={(f.page ?? 1) <= 1} onClick={() => setF((c) => ({ ...c, page: (c.page ?? 1) - 1 }))}>Previous</Button>
          <span className="text-slate-500">Page {f.page ?? 1} of {pages}</span>
          <Button size="sm" variant="ghost" disabled={(f.page ?? 1) >= pages} onClick={() => setF((c) => ({ ...c, page: (c.page ?? 1) + 1 }))}>Next</Button>
        </div>
      )}
      {disabled && <p className="flex items-center gap-2 border-t border-line bg-gold-50 px-5 py-3 text-sm text-navy-900"><Phone className="size-4" /> Finish the current call before picking someone new.</p>}
    </Card>
  );
}
