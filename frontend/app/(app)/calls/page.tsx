"use client";

import {
  CalendarClock, Check, CircleSlash, Clock, Handshake, Headphones, History, ListChecks, MapPin, Megaphone, NotebookPen, Phone, PhoneCall,
  PhoneMissed, PhoneOff, Radio, ShieldCheck, SkipForward, Smartphone, Trophy, UserX, Vote, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Badge, Button, Card, Input, StatusBadge, SUPPORT, SupportBadge, Textarea } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { claimNext, releaseClaim, useAgentStats, useLogCall, useQueueCounts } from "@/features/calls/api";
import { Directory } from "@/features/calls/Directory";
import { RecordingsPanel } from "@/features/calls/RecordingsPanel";
import { SoftphonePanel } from "@/features/calls/SoftphonePanel";
import { type Softphone, uploadRecording, useSoftphone } from "@/features/calls/useSoftphone";
import { ReportIssueModal } from "@/features/issues/ReportIssueModal";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateTime, initials, num, timeAgo } from "@/lib/format";
import { can } from "@/lib/roles";
import type { CallOutcome, CallQueue, Claim, Support } from "@/lib/types";

const QUEUES: { id: CallQueue; label: string; hint: string; icon: LucideIcon; color: string }[] = [
  { id: "verify", label: "Verify", hint: "Confirm details of new records", icon: ShieldCheck, color: "#0b7fa6" },
  { id: "persuade", label: "Persuade", hint: "Undecided & leaning voters", icon: Handshake, color: "#c9a227" },
  { id: "follow_up", label: "Call-backs", hint: "Promised follow-ups now due", icon: CalendarClock, color: "#7b4fb8" },
  { id: "gotv", label: "Get out the vote", hint: "Supporters who haven't voted", icon: Vote, color: "#006b3f" },
];
const QUEUE = Object.fromEntries(QUEUES.map((q) => [q.id, q])) as Record<CallQueue, (typeof QUEUES)[number]>;

type LineLook = { label: string; color: string };
function lineLook(phone: Softphone): LineLook {
  if (phone.state === "in_call") return { label: "On a call", color: "#ff8a7a" };
  if (phone.state === "dialing" || phone.state === "ringing") return { label: "Dialling", color: "#e3b53a" };
  if (phone.state === "error") return { label: "Line problem", color: "#ff5a4a" };
  if (phone.state === "connecting" || phone.state === "offline") return { label: "Connecting", color: "#94a3b8" };
  if (phone.state === "ended") return { label: "Wrap-up", color: "#7cc4e8" };
  return { label: "Available", color: "#34c77b" };
}

const TABS = [
  { id: "console", label: "Console", icon: Headphones },
  { id: "directory", label: "Directory", icon: ListChecks },
  { id: "recordings", label: "Recordings", icon: Radio },
] as const;

export default function CallCentrePage() {
  const user = useUser();
  const supervisor = can.manageUsers(user.role);
  const [tab, setTab] = useState<"console" | "directory" | "recordings">("console");
  const [picked, setPicked] = useState<Claim | null>(null);
  const phone = useSoftphone();
  const tabs = TABS.filter((t) => t.id !== "recordings" || supervisor);

  return (
    <>
      <ConsoleHeader phone={phone} tab={tab} tabs={tabs} onTab={setTab} />
      {tab === "recordings" ? <RecordingsPanel />
        : tab === "directory" ? <Directory disabled={["dialing", "ringing", "in_call"].includes(phone.state)} onPicked={(c) => { setPicked(c); setTab("console"); }} />
        : <Console phone={phone} canManualDial={supervisor} picked={picked} />}
    </>
  );
}

