"use client";

import { BellRing, CalendarDays, Check, Search, Vote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { ElectionCountdown } from "@/components/ui/ElectionCountdown";
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, ProgressBar, Select, SupportBadge } from "@/components/ui";
import { useGeoTree, useStations } from "@/features/geo/api";
import { useElectionSettings, useMarkVoted, usePlanReminders, useRoster, useSaveElectionSettings, useTurnout } from "@/features/election/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num, pct } from "@/lib/format";
import { can } from "@/lib/roles";

export default function ElectionPage() {
  const user = useUser();
  const settings = useElectionSettings();
  const [wardId, setWardId] = useState("");
  const turnout = useTurnout(wardId || undefined);
  const s = settings.data;

  return (
    <>
      <PageHeader eyebrow="Election" title="Election day command"
        subtitle="Turnout here counts supporters and leaners marked as voted. That's the number that decides the result." />

      <ElectionCountdown date={s?.election_date ?? null} pollsOpen={s?.polls_open} pollsClose={s?.polls_close} />
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card className="relative overflow-hidden p-6">
          <p className="text-xs font-bold tracking-[.16em] text-slate-500 uppercase">Supporter turnout</p>
          <p className="mt-2 font-display text-5xl font-extrabold text-navy-900 tabular-nums">{turnout.data ? pct(turnout.data.overall.percent) : "—"}</p>
          <p className="text-sm text-slate-500">{turnout.data ? `${num(turnout.data.overall.voted)} of ${num(turnout.data.overall.targets)} · +${num(turnout.data.last_hour)} in the last hour` : "Counts supporters and leaners marked as voted."}</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-kenya-green to-[#34c77b] transition-all duration-700" style={{ width: `${Math.min(turnout.data?.overall.percent ?? 0, 100)}%` }} />
          </div>
        </Card>
        {can.electionAdmin(user.role) ? <SettingsCard /> : (
          <Card className="p-5 text-sm text-slate-700">
            <p className="font-semibold text-navy-900">Your job on the day</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Open the roster for your ward or station below.</li>
              <li>Tap <b>Voted</b> as supporters confirm they&apos;ve cast their ballot.</li>
              <li>Call anyone still pending in the afternoon.</li>
            </ol>
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Turnout by ward" subtitle="Lowest first: where to push" />
          {turnout.isLoading ? <SkeletonRows rows={6} cols={3} /> : turnout.error ? <ErrorState error={turnout.error} onRetry={turnout.refetch} /> : (
            <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
              {[...(turnout.data?.wards ?? [])].sort((a, b) => (a.percent ?? -1) - (b.percent ?? -1)).map((w) => (
                <li key={w.id}>
                  <button onClick={() => setWardId(w.id === wardId ? "" : w.id)}
                    className={cn("w-full px-5 py-3 text-left transition hover:bg-slate-50", wardId === w.id && "bg-ocean-50")}>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-semibold text-navy-900">{w.name} <span className="text-xs font-normal text-muted">{w.parent}</span></span>
                      <span className="text-xs tabular-nums text-muted">{num(w.voted)} / {num(w.targets)} · <b className="text-navy-900">{pct(w.percent)}</b></span>
                    </div>
                    <ProgressBar percent={w.percent} thin />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Roster wardId={wardId} setWardId={setWardId} stationsTurnout={turnout.data?.stations ?? []} />
      </div>
    </>
  );
}

function SettingsCard() {
  const settings = useElectionSettings();
  const save = useSaveElectionSettings();
  const plan = usePlanReminders();
  const [f, setF] = useState({ election_date: "", polls_open: "06:00", polls_close: "17:00", candidate_label: "our candidate" });
  useEffect(() => {
    if (settings.data) setF({ election_date: settings.data.election_date ?? "", polls_open: settings.data.polls_open, polls_close: settings.data.polls_close, candidate_label: settings.data.candidate_label });
  }, [settings.data]);

  return (
    <Card>
      <CardHeader title="Election settings" subtitle="Drives the countdown and the reminder schedule." />
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <Input type="date" label="Election date" className="sm:col-span-3" value={f.election_date} onChange={(e) => setF({ ...f, election_date: e.target.value })} leading={<CalendarDays className="size-4" />} />
        <Input type="time" label="Polls open" value={f.polls_open} onChange={(e) => setF({ ...f, polls_open: e.target.value })} />
        <Input type="time" label="Polls close" value={f.polls_close} onChange={(e) => setF({ ...f, polls_close: e.target.value })} />
        <div className="flex items-end">
          <Button variant="navy" className="w-full" loading={save.isPending}
            onClick={() => save.mutate({ ...f, election_date: f.election_date || null }, { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(e.message) })}>Save</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50/60 px-5 py-4">
        <p className="max-w-sm text-xs text-muted">Schedules 4 SMS reminders to supporters & leaners: 3 days out, the eve, polls opening, and a 1 pm push to anyone not yet marked voted.</p>
        <Button variant="gold" icon={<BellRing className="size-4" />} loading={plan.isPending} disabled={!settings.data?.election_date}
          onClick={() => plan.mutate(undefined, {
            onSuccess: (ids) => toast.success(ids.length ? `${ids.length} reminders scheduled` : "Reminders already scheduled"),
            onError: (e) => toast.error(e.message),
          })}>Schedule reminders</Button>
      </div>
    </Card>
  );
}

function Roster({ wardId, setWardId, stationsTurnout }: { wardId: string; setWardId: (id: string) => void; stationsTurnout: { id: string; name: string; voted: number; targets: number; percent: number | null }[] }) {
  const user = useUser();
  const { data: tree } = useGeoTree();
  const [stationId, setStationId] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const stations = useStations(wardId || undefined, undefined, !!wardId);
  const mark = useMarkVoted();
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setStationId(""), [wardId]);
  const roster = useRoster({ ward_id: wardId || undefined, station_id: stationId || undefined, q: debounced || undefined, only_pending: pendingOnly }, !!wardId);
  const stationPct = useMemo(() => new Map(stationsTurnout.map((s) => [s.id, s])), [stationsTurnout]);

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Turnout roster" subtitle="Tick supporters off as they vote." />
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
        <Select placeholder="Choose ward" value={wardId} onChange={(e) => setWardId(e.target.value)}>
          {tree?.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
        </Select>
        <Select placeholder="All stations in ward" value={stationId} disabled={!wardId} onChange={(e) => setStationId(e.target.value)}>
          {stations.data?.map((s) => {
            const t = stationPct.get(s.id);
            return <option key={s.id} value={s.id}>{s.name}{t?.targets ? ` · ${pct(t.percent)}` : ""}</option>;
          })}
        </Select>
        <Input placeholder="Search name or reference" value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="size-4" />} />
        <label className="flex items-center gap-2 text-sm text-navy-900">
          <input type="checkbox" className="size-4 accent-kenya-green" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Only not yet voted
        </label>
      </div>
      {!wardId ? (
        <EmptyState icon={<Vote className="size-6" />} title="Pick a ward" body="Or click a ward in the turnout list." />
      ) : roster.isLoading ? <SkeletonRows rows={6} cols={3} /> : !roster.data?.length ? (
        <EmptyState icon={<Check className="size-6" />} title={pendingOnly ? "Everyone here has voted" : "No supporters found"} />
      ) : (
        <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
          {roster.data.map((r) => {
            const voted = !!r.voted_at;
            return (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy-900">{r.full_name}</p>
                  <p className="text-xs text-muted">{r.reference} · <a href={`tel:${r.phone}`} className="text-ocean hover:underline">{r.phone}</a></p>
                </div>
                <SupportBadge support={r.support} />
                {can.markVoted(user.role) && (
                  <button onClick={() => mark.mutate({ id: r.id, voted: !voted }, { onError: (e) => toast.error(e.message) })}
                    className={cn("inline-flex h-9 min-w-24 items-center justify-center gap-1.5 rounded-xl text-xs font-bold ring-1 transition active:scale-95",
                      voted ? "bg-kenya-green text-white ring-kenya-green" : "bg-white text-navy-900 ring-line hover:ring-kenya-green")}>
                    {voted ? <><Check className="size-3.5" /> Voted</> : "Mark voted"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
