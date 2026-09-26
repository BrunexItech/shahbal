"use client";

import { Lock, Repeat } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { useCreateVisit } from "@/features/visits/api";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";

import { useCreateEvent } from "./api";
import { FAMILY, FIELD_KINDS, HQ_KINDS, kindOf } from "./meta";

export type Draft = { date: string; kind?: string; ward_id?: string };

const at = (date: string, time: string) => `${date}T${time || "00:00"}:00+03:00`; // Mombasa time, all year
const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function defaultHours(date: string): [string, string] {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);
  if (date !== today) return ["10:00", "12:00"];
  const hour = Math.min(21, Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", hour12: false }).format(now)) + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return [`${pad(hour)}:00`, `${pad(Math.min(23, hour + 2))}:00`];
}

/** Add anything to the calendar. Field events become visits (check-in, photos, SMS invite); the rest are HQ entries. */
export function EventDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const user = useUser();
  const tree = useGeoTree();
  const createVisit = useCreateVisit();
  const createEvent = useCreateEvent();
  const [kind, setKind] = useState(draft.kind ?? "rally");
  const field = FIELD_KINDS.includes(kind);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(draft.date);
  const [allDay, setAllDay] = useState(false);
  // Today: start at the next full hour (a visit can't be planned in the past); other days: 10:00–12:00.
  const [from, setFrom] = useState(() => defaultHours(draft.date)[0]);
  const [to, setTo] = useState(() => defaultHours(draft.date)[1]);
  const [wardId, setWardId] = useState(draft.ward_id ?? (user.role === "ward_coordinator" ? user.ward_id ?? "" : ""));
  const [consId, setConsId] = useState(user.role === "coordinator" ? user.constituency_id ?? "" : "");
  const [venue, setVenue] = useState("");
  const [expected, setExpected] = useState("");
  const [announce, setAnnounce] = useState(true);
  const [notes, setNotes] = useState("");
  const [hqOnly, setHqOnly] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [repeat, setRepeat] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const hq = user.role === "super_admin";

  async function save() {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = "Give it a short title";
    if (!date) e.date = "Pick a date";
    if (!allDay && to && from && to <= from) e.to = "Ends before it starts";
    if (field && !wardId) e.ward_id = "Choose the ward";
    if (field && venue.trim().length < 2) e.venue = "Where exactly?";
    if (!field && !hq && !consId && !wardId) e.area = "Choose your constituency or ward";
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setBusy(true);
    try {
      if (field) {
        // Each repeat is its own visit, so each gets its own check-in, photos and invitation.
        for (let i = 0; i <= repeat; i++) {
          const d = addDays(date, 7 * i);
          await createVisit.mutateAsync({
            title: title.trim(), ward_id: wardId, venue: venue.trim(), kind, scheduled_at: at(d, allDay ? "08:00" : from),
            ends_at: allDay ? at(d, "18:00") : to ? at(d, to) : undefined, expected_attendance: expected ? +expected : undefined,
            notes: notes || undefined, announce, announce_hours_before: 24, channel: "sms", public: isPublic,
          });
        }
      } else {
        await createEvent.mutateAsync({
          title: title.trim(), kind, starts_at: at(date, allDay ? "00:00" : from), ends_at: allDay ? at(addDays(date, 1), "00:00") : to ? at(date, to) : undefined,
          all_day: allDay, ward_id: wardId || undefined, constituency_id: wardId ? undefined : consId || undefined, location: venue || undefined,
          notes: notes || undefined, hq_only: hqOnly, repeat_weeks: repeat,
        });
      }
      toast.success(repeat ? `Added, repeating for ${repeat + 1} weeks` : "Added to the calendar");
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const Choice = ({ k }: { k: string }) => {
    const m = kindOf(k);
    const on = kind === k;
    return (
      <button type="button" role="radio" aria-checked={on} onClick={() => setKind(k)}
        className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold ring-1 transition", on ? "text-white" : "text-navy-900 ring-line hover:bg-slate-50")}
        style={on ? { background: FAMILY[m.family].color, boxShadow: "none" } : undefined}>
        <m.icon className="size-4 shrink-0" style={on ? undefined : { color: FAMILY[m.family].color }} />{m.label}
      </button>
    );
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Add to the calendar" subtitle={field ? "A field event: the team on the ground, with check-in, photos and an SMS invite." : "An HQ entry: media, meetings, deadlines and the like."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Add{repeat ? ` ${repeat + 1} dates` : ""}</Button></>}>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">Field event</p>
          <div role="radiogroup" className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">{FIELD_KINDS.map((k) => <Choice key={k} k={k} />)}</div>
          <p className="mt-3 text-xs font-bold tracking-wider text-slate-500 uppercase">HQ entry</p>
          <div role="radiogroup" className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">{HQ_KINDS.map((k) => <Choice key={k} k={k} />)}</div>
        </div>
        <Input label="Title" required value={title} maxLength={140} error={errors.title} onChange={(e) => setTitle(e.target.value)}
          placeholder={field ? "e.g. Kongowea market walk" : "e.g. Radio interview, Baraka FM"} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Date" type="date" required value={date} error={errors.date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Starts" type="time" value={from} disabled={allDay} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Ends" type="time" value={to} disabled={allDay} error={errors.to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-navy-900"><input type="checkbox" className="size-4 accent-kenya-green" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>

        {field ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Ward" required value={wardId} placeholder="Select ward" error={errors.ward_id} onChange={(e) => setWardId(e.target.value)}>
              {tree.data?.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
            </Select>
            <Input label="Venue" required value={venue} maxLength={160} error={errors.venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Tononoka grounds" />
            <Input label="Expected attendance" inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value.replace(/\D/g, ""))} />
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-navy-900">
              <input type="checkbox" className="size-4 accent-kenya-green" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
              SMS supporters in the ward a day before
            </label>
            <label className="flex items-center gap-2 text-sm text-navy-900 sm:col-span-2">
              <input type="checkbox" className="size-4 accent-kenya-green" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Show on the public website (title, venue and time only)
            </label>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Area" value={wardId ? `w:${wardId}` : consId ? `c:${consId}` : ""} error={errors.area}
              placeholder={hq ? "Whole county" : "Choose your area"}
              onChange={(e) => { const v = e.target.value; setWardId(v.startsWith("w:") ? v.slice(2) : ""); setConsId(v.startsWith("c:") ? v.slice(2) : ""); }}>
              {tree.data?.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {(hq || user.role === "coordinator") && <option value={`c:${c.id}`}>All of {c.name}</option>}
                  {c.wards.map((w) => <option key={w.id} value={`w:${w.id}`}>{w.name}</option>)}
                </optgroup>
              ))}
            </Select>
            <Input label="Where" value={venue} maxLength={160} onChange={(e) => setVenue(e.target.value)} placeholder="Studio, office, online…" />
          </div>
        )}
        <Textarea label="Notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm text-navy-900">
            <Repeat className="size-4 text-slate-500" /> Repeat weekly for
            <select aria-label="Repeat weekly" value={repeat} onChange={(e) => setRepeat(+e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2 text-sm">
              <option value={0}>no</option>{[1, 2, 3, 5, 7, 11].map((n) => <option key={n} value={n}>{n + 1} weeks</option>)}
            </select>
          </label>
          {!field && hq && (
            <label className="flex items-center gap-2 text-sm text-navy-900">
              <input type="checkbox" className="size-4 accent-kenya-green" checked={hqOnly} onChange={(e) => setHqOnly(e.target.checked)} />
              <Lock className="size-4 text-slate-500" /> HQ administrators only
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}
