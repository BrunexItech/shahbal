"use client";

import { BellRing, CalendarPlus, CheckCircle2, MapPin, Navigation, Route, Users, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Segmented, Select, Textarea, type Tone, useConfirm } from "@/components/ui";
import { useGeoTree, useStations } from "@/features/geo/api";
import { CampaignStatusBadge } from "@/features/messaging/components";
import { useCancelVisit, useCheckin, useCompleteVisit, useCreateVisit, useVisits } from "@/features/visits/api";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { can } from "@/lib/roles";
import type { Visit, VisitStatus } from "@/lib/types";

const STATUS: Record<VisitStatus, [Tone, string]> = {
  scheduled: ["blue", "Scheduled"],
  in_progress: ["gold", "In progress"],
  completed: ["green", "Completed"],
  cancelled: ["slate", "Cancelled"],
};

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", ...o }).format(new Date(iso));
const dayKey = (iso: string) => fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit" });

export default function VisitsPage() {
  const user = useUser();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { data, isLoading, error, refetch } = useVisits();
  const [planning, setPlanning] = useState(false);
  const [completing, setCompleting] = useState<Visit | null>(null);

  const groups = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    const list = (data ?? []).filter((v) => {
      const future = dayKey(v.scheduled_at) >= today && v.status !== "completed" && v.status !== "cancelled";
      return tab === "upcoming" ? future || v.status === "in_progress" : !future && v.status !== "in_progress";
    });
    if (tab === "past") list.reverse();
    const out = new Map<string, Visit[]>();
    for (const v of list) {
      const k = dayKey(v.scheduled_at) === today ? "Today" : fmt(v.scheduled_at, { weekday: "long", day: "numeric", month: "long" });
      out.set(k, [...(out.get(k) ?? []), v]);
    }
    return [...out.entries()];
  }, [data, tab]);

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Campaign visits"
        subtitle="Plan where the team goes. Voters in the ward get an SMS before the team arrives, and completed visits light up the coverage map."
        actions={can.planVisits(user.role) && <Button icon={<CalendarPlus className="size-4" />} onClick={() => setPlanning(true)}>Plan a visit</Button>} />

      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit">
        {(["upcoming", "past"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("flex-1 rounded-lg px-5 py-2 text-sm font-semibold capitalize transition sm:flex-none", tab === t ? "bg-white text-navy-900 shadow-sm" : "text-muted")}>{t}</button>
        ))}
      </div>

      {isLoading ? <Card><SkeletonRows rows={4} /></Card> : error ? <Card><ErrorState error={error} onRetry={refetch} /></Card> : !groups.length ? (
        <Card><EmptyState icon={<Route className="size-6" />} title={tab === "upcoming" ? "No visits planned" : "No past visits yet"}
          body="Plan a visit and the ward is notified automatically." /></Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, visits]) => (
            <section key={day}>
              <h2 className={cn("mb-2 text-sm font-bold", day === "Today" ? "text-kenya-green" : "text-navy-900")}>{day}</h2>
              <div className="space-y-3">
                {visits.map((v) => <VisitCard key={v.id} visit={v} onComplete={() => setCompleting(v)} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {planning && <PlanVisitModal onClose={() => setPlanning(false)} />}
      {completing && <CompleteModal visit={completing} onClose={() => setCompleting(null)} />}
    </>
  );
}

function VisitCard({ visit: v, onComplete }: { visit: Visit; onComplete: () => void }) {
  const user = useUser();
  const checkin = useCheckin();
  const cancel = useCancelVisit();
  const confirm = useConfirm();
  const [locating, setLocating] = useState(false);

  function start() {
    const send = (lat?: number, lng?: number) =>
      checkin.mutate({ id: v.id, latitude: lat, longitude: lng }, {
        onSuccess: () => toast.success("Checked in. The visit is live on the map."),
        onError: (e) => toast.error(e.message),
        onSettled: () => setLocating(false),
      });
    setLocating(true);
    if (!navigator.geolocation) return send();
    navigator.geolocation.getCurrentPosition((p) => send(+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6)), () => send(), { enableHighAccuracy: true, timeout: 10_000 });
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-navy-950 py-3 text-white">
        <span className="font-display text-xl font-bold">{fmt(v.scheduled_at, { hour: "numeric", minute: "2-digit", hour12: false })}</span>
        <span className="text-[10px] tracking-wider text-gold uppercase">{fmt(v.scheduled_at, { weekday: "short" })}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-navy-900">{v.title}</p>
          <Badge tone={STATUS[v.status][0]} dot>{STATUS[v.status][1]}</Badge>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{v.venue} · {v.ward_name}, {v.constituency_name}</span>
          {v.attendance != null && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{num(v.attendance)} attended</span>}
        </p>
        {v.announcement_campaign_id && (
          <Link href={`/messaging/${v.announcement_campaign_id}`} className="mt-2 inline-flex items-center gap-1.5 text-xs text-ocean hover:underline">
            <BellRing className="size-3.5" /> Ward notice
            {v.announcement_status && <CampaignStatusBadge status={v.announcement_status} />}
            {v.announcement_recipients != null && <span className="text-muted">· {num(v.announcement_recipients)} voters</span>}
          </Link>
        )}
        {v.outcome && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-line">{v.outcome}</p>}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {v.status === "scheduled" && can.runVisits(user.role) && (
          <Button size="sm" variant="navy" loading={locating || checkin.isPending} icon={<Navigation className="size-3.5" />} onClick={start}>Check in</Button>
        )}
        {(v.status === "scheduled" || v.status === "in_progress") && can.runVisits(user.role) && (
          <Button size="sm" icon={<CheckCircle2 className="size-3.5" />} onClick={onComplete}>Complete</Button>
        )}
        {v.status === "scheduled" && can.planVisits(user.role) && (
          <Button size="sm" variant="ghost" icon={<XCircle className="size-3.5" />} loading={cancel.isPending}
            onClick={async () => {
              if (await confirm({ title: "Cancel this visit?", body: "If the ward notice hasn't gone out yet, it will be cancelled too.", confirmLabel: "Cancel visit" }))
                cancel.mutate(v.id, { onSuccess: () => toast.success("Visit cancelled"), onError: (e) => toast.error(e.message) });
            }}>Cancel</Button>
        )}
      </div>
    </Card>
  );
}

