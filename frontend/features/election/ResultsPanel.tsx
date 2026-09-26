"use client";

import { Camera, Check, CircleAlert, FileCheck2, Plus, Send, Trash2, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Select, Textarea } from "@/components/ui";
import { useGeoTree, useStations } from "@/features/geo/api";
import { PhotoImg } from "@/features/visits/photos";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num, timeAgo } from "@/lib/format";
import { can } from "@/lib/roles";

import { type Candidate, type ResultFormRow, type Tally, useCandidates, useResultForms, useReviewResult, useSaveCandidates, useSubmitResult, useTally } from "./results";

const COLORS = ["#006b3f", "#1a3a66", "#c8102e", "#b07d00", "#7c4dbd", "#0b7fa6", "#64748b", "#d9480f"];
const pctOf = (a: number, b: number) => (b ? (a / b) * 100 : 0);

/** Election night: the Form 34A parallel tally and the forms behind it. */
export function ResultsPanel() {
  const user = useUser();
  const cands = useCandidates();
  const oversight = can.oversee(user.role);
  const submitter = can.manageStations(user.role) || user.role === "field_agent";
  const [editing, setEditing] = useState(false);
  if (cands.isLoading) return <Card><SkeletonRows rows={4} /></Card>;
  const list = cands.data ?? [];
  if (!list.length || editing) {
    return can.electionAdmin(user.role)
      ? <CandidatesEditor initial={list} onDone={() => setEditing(false)} />
      : <Card><EmptyState icon={<FileCheck2 className="size-6" />} title="Results open once HQ sets the ballot" body="HQ adds the candidates first. Then you can submit the Form 34A for your stream here." /></Card>;
  }
  return (
    <div className="space-y-6">
      {oversight && <TallyView candidates={list} onEditBallot={can.electionAdmin(user.role) ? () => setEditing(true) : undefined} />}
      <div className={cn("grid gap-6", submitter && oversight && "2xl:grid-cols-[420px_minmax(0,1fr)]")}>
        {submitter && <SubmitForm candidates={list} />}
        <FormsList candidates={list} reviewer={can.manageStations(user.role)} />
      </div>
    </div>
  );
}

