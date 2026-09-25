"use client";

import { Headphones, History, MapPin, Phone, PhoneOff, Smartphone, SkipForward, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, StatusBadge, SUPPORT, SupportBadge, Textarea } from "@/components/ui";
import { claimNext, releaseClaim, useAgentStats, useLogCall, useQueueCounts } from "@/features/calls/api";
import { Directory } from "@/features/calls/Directory";
import { RecordingsPanel } from "@/features/calls/RecordingsPanel";
import { SoftphonePanel } from "@/features/calls/SoftphonePanel";
import { type Softphone, uploadRecording, useSoftphone } from "@/features/calls/useSoftphone";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateTime, initials, num, timeAgo } from "@/lib/format";
import { can } from "@/lib/roles";
import type { CallOutcome, CallQueue, Claim, Support } from "@/lib/types";

const QUEUES: { id: CallQueue; label: string; hint: string }[] = [
  { id: "verify", label: "Verify", hint: "Confirm details of new records" },
  { id: "persuade", label: "Persuade", hint: "Undecided & leaning voters" },
  { id: "follow_up", label: "Call-backs", hint: "Promised follow-ups now due" },
  { id: "gotv", label: "Get out the vote", hint: "Supporters who haven't voted" },
];

const QUEUE_COLOR: Record<CallQueue, string> = { verify: "#0b7fa6", persuade: "#c9a227", follow_up: "#7b4fb8", gotv: "#006b3f" };

/** Agent status strip: who's on the line, line state, shift timer and today's own numbers. */
function AgentBar({ phone }: { phone: Softphone }) {
  const user = useUser();
  const stats = useAgentStats();
  const mine = stats.data?.find((a) => a.agent_id === user.id);
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - start) / 1000);
  const shift = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const state = phone.state === "in_call" ? ["On a call", "#ff8a7a"] : phone.state === "dialing" || phone.state === "ringing" ? ["Dialling", "#e3b53a"]
    : phone.state === "error" ? ["Line problem", "#ff5a4a"] : phone.state === "connecting" || phone.state === "offline" ? ["Connecting", "#94a3b8"] : ["Available", "#34c77b"];
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#06101f] p-4 text-white shadow-[0_18px_40px_-24px_rgba(6,16,31,.9)] sm:p-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.05] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:26px_26px]" />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-gold to-[#8a6d12] font-display text-lg font-extrabold text-navy-950">{initials(user.full_name)}</span>
          <div>
            <p className="font-semibold">{user.full_name}</p>
            <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase" style={{ color: state[1] }}>
              <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: state[1] }} /><span className="relative size-2 rounded-full" style={{ background: state[1] }} /></span>
              {state[0]}
            </p>
          </div>
        </div>
        <div className="ml-auto grid grid-cols-4 gap-2 text-center sm:gap-3">
          {([["Shift", shift], ["Calls", num(mine?.calls ?? 0)], ["Answered", num(mine?.answered ?? 0)], ["Verified", num(mine?.verified ?? 0)]] as const).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-white/[.05] px-3 py-2 ring-1 ring-white/[.08]">
              <p className="font-mono text-base font-bold tabular-nums sm:text-lg">{v}</p>
              <p className="text-xs text-slate-400">{k}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const OUTCOMES: { id: CallOutcome; label: string; tone: string }[] = [
  { id: "answered", label: "Answered", tone: "bg-kenya-green text-white" },
  { id: "no_answer", label: "No answer", tone: "bg-slate-600 text-white" },
  { id: "busy", label: "Busy", tone: "bg-slate-600 text-white" },
  { id: "call_back", label: "Call back later", tone: "bg-ocean text-white" },
  { id: "wrong_number", label: "Wrong number", tone: "bg-amber-600 text-white" },
  { id: "do_not_call", label: "Do not contact", tone: "bg-kenya-red text-white" },
];

export default function CallCentrePage() {
  const user = useUser();
  const supervisor = can.manageUsers(user.role);
  const [tab, setTab] = useState<"console" | "directory" | "recordings">("console");
  const [picked, setPicked] = useState<Claim | null>(null);
  const phone = useSoftphone();
  const tabs = supervisor ? (["console", "directory", "recordings"] as const) : (["console", "directory"] as const);

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Call centre"
        subtitle="Built-in softphone, recorded calls and live queues. One voter per agent at a time, logged against the voter's record."
        actions={(
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {tabs.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition", tab === t ? "bg-white text-navy-900 shadow-sm" : "text-muted")}>{t}</button>
            ))}
          </div>
        )} />
      {tab === "recordings" ? <RecordingsPanel />
        : tab === "directory" ? <Directory disabled={["dialing", "ringing", "in_call"].includes(phone.state)} onPicked={(c) => { setPicked(c); setTab("console"); }} />
        : <Console phone={phone} canManualDial={supervisor} picked={picked} />}
    </>
  );
}