function PlanVisitModal({ onClose }: { onClose: () => void }) {
  const { data: tree } = useGeoTree();
  const create = useCreateVisit();
  const [f, setF] = useState({ title: "", constituency: "", ward_id: "", station_id: "", venue: "", date: "", time: "15:00", notes: "", announce: true, hours: "24", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const stations = useStations(f.ward_id || undefined, undefined, !!f.ward_id);
  const wards = tree?.find((c) => c.id === f.constituency)?.wards ?? [];
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const notifyAt = f.date && f.time
    ? new Date(new Date(`${f.date}T${f.time}:00+03:00`).getTime() - Number(f.hours) * 3_600_000)
    : null;

  function submit() {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = "Required";
    if (!f.ward_id) e.ward_id = "Choose a ward";
    if (f.venue.trim().length < 2) e.venue = "Where will the team be?";
    if (!f.date) e.date = "Pick a date";
    setErrors(e);
    if (Object.keys(e).length) return;
    create.mutate({
      title: f.title.trim(), ward_id: f.ward_id, station_id: f.station_id || null, venue: f.venue.trim(),
      scheduled_at: `${f.date}T${f.time}:00+03:00`, notes: f.notes || undefined, announce: f.announce,
      announce_hours_before: Number(f.hours), channel: "sms", message: f.message.trim() || undefined,
    }, {
      onSuccess: (v) => {
        toast.success(v.announcement_campaign_id ? "Visit planned and ward notice scheduled" : "Visit planned");
        onClose();
      },
      onError: (err) => { if (err instanceof ApiError) setErrors(err.fields); toast.error(err.message); },
    });
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Plan a campaign visit" subtitle="Voters registered in the ward receive an SMS before the team arrives."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={submit}>Plan visit</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Title" required className="sm:col-span-2" value={f.title} error={errors.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Likoni town hall" />
        <Select label="Constituency" required placeholder="Select" value={f.constituency} onChange={(e) => setF((x) => ({ ...x, constituency: e.target.value, ward_id: "", station_id: "" }))}>
          {tree?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label="Ward" required placeholder={f.constituency ? "Select" : "Choose constituency first"} disabled={!f.constituency} value={f.ward_id} error={errors.ward_id}
          onChange={(e) => setF((x) => ({ ...x, ward_id: e.target.value, station_id: "" }))}>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Input label="Venue" required value={f.venue} error={errors.venue} onChange={(e) => set("venue", e.target.value)} placeholder="e.g. Likoni Social Hall" />
        <Select label="Nearest polling station" placeholder={stations.data?.length ? "Optional: pins it on the map" : "None loaded"} disabled={!stations.data?.length}
          value={f.station_id} onChange={(e) => set("station_id", e.target.value)}>
          {stations.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input type="date" label="Date" required value={f.date} error={errors.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set("date", e.target.value)} />
        <Input type="time" label="Start time (Nairobi)" required value={f.time} onChange={(e) => set("time", e.target.value)} />
        <Textarea label="Internal notes" className="sm:col-span-2" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Logistics, speakers, security…" />

        <div className="space-y-3 rounded-2xl bg-ocean-50 p-4 ring-1 ring-ocean/15 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
            <input type="checkbox" className="size-4 accent-kenya-green" checked={f.announce} onChange={(e) => set("announce", e.target.checked)} />
            Notify voters in this ward by SMS
          </label>
          {f.announce && (
            <>
              <Segmented<string> value={f.hours} onChange={(v) => set("hours", v)} options={[{ value: "6", label: "6 h before" }, { value: "24", label: "1 day before" }, { value: "48", label: "2 days before" }]} />
              <Textarea label="Custom message (optional)" rows={2} value={f.message} onChange={(e) => set("message", e.target.value)}
                placeholder="Habari {first_name}! Our campaign team will be at {venue} in {ward} on {date} from {time}. Karibu sana!"
                hint="Use {first_name}, {ward}, {venue}, {date}, {time}. Leave blank for the standard notice." />
              {notifyAt && (
                <p className="text-xs text-navy-900">
                  Notice goes out <b>{notifyAt < new Date() ? "as soon as it's approved" : fmt(notifyAt.toISOString(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b>
                  {notifyAt >= new Date() && " (after HQ approval if you're not an admin)"}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CompleteModal({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const complete = useCompleteVisit();
  const [attendance, setAttendance] = useState("");
  const [outcome, setOutcome] = useState("");
  return (
    <Modal open onClose={onClose} size="sm" title="Complete visit" subtitle={`${visit.title} · ${visit.venue}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={complete.isPending} onClick={() => complete.mutate({ id: visit.id, attendance: attendance ? Number(attendance) : undefined, outcome: outcome.trim() || undefined }, {
          onSuccess: () => { toast.success("Visit completed. The ward is now marked visited."); onClose(); }, onError: (e) => toast.error(e.message) })}>Mark complete</Button></>}>
      <div className="space-y-4">
        <Input label="Estimated attendance" inputMode="numeric" value={attendance} onChange={(e) => setAttendance(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 350" />
        <Textarea label="How did it go?" rows={4} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Key issues raised, follow-ups, mood on the ground…" />
      </div>
    </Modal>
  );
}