function CandidatesEditor({ initial, onDone }: { initial: Candidate[]; onDone: () => void }) {
  const save = useSaveCandidates();
  const [rows, setRows] = useState(initial.length ? initial.map(({ name, party, ours, color }) => ({ name, party: party ?? "", ours, color }))
    : [{ name: "Suleiman Shahbal", party: "", ours: true, color: COLORS[0] }, { name: "", party: "", ours: false, color: COLORS[1] }]);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : patch.ours ? { ...x, ours: false } : x)));
  return (
    <Card>
      <CardHeader title="The ballot" subtitle="Everyone standing for Governor, in ballot order. It locks once the first result comes in." />
      <div className="space-y-2 p-5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 rounded-2xl p-3 ring-1 ring-line sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto_auto]">
            <span className="mb-2.5 size-6 rounded-full ring-2 ring-white" style={{ background: r.color }} />
            <Input label="Name" value={r.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} />
            <Input label="Party" value={r.party} maxLength={80} onChange={(e) => set(i, { party: e.target.value })} className="col-span-2 sm:col-span-1" />
            <label className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-navy-900"><input type="radio" name="ours" checked={r.ours} onChange={() => set(i, { ours: true })} className="size-4 accent-kenya-green" /> Ours</label>
            <div className="mb-1 flex items-center gap-1">
              <select aria-label="Colour" value={r.color} onChange={(e) => set(i, { color: e.target.value })} className="h-9 rounded-lg border border-line bg-white px-1.5 text-sm">
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {rows.length > 2 && <button onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove candidate" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-kenya-red"><Trash2 className="size-4" /></button>}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} disabled={rows.length >= 12} onClick={() => setRows((r) => [...r, { name: "", party: "", ours: false, color: COLORS[r.length % COLORS.length] }])}>Add candidate</Button>
          <div className="flex gap-2">
            {initial.length > 0 && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
            <Button loading={save.isPending} onClick={() => {
              if (rows.some((r) => r.name.trim().length < 2)) return toast.error("Every candidate needs a name");
              save.mutate(rows.map((r) => ({ name: r.name.trim(), party: r.party.trim() || null, ours: r.ours, color: r.color })), {
                onSuccess: () => { toast.success("Ballot saved"); onDone(); }, onError: (e) => toast.error(e.message),
              });
            }}>Save ballot</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TallyView({ candidates, onEditBallot }: { candidates: Candidate[]; onEditBallot?: () => void }) {
  const [verified, setVerified] = useState(false);
  const { data: t } = useTally(verified);
  const [level, setLevel] = useState<"constituencies" | "wards">("constituencies");
  if (!t) return <Card><SkeletonRows rows={4} /></Card>;
  const ranked = [...candidates].sort((a, b) => (t.totals[b.id] ?? 0) - (t.totals[a.id] ?? 0));
  const ours = candidates.find((c) => c.ours)!;
  const rival = ranked.find((c) => !c.ours);
  const margin = (t.totals[ours.id] ?? 0) - (rival ? t.totals[rival.id] ?? 0 : 0);
  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-hidden bg-[#06101f] p-5 text-white sm:p-6">
        <div aria-hidden className="absolute inset-x-0 top-0 flex h-1"><i className="flex-1 bg-kenya-black" /><i className="flex-1 bg-kenya-red" /><i className="flex-1 bg-kenya-green" /></div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[.16em] text-gold uppercase">Parallel tally · Form 34A</p>
            <p className="mt-1 font-display text-3xl font-extrabold">{t.streams_reported ? (margin >= 0 ? `Leading by ${num(margin)}` : `Trailing by ${num(-margin)}`) : "Waiting for the first results"}</p>
            <p className="mt-1 text-sm text-slate-300">{num(t.streams_reported)} of {num(t.streams_total)} streams reported · {num(t.valid)} valid votes · {num(t.rejected)} rejected</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Which forms count" className="inline-flex rounded-xl bg-white/10 p-1">
              {([[false, "All received"], [true, "Verified only"]] as const).map(([v, l]) => (
                <button key={l} role="tab" aria-selected={verified === v} onClick={() => setVerified(v)}
                  className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", verified === v ? "bg-white text-navy-900" : "text-slate-300 hover:text-white")}>{l}</button>
              ))}
            </div>
            {onEditBallot && t.streams_reported === 0 && t.forms.disputed === 0 && <button onClick={onEditBallot} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/15 hover:text-white">Edit ballot</button>}
          </div>
        </div>
        <span className="mt-4 block h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-gold" style={{ width: `${pctOf(t.streams_reported, t.streams_total)}%` }} /></span>
      </div>
      <ul className="divide-y divide-line">
        {ranked.map((c, i) => {
          const v = t.totals[c.id] ?? 0;
          return (
            <li key={c.id} className={cn("flex items-center gap-4 px-5 py-3.5", c.ours && "bg-kenya-green/[.04]")}>
              <span className="w-5 text-center text-sm font-bold text-slate-400">{i === 0 && t.streams_reported ? <Trophy className="size-4 text-gold" /> : i + 1}</span>
              <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-navy-900">{c.name}{c.ours && <Badge tone="green" className="ml-2">Ours</Badge>}</p>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${pctOf(v, t.valid)}%`, background: c.color }} /></span>
              </div>
              <div className="text-right"><p className="font-display text-xl font-bold text-navy-900 tabular-nums">{num(v)}</p><p className="text-xs text-slate-500 tabular-nums">{pctOf(v, t.valid).toFixed(1)}%</p></div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line">
        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <p className="text-sm font-bold text-navy-900">By area</p>
          <div role="tablist" className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {(["constituencies", "wards"] as const).map((l) => <button key={l} role="tab" aria-selected={level === l} onClick={() => setLevel(l)}
              className={cn("rounded-md px-3 py-1 text-xs font-semibold capitalize", level === l ? "bg-white text-navy-900 shadow-sm" : "text-slate-500")}>{l}</button>)}
          </div>
        </div>
        <AreaTable rows={level === "constituencies" ? t.constituencies : t.wards} t={t} ours={ours} />
      </div>
    </Card>
  );
}

function AreaTable({ rows, t, ours }: { rows: Tally["wards"]; t: Tally; ours: Candidate }) {
  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold tracking-wider text-muted uppercase">
          <tr><th className="px-5 py-2.5">Area</th><th className="px-3 py-2.5 text-right">Streams in</th><th className="px-3 py-2.5 text-right">Ours</th><th className="px-3 py-2.5">Share</th><th className="px-5 py-2.5 text-right">Lead</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((a) => {
            const total = Object.values(a.votes).reduce((s, v) => s + v, 0);
            const mine = a.votes[ours.id] ?? 0;
            const best = Math.max(0, ...t.candidates.filter((c) => !c.ours).map((c) => a.votes[c.id] ?? 0));
            return (
              <tr key={a.id}>
                <td className="px-5 py-2.5"><p className="font-semibold text-navy-900">{a.name}</p>{a.constituency && <p className="text-xs text-muted">{a.constituency}</p>}</td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{a.reported} / {a.streams}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-navy-900 tabular-nums">{num(mine)}</td>
                <td className="px-3 py-2.5"><span className="flex items-center gap-2"><span className="block h-2 w-20 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-kenya-green" style={{ width: `${pctOf(mine, total)}%` }} /></span><span className="text-xs text-slate-600 tabular-nums">{total ? `${pctOf(mine, total).toFixed(0)}%` : "—"}</span></span></td>
                <td className={cn("px-5 py-2.5 text-right font-semibold tabular-nums", !total ? "text-slate-400" : mine >= best ? "text-kenya-green" : "text-kenya-red")}>{total ? `${mine - best >= 0 ? "+" : "−"}${num(Math.abs(mine - best))}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubmitForm({ candidates }: { candidates: Candidate[] }) {
  const user = useUser();
  const tree = useGeoTree();
  const [wardId, setWardId] = useState(user.ward_id ?? "");
  const stations = useStations(wardId || undefined, undefined, !!wardId);
  const [stationId, setStationId] = useState("");
  const [stream, setStream] = useState("1");
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState("0");
  const [photo, setPhoto] = useState<File | null>(null);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = useSubmitResult();
  const station = stations.data?.find((s) => s.id === stationId);
  const total = candidates.reduce((s, c) => s + (+votes[c.id] || 0), 0) + (+rejected || 0);

  function send() {
    if (!stationId) return toast.error("Choose the polling centre");
    if (candidates.some((c) => votes[c.id] === undefined || votes[c.id] === "")) return toast.error("Enter the votes for every candidate, even 0");
    if (!photo) return toast.error("Take a photo of the signed Form 34A");
    const f = new FormData();
    f.append("station_id", stationId);
    f.append("stream_no", stream);
    f.append("votes", JSON.stringify(Object.fromEntries(candidates.map((c) => [c.id, +votes[c.id] || 0]))));
    f.append("rejected", String(+rejected || 0));
    f.append("photo", photo);
    submit.mutate(f, {
      onSuccess: () => { toast.success("Result sent. Thank you."); setVotes({}); setRejected("0"); setPhoto(null); },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <Card className="self-start overflow-hidden">
      <CardHeader title="Submit a Form 34A" subtitle="Copy the numbers exactly as declared at your stream, then photograph the signed form." />
      <div className="space-y-4 p-5">
        {user.role !== "field_agent" && (
          <Select label="Ward" value={wardId} placeholder="Choose the ward" onChange={(e) => { setWardId(e.target.value); setStationId(""); }}>
            {tree.data?.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
          </Select>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <Select label="Polling centre" value={stationId} placeholder="Choose" onChange={(e) => { setStationId(e.target.value); setStream("1"); }}>
            {stations.data?.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select label="Stream" value={stream} onChange={(e) => setStream(e.target.value)}>
            {Array.from({ length: station?.streams ?? 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-line">
              <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-900">{c.name}</span>
              <input inputMode="numeric" value={votes[c.id] ?? ""} onChange={(e) => setVotes((v) => ({ ...v, [c.id]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                aria-label={`Votes for ${c.name}`} placeholder="0" className="h-10 w-24 rounded-lg border border-line px-2.5 text-right text-base font-semibold tabular-nums focus:border-ocean focus:outline-none" />
            </label>
          ))}
          <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-line">
            <span className="min-w-0 flex-1 text-sm font-semibold text-slate-600">Rejected ballots</span>
            <input inputMode="numeric" value={rejected} onChange={(e) => setRejected(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Rejected ballots"
              className="h-10 w-24 rounded-lg border border-line px-2.5 text-right text-base font-semibold tabular-nums focus:border-ocean focus:outline-none" />
          </label>
          <p className="text-right text-xs text-slate-500">Total ballots: <b className="text-navy-900 tabular-nums">{num(total)}</b>{station?.registered_voters && station.streams ? ` · about ${num(Math.round(station.registered_voters / station.streams))} registered per stream` : ""}</p>
        </div>
        <div>
          {preview ? (
            <div className="relative overflow-hidden rounded-2xl ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={preview} alt="Form 34A photo" className="max-h-64 w-full object-contain" />
              <button onClick={() => setPhoto(null)} aria-label="Remove photo" className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-navy-950/80 text-white"><X className="size-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-slate-500 hover:border-ocean hover:text-ocean">
              <Camera className="size-6" /> Photograph the signed Form 34A
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </div>
        <Button className="w-full" size="lg" loading={submit.isPending} icon={<Send className="size-4" />} onClick={send}>Send result</Button>
      </div>
    </Card>
  );
}

function FormsList({ candidates, reviewer }: { candidates: Candidate[]; reviewer: boolean }) {
  const [status, setStatus] = useState("");
  const forms = useResultForms({ status: status || undefined });
  const [open, setOpen] = useState<ResultFormRow | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div><p className="font-bold text-navy-900">{reviewer ? "Forms received" : "Your submissions"}</p><p className="text-xs text-slate-500">Newest first. Tap one to see the photo{reviewer ? " and verify it" : ""}.</p></div>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2 text-base sm:text-sm">
          <option value="">All</option><option value="submitted">Waiting to check</option><option value="verified">Verified</option><option value="disputed">Disputed</option>
        </select>
      </div>
      {forms.isLoading ? <SkeletonRows rows={4} /> : !forms.data?.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">No forms yet.</p> : (
        <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
          {forms.data.map((f) => (
            <li key={f.id}>
              <button onClick={() => setOpen(f)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                <PhotoImg url={f.photo_url} alt={`Form 34A ${f.station} stream ${f.stream_no}`} className="size-12 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-navy-900">{f.station} · stream {f.stream_no}</span>
                  <span className="block truncate text-xs text-slate-500">{f.ward} · {candidates.map((c) => `${c.name} ${num(f.votes[c.id] ?? 0)}`).join(" · ")}</span>
                </span>
                <StatusChip s={f.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <FormModal f={open} candidates={candidates} reviewer={reviewer} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function StatusChip({ s }: { s: ResultFormRow["status"] }) {
  return s === "verified" ? <Badge tone="green"><Check className="size-3" />Verified</Badge> : s === "disputed" ? <Badge tone="red"><CircleAlert className="size-3" />Disputed</Badge> : <Badge tone="amber">To check</Badge>;
}

function FormModal({ f, candidates, reviewer, onClose }: { f: ResultFormRow; candidates: Candidate[]; reviewer: boolean; onClose: () => void }) {
  const review = useReviewResult();
  const [note, setNote] = useState(f.note ?? "");
  const act = (status: string) => review.mutate({ id: f.id, status, note: note.trim() || undefined }, {
    onSuccess: () => { toast.success(status === "verified" ? "Verified" : status === "disputed" ? "Marked disputed" : "Back to waiting"); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={`${f.station} · stream ${f.stream_no}`} subtitle={`${f.ward} · IEBC ${f.code}${f.submitted_by ? ` · sent by ${f.submitted_by}` : ""}${f.updated_at ? ` ${timeAgo(f.updated_at)}` : ""}`}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <PhotoImg url={f.photo_url} alt="Form 34A photo" className="max-h-[520px] w-full rounded-2xl bg-slate-50 object-contain ring-1 ring-line" />
        <div className="space-y-3">
          <div className="flex items-center justify-between"><p className="text-sm font-bold text-navy-900">Entered numbers</p><StatusChip s={f.status} /></div>
          <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm"><span className="size-2.5 rounded-full" style={{ background: c.color }} /><span className="flex-1 text-navy-900">{c.name}</span><b className="tabular-nums">{num(f.votes[c.id] ?? 0)}</b></li>
            ))}
            <li className="flex px-3.5 py-2.5 text-sm text-slate-600"><span className="flex-1">Rejected</span><b className="tabular-nums">{num(f.rejected)}</b></li>
          </ul>
          {f.note && <p className="rounded-xl bg-red-50 p-3 text-sm text-kenya-red ring-1 ring-red-100">{f.note}</p>}
          {reviewer && (
            <>
              <Textarea label="Note (required to dispute)" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What doesn't match the photo?" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={review.isPending} icon={<Check className="size-4" />} onClick={() => act("verified")}>Matches the photo</Button>
                <Button size="sm" variant="secondary" disabled={review.isPending || !note.trim()} onClick={() => act("disputed")}>Dispute</Button>
                {f.status !== "submitted" && <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => act("submitted")}>Reset</Button>}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