/** Dark operations bar: title, line status, clock and the section switcher. */
function ConsoleHeader({ phone, tab, tabs, onTab }: {
  phone: Softphone; tab: string; tabs: readonly (typeof TABS)[number][]; onTab: (t: "console" | "directory" | "recordings") => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const sip = phone.config?.provider === "sip";
  const ok = !(phone.state === "error" || phone.configError);
  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-[0_24px_50px_-30px_rgba(6,16,31,.9)]">
      <div aria-hidden className="absolute inset-x-0 top-0 flex h-1"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_90%_-20%,rgba(11,127,166,.4),transparent_55%),radial-gradient(ellipse_at_0%_120%,rgba(0,107,63,.3),transparent_55%)]" />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4 px-5 pt-6 pb-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/[.07] ring-1 ring-white/10"><PhoneCall className="size-6 text-gold" /></span>
          <div>
            <p className="text-xs font-semibold tracking-[.18em] text-gold uppercase">Outreach</p>
            <h1 className="font-display text-2xl leading-tight font-extrabold">Call centre</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1",
            ok ? "bg-[#34c77b]/10 text-[#8ff0bf] ring-[#34c77b]/30" : "bg-red-500/10 text-red-300 ring-red-500/30")}>
            <span className={cn("size-2 rounded-full", ok ? "animate-pulse bg-[#34c77b]" : "bg-red-400")} />
            {ok ? (sip ? "Live phone line" : "Training line (sandbox)") : "Line problem"}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10">
            <ShieldCheck className="size-3.5 text-gold" /> Recorded with consent · encrypted
          </span>
        </div>
        <p className="ml-auto hidden font-mono text-2xl font-bold text-white/90 tabular-nums sm:block" suppressHydrationWarning>
          {now ? now.toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "--:--:--"}
        </p>
      </div>
      <div role="tablist" aria-label="Call centre" className="relative flex gap-1 overflow-x-auto px-3 sm:px-4">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}
            className={cn("relative inline-flex items-center gap-2 rounded-t-xl px-4 py-3 text-sm font-semibold whitespace-nowrap transition",
              tab === id ? "bg-canvas text-navy-900" : "text-slate-400 hover:text-white")}>
            <Icon className={cn("size-4", tab === id && "text-ocean")} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The agent's own deck: status, shift, today's numbers and answer rate. */
