"use client";

import { Clock, Headphones, History, MapPin, Phone, PhoneOff, SkipForward, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, StatusBadge, SUPPORT, SupportBadge, Textarea } from "@/components/ui";
import { claimNext, releaseClaim, useAgentStats, useLogCall, useQueueCounts } from "@/features/calls/api";
import { cn } from "@/lib/cn";
import { dateTime, initials, num, timeAgo } from "@/lib/format";
import type { CallOutcome, CallQueue, Claim, Support } from "@/lib/types";

const QUEUES: { id: CallQueue; label: string; hint: string }[] = [
  { id: "verify", label: "Verify", hint: "Confirm details of new records" },
  { id: "persuade", label: "Persuade", hint: "Undecided & leaning voters" },
  { id: "follow_up", label: "Call-backs", hint: "Promised follow-ups now due" },
  { id: "gotv", label: "Get out the vote", hint: "Supporters who haven't voted" },
];

const OUTCOMES: { id: CallOutcome; label: string; tone: string }[] = [
  { id: "answered", label: "Answered", tone: "bg-kenya-green text-white" },
  { id: "no_answer", label: "No answer", tone: "bg-slate-600 text-white" },
  { id: "busy", label: "Busy", tone: "bg-slate-600 text-white" },
  { id: "call_back", label: "Call back later", tone: "bg-ocean text-white" },
  { id: "wrong_number", label: "Wrong number", tone: "bg-amber-600 text-white" },
  { id: "do_not_call", label: "Do not contact", tone: "bg-kenya-red text-white" },
];

export default function CallCentrePage() {
  const counts = useQueueCounts();
  const stats = useAgentStats();
  const [queue, setQueue] = useState<CallQueue>("verify");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  async function next(q = queue) {
    setLoading(true);
    setEmpty(false);
    try {
      const c = await claimNext(q);
      setClaim(c ?? null);
      setEmpty(!c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load the next voter");
    } finally {
      setLoading(false);
      counts.refetch();
    }
  }

  // Leaving the page releases the claim so a colleague can take the voter.
  useEffect(() => () => void releaseClaim().catch(() => {}), []);

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Call centre" subtitle="One voter at a time, never the same person as a colleague. Every call is logged against the voter's record." />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {QUEUES.map((q) => (
              <button key={q.id} onClick={() => { setQueue(q.id); if (claim) void releaseClaim(); setClaim(null); setEmpty(false); }}
                className={cn("rounded-2xl p-4 text-left ring-1 transition", queue === q.id ? "bg-navy-950 text-white ring-navy-950" : "bg-white ring-line hover:ring-slate-300")}>
                <p className={cn("text-xs font-semibold", queue === q.id ? "text-gold" : "text-muted")}>{q.label}</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums">{counts.data ? num(counts.data[q.id]) : "–"}</p>
                <p className={cn("mt-1 text-[11px]", queue === q.id ? "text-slate-400" : "text-muted")}>{q.hint}</p>
              </button>
            ))}
          </div>

          {loading ? (
            <Card className="grid h-80 place-items-center"><div className="flex flex-col items-center gap-3 text-sm text-muted"><Spinner size="lg" />Finding the next voter…</div></Card>
          ) : claim ? (
            <CallCard key={claim.voter.id} claim={claim} queue={queue} onDone={() => next()} onSkip={async () => { await releaseClaim(); next(); }} />
          ) : (
            <Card>
              <EmptyState icon={<Headphones className="size-6" />}
                title={empty ? "This queue is clear" : "Ready when you are"}
                body={empty ? "Nobody left to call in this queue right now. Try another queue or check back later." : "Press start and the next voter in the queue is reserved for you."}
                action={<Button size="lg" icon={<Phone className="size-4" />} onClick={() => next()}>{empty ? "Check again" : "Start calling"}</Button>} />
            </Card>
          )}
        </div>

        <Card className="xl:sticky xl:top-24 xl:self-start">
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
                    <p className="text-[11px] text-muted">{num(a.answered)} answered · {num(a.verified)} verified</p>
                  </div>
                  <span className="font-display text-lg font-bold text-navy-900 tabular-nums">{num(a.calls)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="p-5 text-sm text-muted">No calls logged yet today.</p>}
        </Card>
      </div>
    </>
  );
}

function CallCard({ claim, queue, onDone, onSkip }: { claim: Claim; queue: CallQueue; onDone: () => void; onSkip: () => void }) {
  const v = claim.voter;
  const log = useLogCall();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [support, setSupport] = useState<Support>(v.support);
  const [verify, setVerify] = useState(v.status === "pending");
  const [notes, setNotes] = useState("");
  const [issue, setIssue] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);
  const dial = () => {
    setStarted(Date.now());
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  function save() {
    if (!outcome) return toast.error("Choose how the call went");
    if (outcome === "call_back" && !followUp) return toast.error("Pick when to call back");
    clearInterval(timer.current);
    log.mutate({
      voter_id: v.id, queue, outcome,
      support: outcome === "answered" ? support : undefined,
      verify: outcome === "answered" && verify,
      notes: notes.trim() || undefined, issue: issue.trim() || undefined,
      duration_seconds: started ? Math.round((Date.now() - started) / 1000) : undefined,
      follow_up_at: followUp ? `${followUp}:00+03:00` : undefined,
    }, {
      onSuccess: () => { toast.success("Call logged"); onDone(); },
      onError: (e) => toast.error(e.message),
    });
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
        <div className="flex items-center gap-2">
          {started && <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 font-mono text-sm"><Clock className="size-4 text-gold" />{mmss}</span>}
          <a href={`tel:${v.phone}`} onClick={() => !started && dial()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-kenya-green px-5 font-semibold text-white shadow-lg shadow-kenya-green/30 hover:bg-kenya-green-600">
            <Phone className="size-4" /> {v.phone}
          </a>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-[13px] font-semibold text-navy-900">How did it go?</p>
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
                <p className="mb-2 text-[13px] font-semibold text-navy-900">Support level after the call</p>
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
            <Button variant="ghost" icon={<SkipForward className="size-4" />} onClick={onSkip} disabled={log.isPending}>Skip</Button>
            <Button size="lg" variant="gold" loading={log.isPending} onClick={save}>Save & next voter</Button>
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-navy-900"><History className="size-4" /> Previous calls</p>
          {claim.history.length ? (
            <ol className="space-y-3">
              {claim.history.map((h) => (
                <li key={h.id} className="rounded-xl bg-slate-50 p-3 text-xs ring-1 ring-line">
                  <div className="flex items-center justify-between"><Badge>{h.outcome.replace(/_/g, " ")}</Badge><span className="text-muted">{timeAgo(h.created_at)}</span></div>
                  <p className="mt-1.5 text-slate-600">{h.agent_name}{h.issue && ` · ${h.issue}`}</p>
                  {h.notes && <p className="mt-1 text-slate-800">{h.notes}</p>}
                </li>
              ))}
            </ol>
          ) : <p className="text-xs text-muted">First contact with this voter.</p>}
          <p className="mt-4 text-[11px] text-muted">Reserved for you until {dateTime(claim.locked_until)} · {num(claim.remaining)} left in queue</p>
        </div>
      </div>
    </Card>
  );
}