function Console({ phone, canManualDial, picked }: { phone: Softphone; canManualDial: boolean; picked: Claim | null }) {
  const counts = useQueueCounts();
  const stats = useAgentStats();
  const [queue, setQueue] = useState<CallQueue>("verify");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  async function next(q = queue) {
    setLoading(true);
    setEmpty(false);
    phone.clearFinished();
    try {
      const c = await claimNext(q);
      setClaim(c ?? null);
      setEmpty(!c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load the next voter");
    } finally {
      setLoading(false);
      void counts.refetch();
    }
  }

  // Picked from the directory: load that person straight into the console.
  useEffect(() => {
    if (!picked) return;
    phone.clearFinished();
    setClaim(picked);
    setEmpty(false);
    setQueue(picked.voter.status === "pending" ? "verify" : "persuade");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new person is picked
  }, [picked]);

  // Leaving the page releases the claim so a colleague can take the voter.
  useEffect(() => () => void releaseClaim().catch(() => {}), []);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <AgentBar phone={phone} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {QUEUES.map((q) => {
            const on = queue === q.id;
            const waiting = counts.data?.[q.id] ?? 0;
            return (
              <button key={q.id} disabled={["dialing", "ringing", "in_call"].includes(phone.state)}
                onClick={() => { setQueue(q.id); if (claim) void releaseClaim(); setClaim(null); setEmpty(false); }}
                className={cn("group relative overflow-hidden rounded-3xl p-4 text-left transition duration-300 disabled:opacity-60",
                  on ? "bg-[#06101f] text-white shadow-[0_18px_40px_-22px_rgba(6,16,31,.9)]" : "bg-white ring-1 ring-line hover:-translate-y-0.5 hover:shadow-lg")}>
                <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: QUEUE_COLOR[q.id] }} />
                {on && <span aria-hidden className="pointer-events-none absolute -right-8 -bottom-10 size-28 rounded-full blur-2xl" style={{ background: `${QUEUE_COLOR[q.id]}55` }} />}
                <div className="relative flex items-center justify-between">
                  <p className={cn("text-xs font-bold tracking-[.14em] uppercase", on ? "text-gold" : "text-slate-500")}>{q.label}</p>
                  {waiting > 0 && <span className="relative flex size-2.5"><span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: QUEUE_COLOR[q.id] }} /><span className="relative size-2.5 rounded-full" style={{ background: QUEUE_COLOR[q.id] }} /></span>}
                </div>
                <p className="relative mt-2 font-display text-3xl leading-none font-extrabold tabular-nums">{counts.data ? num(waiting) : "–"}</p>
                <p className={cn("relative mt-0.5 text-xs font-semibold", on ? "text-slate-300" : "text-slate-500")}>waiting</p>
                <p className={cn("relative mt-2 text-xs", on ? "text-slate-400" : "text-muted")}>{q.hint}</p>
              </button>
            );
          })}
        </div>

        {loading ? (
          <Card className="grid h-80 place-items-center"><div className="flex flex-col items-center gap-3 text-sm text-muted"><Spinner size="lg" />Finding the next voter…</div></Card>
        ) : claim ? (
          <CallCard key={claim.voter.id} claim={claim} queue={queue} phone={phone} onDone={() => next()} onSkip={async () => { await releaseClaim(); await next(); }} />
        ) : (
          <Card>
            <EmptyState icon={<Headphones className="size-6" />}
              title={empty ? "This queue is clear" : "Ready when you are"}
              body={empty ? "Nobody left to call in this queue right now. Try another queue or check back later." : "Press start and the next voter in the queue is reserved for you."}
              action={<Button size="lg" icon={<Phone className="size-4" />} onClick={() => next()}>{empty ? "Check again" : "Start calling"}</Button>} />
          </Card>
        )}
      </div>

      <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
        <SoftphonePanel phone={phone} canManualDial={canManualDial} />
        <Card>
          <CardHeader title="Today's leaderboard" subtitle="Calls since midnight" />
          {stats.data?.length ? (
            <ol className="space-y-3 p-5">
              {stats.data.map((a, i) => (
                <li key={a.agent_id} className="flex items-center gap-3">
                  <span className={cn("grid size-8 place-items-center rounded-full text-xs font-bold", i === 0 ? "bg-gold text-navy-950" : "bg-slate-100 text-slate-600")}>
                    {i === 0 ? <Trophy className="size-4" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-900">{a.agent_name}</p>
                    <p className="text-xs text-muted">{num(a.answered)} answered · {num(a.verified)} verified</p>
                  </div>
                  <span className="font-display text-lg font-bold text-navy-900 tabular-nums">{num(a.calls)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="p-5 text-sm text-muted">No calls logged yet today.</p>}
        </Card>
      </div>
    </div>
  );
}

function CallCard({ claim, queue, phone, onDone, onSkip }: { claim: Claim; queue: CallQueue; phone: Softphone; onDone: () => void; onSkip: () => void }) {
  const v = claim.voter;
  const log = useLogCall();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [support, setSupport] = useState<Support>(v.support);
  const [verify, setVerify] = useState(v.status === "pending");
  const [notes, setNotes] = useState("");
  const [issue, setIssue] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const live = ["dialing", "ringing", "in_call"].includes(phone.state);
  const thisCall = phone.party?.voterId === v.id;
  const finished = phone.finished?.party.voterId === v.id ? phone.finished : null;

  const callNow = () => phone.dial({ voterId: v.id, name: v.full_name, number: v.phone });

  async function save() {
    if (!outcome) return toast.error("Choose how the call went");
    if (outcome === "call_back" && !followUp) return toast.error("Pick when to call back");
    if (live && thisCall) await phone.hangup();
    setSaving(true);
    try {
      let recordingId: string | undefined;
      if (finished) {
        try {
          recordingId = await uploadRecording(finished);
        } catch (e) {
          toast.error(`Recording not saved: ${e instanceof Error ? e.message : "upload failed"}`);
        }
      }
      await log.mutateAsync({
        voter_id: v.id, queue, outcome,
        support: outcome === "answered" ? support : undefined,
        verify: outcome === "answered" && verify,
        notes: notes.trim() || undefined, issue: issue.trim() || undefined,
        duration_seconds: finished?.seconds,
        follow_up_at: followUp ? `${followUp}:00+03:00` : undefined,
        ...(recordingId ? { recording_id: recordingId } : {}),
        ...(finished?.consent === "declined" ? { recording_declined: true } : {}),
      });
      toast.success(recordingId ? "Call and recording saved" : "Call logged");
      phone.clearFinished();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the call");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="animate-fade-up overflow-hidden">
      <div className="flex flex-col gap-4 bg-gradient-to-r from-navy-950 to-navy-800 p-5 text-white sm:flex-row sm:items-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-white/10 font-display text-xl font-bold text-gold">{initials(v.full_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-xl font-bold">{v.full_name}</p>
            <StatusBadge status={v.status} />
            <SupportBadge support={v.support} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-slate-300">
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{v.ward_name}, {v.constituency_name}</span>
            <span>{v.station_name ?? "No polling station"}</span>
            <span>{v.reference}</span>
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {live && thisCall ? (
            <button onClick={() => void phone.hangup()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-kenya-red px-5 font-semibold shadow-lg shadow-kenya-red/30 hover:brightness-110">
              <PhoneOff className="size-4" /> End call
            </button>
          ) : (
            <button onClick={callNow} disabled={!["ready", "ended"].includes(phone.state)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1fa463] px-5 font-semibold shadow-lg shadow-[#1fa463]/30 hover:brightness-110 disabled:opacity-50">
              <Phone className="size-4" /> Call now
            </button>
          )}
          <a href={`tel:${v.phone}`} className="inline-flex items-center justify-center gap-1.5 text-xs text-slate-300 hover:text-white">
            <Smartphone className="size-3.5" /> Use my own phone ({v.phone})
          </a>
        </div>
      </div>

      {finished && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-slate-50 px-5 py-2.5 text-xs text-slate-700">
          Call lasted <b>{Math.floor(finished.seconds / 60)}m {finished.seconds % 60}s</b>
          {finished.consent === "declined" ? <Badge>Recording declined</Badge> : finished.recording ? <Badge tone="blue">Recording ready to save</Badge> : <Badge>Not recorded</Badge>}
        </div>
      )}

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-navy-900">How did it go?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {OUTCOMES.map((o) => (
                <button key={o.id} onClick={() => setOutcome(o.id)}
                  className={cn("h-11 rounded-xl text-sm font-semibold ring-1 transition", outcome === o.id ? `${o.tone} ring-transparent` : "bg-white text-slate-700 ring-line hover:ring-slate-300")}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {outcome === "answered" && (
            <div className="animate-fade-up space-y-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-line">
              <div>
                <p className="mb-2 text-sm font-semibold text-navy-900">Support level after the call</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(SUPPORT) as Support[]).map((s) => (
                    <button key={s} onClick={() => setSupport(s)}
                      className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1", support === s ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-slate-600 ring-line")}>{SUPPORT[s][1]}</button>
                  ))}
                </div>
              </div>
              {v.status === "pending" && (
                <label className="flex items-start gap-2 text-sm text-navy-900">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-kenya-green" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
                  <span>I confirmed their name, ward and polling station, so <b>mark this record verified</b></span>
                </label>
              )}
              <Input label="Main issue raised" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="e.g. water, jobs, roads" maxLength={120} />
            </div>
          )}
          {outcome === "call_back" && (
            <Input type="datetime-local" label="Call back at (Nairobi time)" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="max-w-xs" />
          )}
          {outcome === "do_not_call" && (
            <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-kenya-red ring-1 ring-red-100">
              <PhoneOff className="size-4" /> This voter will be removed from all calls and messages.
            </p>
          )}
          <Textarea label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the next caller should know" />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" icon={<SkipForward className="size-4" />} onClick={onSkip} disabled={saving || (live && thisCall)}>Skip</Button>
            <Button size="lg" variant="gold" loading={saving} onClick={save}>Save & next voter</Button>
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-navy-900"><History className="size-4" /> Previous calls</p>
          {claim.history.length ? (
            <ol className="space-y-3">
              {claim.history.map((h) => (
                <li key={h.id} className="rounded-xl bg-slate-50 p-3 text-xs ring-1 ring-line">
                  <div className="flex items-center justify-between"><Badge>{h.outcome.replace(/_/g, " ")}</Badge><span className="text-muted">{timeAgo(h.created_at)}</span></div>
                  <p className="mt-1.5 text-slate-600">{h.agent_name}{h.issue && ` · ${h.issue}`}{h.recording_id && " · recorded"}</p>
                  {h.notes && <p className="mt-1 text-slate-800">{h.notes}</p>}
                </li>
              ))}
            </ol>
          ) : <p className="text-xs text-muted">First contact with this voter.</p>}
          <p className="mt-4 text-xs text-muted">Reserved for you until {dateTime(claim.locked_until)} · {num(claim.remaining)} left in queue</p>
        </div>
      </div>
    </Card>
  );
}