function AgentDeck({ phone }: { phone: Softphone }) {
  const user = useUser();
  const stats = useAgentStats();
  const mine = stats.data?.find((a) => a.agent_id === user.id);
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = Math.floor((now - start) / 1000);
  const shift = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const look = lineLook(phone);
  const calls = mine?.calls ?? 0;
  const rate = calls ? Math.round(((mine?.answered ?? 0) / calls) * 100) : 0;
  const tiles: [string, string, LucideIcon][] = [
    ["Calls", num(calls), Phone], ["Answered", num(mine?.answered ?? 0), PhoneCall], ["Verified", num(mine?.verified ?? 0), ShieldCheck], ["Shift", shift, Clock],
  ];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative rounded-full p-[3px]" style={{ background: look.color }}>
            <Avatar userId={user.id} name={user.full_name} size={52} hasPhoto={user.has_photo} ring={false} className="ring-2 ring-white" />
            <span className="absolute right-0 bottom-0 size-3.5 rounded-full ring-2 ring-white" style={{ background: look.color }} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-navy-900">{user.full_name}</p>
            <p className="text-xs font-bold tracking-wider uppercase" style={{ color: look.color === "#34c77b" ? "#1b8f55" : look.color === "#ff8a7a" ? "#c8102e" : "#64748b" }}>{look.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-navy-950 px-4 py-2 text-white">
          <svg viewBox="0 0 36 36" className="size-10 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="4" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#34c77b" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(rate / 100) * 97.4} 97.4`} />
          </svg>
          <div><p className="font-display text-xl leading-none font-bold tabular-nums">{rate}%</p><p className="mt-0.5 text-xs text-slate-400">answer rate today</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        {tiles.map(([k, v, Icon]) => (
          <div key={k} className="px-4 py-3 sm:px-5">
            <p className="flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-500"><Icon className="size-3.5 shrink-0" />{k}</p>
            <p className="mt-0.5 font-mono text-xl font-bold whitespace-nowrap text-navy-900 tabular-nums">{v}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

const OUTCOMES: { id: CallOutcome; label: string; icon: LucideIcon; tone: string }[] = [
  { id: "answered", label: "Answered", icon: PhoneCall, tone: "bg-kenya-green text-white ring-kenya-green" },
  { id: "no_answer", label: "No answer", icon: PhoneMissed, tone: "bg-slate-700 text-white ring-slate-700" },
  { id: "busy", label: "Busy", icon: Clock, tone: "bg-slate-700 text-white ring-slate-700" },
  { id: "call_back", label: "Call back later", icon: CalendarClock, tone: "bg-ocean text-white ring-ocean" },
  { id: "wrong_number", label: "Wrong number", icon: UserX, tone: "bg-amber-600 text-white ring-amber-600" },
  { id: "do_not_call", label: "Do not contact", icon: CircleSlash, tone: "bg-kenya-red text-white ring-kenya-red" },
];

function Console({ phone, canManualDial, picked }: { phone: Softphone; canManualDial: boolean; picked: Claim | null }) {
  const counts = useQueueCounts();
  const stats = useAgentStats();
  const [queue, setQueue] = useState<CallQueue>("verify");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const busy = ["dialing", "ringing", "in_call"].includes(phone.state);
  const total = QUEUES.reduce((a, q) => a + (counts.data?.[q.id] ?? 0), 0);

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

  const q = QUEUE[queue];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        <AgentDeck phone={phone} />

        {/* Queues */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {QUEUES.map((x) => {
            const on = queue === x.id;
            const waiting = counts.data?.[x.id] ?? 0;
            const share = total ? (waiting / total) * 100 : 0;
            return (
              <button key={x.id} disabled={busy}
                onClick={() => { setQueue(x.id); if (claim) void releaseClaim(); setClaim(null); setEmpty(false); }}
                className={cn("group relative overflow-hidden rounded-3xl p-4 text-left transition duration-300 disabled:opacity-60",
                  on ? "bg-[#06101f] text-white shadow-[0_18px_40px_-22px_rgba(6,16,31,.9)]" : "bg-white ring-1 ring-line hover:-translate-y-0.5 hover:shadow-lg")}>
                {on && <span aria-hidden className="pointer-events-none absolute -right-8 -bottom-10 size-32 rounded-full blur-2xl" style={{ background: `${x.color}66` }} />}
                <div className="relative flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl" style={{ background: on ? `${x.color}33` : `${x.color}14`, color: on ? "#fff" : x.color }}><x.icon className="size-[18px]" /></span>
                  {waiting > 0 && <span className="relative flex size-2.5"><span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: x.color }} /><span className="relative size-2.5 rounded-full" style={{ background: x.color }} /></span>}
                </div>
                <p className={cn("relative mt-3 text-xs font-bold tracking-[.14em] uppercase", on ? "text-gold" : "text-slate-500")}>{x.label}</p>
                <p className="relative mt-1 font-display text-3xl leading-none font-extrabold tabular-nums">{counts.data ? num(waiting) : "–"}<span className={cn("ml-1.5 text-xs font-semibold", on ? "text-slate-400" : "text-slate-400")}>waiting</span></p>
                <span className={cn("relative mt-3 block h-1.5 overflow-hidden rounded-full", on ? "bg-white/10" : "bg-slate-100")}>
                  <span className="block h-full rounded-full" style={{ width: `${share}%`, background: x.color }} />
                </span>
                <p className={cn("relative mt-2 text-xs", on ? "text-slate-400" : "text-muted")}>{x.hint}</p>
              </button>
            );
          })}
        </div>

        {loading ? (
          <Card className="grid h-80 place-items-center"><div className="flex flex-col items-center gap-3 text-sm text-muted"><Spinner size="lg" />Reserving the next voter in {q.label}…</div></Card>
        ) : claim ? (
          <CallCard key={claim.voter.id} claim={claim} queue={queue} phone={phone} onDone={() => next()} onSkip={async () => { await releaseClaim(); await next(); }} />
        ) : (
          <Card className="relative overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.35] [background-image:radial-gradient(circle_at_center,#e2e8f0_1px,transparent_1px)] [background-size:22px_22px]" />
            <div className="relative flex flex-col items-center px-6 py-14 text-center">
              <span className="relative grid size-24 place-items-center">
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full opacity-20" style={{ background: q.color }} />
                <span aria-hidden className="absolute inset-3 rounded-full opacity-20" style={{ background: q.color }} />
                <span className="relative grid size-14 place-items-center rounded-full text-white shadow-lg" style={{ background: q.color }}><Headphones className="size-7" /></span>
              </span>
              <p className="mt-5 font-display text-2xl font-extrabold text-navy-900">{empty ? `${q.label} is clear` : "Ready when you are"}</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {empty ? "Nobody left to call in this queue right now. Try another queue or check back later."
                  : <>Press start and the next voter in <b className="text-navy-900">{q.label}</b> is reserved for you: {q.hint.toLowerCase()}.</>}
              </p>
              <Button size="lg" className="mt-6 min-w-52" icon={<Phone className="size-4" />} onClick={() => next()}>{empty ? "Check again" : `Start calling · ${q.label}`}</Button>
              <p className="mt-4 text-xs text-slate-400">{counts.data ? `${num(counts.data[queue] ?? 0)} waiting in this queue · ${num(total)} across all queues` : ""}</p>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
        <SoftphonePanel phone={phone} canManualDial={canManualDial} />
        <Leaderboard stats={stats.data} />
      </div>
    </div>
  );
}

function Leaderboard({ stats }: { stats: ReturnType<typeof useAgentStats>["data"] }) {
  const user = useUser();
  const list = stats ?? [];
  const max = Math.max(1, ...list.map((a) => a.calls));
  const podium = [list[1], list[0], list[2]];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><p className="font-bold text-navy-900">Today&apos;s leaderboard</p><p className="text-xs text-muted">Calls since midnight</p></div>
        <Trophy className="size-5 text-gold" />
      </div>
      {!list.length ? <p className="p-5 text-sm text-muted">No calls logged yet today. The first call takes the lead.</p> : (
        <>
          <div className="grid grid-cols-3 items-end gap-2 bg-gradient-to-b from-slate-50 to-white px-4 pt-5">
            {podium.map((a, i) => {
              const place = i === 1 ? 1 : i === 0 ? 2 : 3;
              if (!a) return <span key={i} />;
              return (
                <div key={a.agent_id} className="flex flex-col items-center text-center">
                  <span className={cn("grid place-items-center rounded-full font-bold text-white", place === 1 ? "size-12 bg-gradient-to-br from-gold to-[#8a6d12] text-navy-950" : "size-10 bg-navy-800")}>{initials(a.agent_name)}</span>
                  <p className="mt-1 w-full truncate text-xs font-semibold text-navy-900">{a.agent_id === user.id ? "You" : a.agent_name.split(" ")[0]}</p>
                  <div className={cn("mt-1 w-full rounded-t-xl pt-2 pb-3", place === 1 ? "h-20 bg-navy-950 text-gold" : place === 2 ? "h-14 bg-navy-800 text-white" : "h-10 bg-slate-300 text-navy-900")}>
                    <p className="font-display text-lg leading-none font-bold tabular-nums">{num(a.calls)}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <ol className="divide-y divide-line">
            {list.map((a, i) => (
              <li key={a.agent_id} className={cn("flex items-center gap-3 px-5 py-2.5", a.agent_id === user.id && "bg-gold-50/60")}>
                <span className="w-5 text-center text-xs font-bold text-slate-400 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy-900">{a.agent_name}{a.agent_id === user.id && <span className="ml-1 text-xs text-gold">(you)</span>}</p>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-kenya-green" style={{ width: `${(a.calls / max) * 100}%` }} /></span>
                  <p className="mt-0.5 text-xs text-muted">{num(a.answered)} answered · {num(a.verified)} verified</p>
                </div>
                <span className="font-display text-lg font-bold text-navy-900 tabular-nums">{num(a.calls)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
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
  const [logging, setLogging] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const live = ["dialing", "ringing", "in_call"].includes(phone.state);
  const thisCall = phone.party?.voterId === v.id;
  const finished = phone.finished?.party.voterId === v.id ? phone.finished : null;
  const q = QUEUE[queue];

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

  // Where this call is: reserved → calling → connected → wrap-up.
  const stage = thisCall && phone.state === "in_call" ? 2 : thisCall && live ? 1 : finished || outcome ? 3 : 0;
  const STAGES = ["Reserved", "Calling", "Connected", "Wrap-up"];

  return (
    <>
      {logging && <ReportIssueModal onClose={() => setLogging(false)}
        defaults={{ ward_id: v.ward_id, reporter_name: v.full_name, voter_id: v.id, reporter_phone: /^\+254\d{9}$/.test(v.phone) ? v.phone : undefined }} />}
      <Card className="animate-fade-up overflow-hidden">
        {/* Who */}
        <div className="relative overflow-hidden bg-[#06101f] p-5 text-white">
          <div aria-hidden className="pointer-events-none absolute -top-20 -right-10 size-64 rounded-full blur-3xl" style={{ background: `${q.color}40` }} />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="relative grid size-16 shrink-0 place-items-center rounded-2xl bg-white/10 font-display text-2xl font-bold text-gold ring-1 ring-white/10">
              {initials(v.full_name)}
              {thisCall && phone.state === "in_call" && <span className="absolute -right-1 -bottom-1 size-4 animate-pulse rounded-full bg-[#34c77b] ring-2 ring-[#06101f]" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold tracking-[.16em] uppercase" style={{ color: q.color === "#006b3f" ? "#5fd39a" : q.color }}>{q.label} queue</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-2xl font-bold">{v.full_name}</p>
                <StatusBadge status={v.status} />
                <SupportBadge support={v.support} />
              </div>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
                <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{v.ward_name}, {v.constituency_name}</span>
                <span className="inline-flex items-center gap-1"><Vote className="size-3.5" />{v.station_name ?? "No polling station"}</span>
                <span className="font-mono text-xs text-slate-400">{v.reference}</span>
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              {live && thisCall ? (
                <button onClick={() => void phone.hangup()} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-kenya-red px-6 font-semibold shadow-lg shadow-kenya-red/30 hover:brightness-110">
                  <PhoneOff className="size-5" /> End call
                </button>
              ) : (
                <button onClick={callNow} disabled={!["ready", "ended"].includes(phone.state)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1fa463] px-6 font-semibold shadow-lg shadow-[#1fa463]/30 hover:brightness-110 disabled:opacity-50">
                  <Phone className="size-5" /> Call now
                </button>
              )}
              <a href={`tel:${v.phone}`} className="inline-flex items-center justify-center gap-1.5 text-xs text-slate-300 hover:text-white">
                <Smartphone className="size-3.5" /> Use my own phone ({v.phone})
              </a>
            </div>
          </div>
          {/* Progress strip */}
          <ol className="relative mt-5 grid grid-cols-4 gap-2">
            {STAGES.map((s, i) => (
              <li key={s}>
                <span className={cn("block h-1.5 rounded-full transition-colors", i <= stage ? "" : "bg-white/10")} style={i <= stage ? { background: i === stage && stage === 2 ? "#34c77b" : q.color } : undefined} />
                <span className={cn("mt-1.5 flex items-center gap-1 text-xs font-semibold", i === stage ? "text-white" : i < stage ? "text-slate-300" : "text-slate-500")}>
                  {i < stage && <Check className="size-3" />}{s}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {finished && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-slate-50 px-5 py-2.5 text-xs text-slate-700">
            <Clock className="size-3.5 text-slate-400" /> Call lasted <b>{Math.floor(finished.seconds / 60)}m {finished.seconds % 60}s</b>
            {finished.consent === "declined" ? <Badge>Recording declined</Badge> : finished.recording ? <Badge tone="blue">Recording ready to save</Badge> : <Badge>Not recorded</Badge>}
          </div>
        )}

        <div className="grid gap-6 p-5 2xl:grid-cols-[minmax(0,1fr)_270px]">
          <div className="space-y-6">
            <section>
              <StepTitle n={1} title="How did it go?" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {OUTCOMES.map((o) => (
                  <button key={o.id} onClick={() => setOutcome(o.id)} aria-pressed={outcome === o.id}
                    className={cn("flex min-h-14 items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-sm leading-tight font-semibold ring-1 transition",
                      outcome === o.id ? `${o.tone} shadow-md` : "bg-white text-slate-700 ring-line hover:bg-slate-50 hover:ring-slate-300")}>
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", outcome === o.id ? "bg-white/20" : "bg-slate-100 text-slate-500")}><o.icon className="size-4" /></span>
                    {o.label}
                  </button>
                ))}
              </div>
            </section>

            {outcome === "answered" && (
              <section className="animate-fade-up">
                <StepTitle n={2} title="What we learned" />
                <div className="space-y-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-line">
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
                    <label className="flex items-start gap-2 rounded-xl bg-white p-3 text-sm text-navy-900 ring-1 ring-line">
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-kenya-green" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
                      <span>I confirmed their name, ward and polling station, so <b>mark this record verified</b></span>
                    </label>
                  )}
                  <div>
                    <Input label="Main issue raised" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="e.g. water, jobs, roads" maxLength={120} />
                    <button type="button" onClick={() => setLogging(true)} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-ocean hover:underline">
                      <Megaphone className="size-3.5" /> Log it as a Community Voice case so the ward team follows up
                    </button>
                  </div>
                </div>
              </section>
            )}
            {outcome === "call_back" && (
              <section className="animate-fade-up">
                <StepTitle n={2} title="When to call back" />
                <Input type="datetime-local" label="Call back at (Nairobi time)" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="max-w-xs" />
              </section>
            )}
            {outcome === "do_not_call" && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-kenya-red ring-1 ring-red-100">
                <PhoneOff className="size-4" /> This voter will be removed from all calls and messages.
              </p>
            )}
            <section>
              <StepTitle n={outcome === "answered" || outcome === "call_back" ? 3 : 2} title="Notes for the next caller" icon={NotebookPen} />
              <Textarea label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the next caller should know" />
            </section>
          </div>

          <aside>
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-navy-900"><History className="size-4" /> Previous calls</p>
            {claim.history.length ? (
              <ol className="relative space-y-3 border-l-2 border-line pl-4">
                {claim.history.map((h) => (
                  <li key={h.id} className="relative text-xs">
                    <span className={cn("absolute top-1 -left-[21px] size-2.5 rounded-full ring-2 ring-white", h.outcome === "answered" ? "bg-kenya-green" : h.outcome === "do_not_call" ? "bg-kenya-red" : "bg-slate-400")} />
                    <div className="flex items-center justify-between gap-2"><Badge>{h.outcome.replace(/_/g, " ")}</Badge><span className="text-muted">{timeAgo(h.created_at)}</span></div>
                    <p className="mt-1 text-slate-600">{h.agent_name}{h.issue && ` · ${h.issue}`}{h.recording_id && " · recorded"}</p>
                    {h.notes && <p className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-800 ring-1 ring-line">{h.notes}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-xl bg-slate-50 p-3 text-xs text-muted ring-1 ring-line">First contact with this voter.</p>}
            <p className="mt-4 flex items-start gap-1.5 text-xs text-muted"><Clock className="mt-0.5 size-3.5 shrink-0" />Reserved for you until {dateTime(claim.locked_until)} · {num(claim.remaining)} left in queue</p>
          </aside>
        </div>

        {/* Save bar */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white/95 px-5 py-3 backdrop-blur">
          <Button variant="ghost" icon={<SkipForward className="size-4" />} onClick={onSkip} disabled={saving || (live && thisCall)}>Skip this voter</Button>
          <div className="flex items-center gap-3">
            {outcome && <span className="hidden text-xs text-slate-500 sm:inline">Outcome: <b className="text-navy-900">{OUTCOMES.find((o) => o.id === outcome)?.label}</b></span>}
            <Button size="lg" variant="gold" loading={saving} onClick={save}>Save & next voter</Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function StepTitle({ n, title, icon: Icon }: { n: number; title: string; icon?: LucideIcon }) {
  return (
    <p className="mb-2.5 flex items-center gap-2 text-sm font-bold text-navy-900">
      <span className="grid size-6 place-items-center rounded-full bg-navy-950 text-xs font-extrabold text-gold">{n}</span>
      {title}
      {Icon && <Icon className="size-4 text-slate-400" />}
    </p>
  );
}
