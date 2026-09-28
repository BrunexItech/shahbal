"use client";

import { AlertTriangle, Bot, Camera, ExternalLink, MapPin, MessageSquareText, Phone, Send, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Badge, Button, Modal, Select, Textarea } from "@/components/ui";
import { PhotoImg } from "@/features/visits/photos";
import { cn } from "@/lib/cn";
import { dateTime, timeAgo } from "@/lib/format";

import { issueAssist, useAiStatus } from "@/features/ai/api";

import { useAssignees, useIssue, useIssuePhoto, useSmsResident, useUpdateIssue } from "./api";
import { CATEGORIES, CATEGORY, type IssuePriority, type IssueStatus, PRIORITY, SOURCE, STATUS, STATUS_FLOW } from "./meta";

/** One case: what was reported, what's been done, and (for coordinators) the controls to move it on. */
export function IssueCase({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: d, isLoading } = useIssue(id);
  const update = useUpdateIssue(id);
  const addPhoto = useIssuePhoto(id);
  const people = useAssignees(id, !!d?.can_manage);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setNote(""); setShare(false); }, [id]);

  const run = (body: Parameters<typeof update.mutate>[0], ok: string) => {
    const before = new Set(d?.updates.map((u) => u.id));
    update.mutate(body, {
      onSuccess: (after) => {
        setNote(""); setShare(false);
        // Say plainly whether the resident's SMS went, and why not when it didn't.
        const sms = after.updates.find((u) => !before.has(u.id) && (u.kind === "sms" || u.kind === "sms_failed"));
        if (sms?.kind === "sms_failed") toast.warning(`${ok}. The SMS to the resident didn't go through.`, { description: sms.note?.split(" not sent: ")[1] ?? undefined, duration: 10000 });
        else if (sms) toast.success(`${ok}. The resident was sent an SMS.`);
        else toast.success(ok);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const Icon = d ? CATEGORY[d.category].icon : MapPin;
  const at = d ? STATUS_FLOW.indexOf(d.status) : -1;
  const next: IssueStatus | null = d && at >= 0 && at < STATUS_FLOW.length - 1 ? STATUS_FLOW[at + 1] : null;

  return (
    <Modal open onClose={onClose} size="lg" title={d ? `${d.reference} · ${CATEGORY[d.category].en}` : "Case"} subtitle={d ? `${d.ward}, ${d.constituency}${d.area ? ` · ${d.area}` : ""}` : undefined}>
      {isLoading || !d ? <div className="grid h-48 place-items-center"><Spinner /></div> : (
        <div className="space-y-6">
          {/* Where it stands */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[d.status].tone} dot>{STATUS[d.status].en}</Badge>
            {d.priority !== "normal" && <Badge tone={PRIORITY[d.priority].tone}>{PRIORITY[d.priority].label} priority</Badge>}
            <Badge tone="slate">{SOURCE[d.source]}{d.reported_by ? ` · ${d.reported_by}` : ""}</Badge>
            <span className="text-xs text-slate-500">Reported {timeAgo(d.created_at)}</span>
          </div>
          {d.status !== "closed" && (
            <ol className="grid grid-cols-4 gap-1">
              {STATUS_FLOW.map((s, i) => (
                <li key={s}>
                  <span className={cn("block h-1.5 rounded-full", i > at && "bg-slate-200")} style={i <= at ? { background: STATUS[d.status].color } : undefined} />
                  <span className={cn("mt-1.5 block text-xs font-semibold", i === at ? "text-navy-900" : "text-slate-400")}>{STATUS[s].en}</span>
                </li>
              ))}
            </ol>
          )}

          {/* What was reported */}
          <section className="flex gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-950 text-gold"><Icon className="size-5" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-navy-900">{d.summary}</p>
              {d.description.trim() !== d.summary.trim() && <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{d.description}</p>}
              {d.latitude != null && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${d.latitude},${d.longitude}`} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ocean hover:underline"><MapPin className="size-4" /> Open the exact spot <ExternalLink className="size-3.5" /></a>
              )}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-line">
              <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">Resident</p>
              {d.reporter_name || d.reporter_phone ? (
                <div className="mt-1.5 space-y-1 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-navy-900"><UserRound className="size-4 text-slate-400" />{d.reporter_name ?? "Name not given"}</p>
                  {d.reporter_phone && (d.reporter_phone.startsWith("+") ? (
                    <a href={`tel:${d.reporter_phone}`} className="flex items-center gap-2 font-semibold text-ocean hover:underline"><Phone className="size-4" />{d.reporter_phone}</a>
                  ) : <p className="flex items-center gap-2 text-slate-600"><Phone className="size-4 text-slate-400" />{d.reporter_phone}</p>)}
                  <p className="text-xs text-slate-500">{d.contact_ok ? "Gets SMS updates on this case" : "Didn't ask for SMS updates. They can follow the case on the tracking page."}</p>
                  {d.can_manage && d.reporter_phone && d.contact_ok && <SmsResident id={d.id} reference={d.reference} live={d.sms_live !== false} />}
                </div>
              ) : <p className="mt-1.5 text-sm text-slate-600">Reported anonymously.</p>}
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-line">
              <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">Handled by</p>
              {d.can_manage ? (
                <Select label="Assigned to" value={d.assigned_to_id ?? ""} placeholder="Nobody yet" disabled={update.isPending}
                  onChange={(e) => e.target.value ? run({ assigned_to_id: e.target.value }, "Case assigned") : run({ unassign: true }, "Unassigned")}>
                  {people.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </Select>
              ) : <p className="mt-1.5 text-sm font-semibold text-navy-900">{d.assigned_to ?? "Not assigned yet"}</p>}
            </div>
          </div>

          {/* Photos */}
          {(d.photo_list.length > 0 || d.status !== "closed") && (
            <section>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">Photos</p>
                {d.photo_list.length < 6 && (
                  <button onClick={() => fileRef.current?.click()} disabled={addPhoto.isPending}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ocean hover:underline disabled:opacity-50">
                    {addPhoto.isPending ? <Spinner size="sm" /> : <Camera className="size-4" />} Add photo
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addPhoto.mutate(f, { onSuccess: () => toast.success("Photo added"), onError: (err) => toast.error(err.message) });
                  e.target.value = "";
                }} />
              </div>
              {d.photo_list.length ? (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {d.photo_list.map((p) => (
                    <figure key={p.id} className="overflow-hidden rounded-xl ring-1 ring-line">
                      <PhotoImg url={p.url} alt={`Photo on ${d.reference}`} className="aspect-square w-full" />
                      <figcaption className="px-2 py-1 text-xs text-slate-500">{p.by_resident ? "Resident" : "Team"}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : <p className="mt-1 text-sm text-slate-500">No photos yet.</p>}
            </section>
          )}

          {/* Coordinator controls */}
          {d.can_manage && (
            <section className="space-y-3 rounded-2xl p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-navy-900">Move the case on</p>
                <AiAssist id={d.id} onReply={(text) => { setNote(text); setShare(true); }}
                  onTopic={(topic) => run({ category: topic as typeof d.category }, "Topic updated")}
                  onUrgent={() => run({ priority: "urgent" }, "Marked urgent")} current={{ category: d.category, priority: d.priority }} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Priority" value={d.priority} disabled={update.isPending} onChange={(e) => run({ priority: e.target.value as IssuePriority }, "Priority updated")}>
                  {(Object.keys(PRIORITY) as IssuePriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
                </Select>
                <Select label="Category" value={d.category} disabled={update.isPending} onChange={(e) => run({ category: e.target.value as typeof d.category }, "Category updated")}>
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.en}</option>)}
                </Select>
              </div>
              <Textarea label="Update or note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="What was done, who was contacted, what happens next…" />
              <label className="flex items-center gap-2 text-sm text-navy-900">
                <input type="checkbox" className="size-4 accent-kenya-green" checked={share} onChange={(e) => setShare(e.target.checked)} />
                Share this with the resident
              </label>
              <p className="-mt-1 pl-6 text-xs text-slate-500">
                {d.contact_ok && d.sms_live === false
                  ? "SMS isn't switched on for this server yet, so shared updates only appear on their tracking page."
                  : d.contact_ok
                  ? "Shared updates go to them by SMS and appear on their tracking page. Moving the case on also texts them."
                  : "They didn't ask for SMS, so shared updates appear only on their tracking page (reference " + d.reference + ")."}
              </p>
              <div className="flex flex-wrap gap-2">
                {next && <Button size="sm" loading={update.isPending} onClick={() => run({ status: next, note: note || undefined, public: share }, `Marked ${STATUS[next].en.toLowerCase()}`)}>
                  Mark {STATUS[next].en.toLowerCase()}</Button>}
                {note.trim().length > 1 && <Button size="sm" variant="secondary" disabled={update.isPending} icon={<MessageSquareText className="size-4" />}
                  onClick={() => run({ note, public: share }, "Note added")}>Add note only</Button>}
                {d.status !== "closed" && d.status !== "resolved" && (
                  <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => run({ status: "closed", note: note || undefined }, "Case closed")}>Close (duplicate or not actionable)</Button>
                )}
                {(d.status === "resolved" || d.status === "closed") && (
                  <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => run({ status: "in_progress", note: note || "Reopened" }, "Case reopened")}>Reopen</Button>
                )}
              </div>
            </section>
          )}

          {/* Timeline */}
          <section>
            <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">History</p>
            <ol className="mt-2 space-y-3 border-l-2 border-line pl-4">
              {d.updates.slice().reverse().map((u) => (
                <li key={u.id} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-white" style={{ background: u.status ? STATUS[u.status].color : "#94a3b8" }} />
                  <p className="text-navy-900">
                    <b>{u.kind === "status" && u.status ? STATUS[u.status].en : u.kind === "created" ? "Reported" : u.kind === "sms" ? <>SMS <SmsBadge status={u.sms_status} /></> : u.kind === "sms_failed" ? <span className="text-kenya-red">SMS not sent</span> : u.kind === "note" ? "Note" : "Updated"}</b>
                    {u.note && <span className="text-slate-700"> · {u.note}</span>}
                    {u.public && u.kind !== "created" && <Badge tone="blue" className="ml-2">Shared with resident</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{u.author ?? (u.kind === "created" ? "Resident" : "System")} · {dateTime(u.created_at)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Optional help: topic, urgency, likely duplicates and a draft reply. Nothing changes until you apply it. */
function AiAssist({ id, current, onReply, onTopic, onUrgent }: {
  id: string; current: { category: string; priority: string }; onReply: (t: string) => void; onTopic: (t: string) => void; onUrgent: () => void;
}) {
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Awaited<ReturnType<typeof issueAssist>> | null>(null);
  if (!status.data?.enabled) return null;
  if (!r) {
    return (
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { setR(await issueAssist(id)); } catch (e) { toast.error(e instanceof Error ? e.message : "The assistant couldn't help"); } finally { setBusy(false); }
      }} className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-900 disabled:opacity-60">
        {busy ? <Spinner size="sm" /> : <Bot className="size-3.5 text-gold" />} Help from AI
      </button>
    );
  }
  const topic = r.topic ? CATEGORY[r.topic as keyof typeof CATEGORY] : null;
  return (
    <div className="w-full space-y-2 rounded-xl bg-navy-950/[.03] p-3 text-sm ring-1 ring-line">
      <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase"><Bot className="size-3.5" /> Suggestions (check before applying)</p>
      {topic && topic.id !== current.category && (
        <p className="flex flex-wrap items-center justify-between gap-2"><span>Topic looks like <b>{topic.en}</b></span><button type="button" onClick={() => onTopic(topic.id)} className="text-xs font-semibold text-ocean hover:underline">Apply</button></p>
      )}
      {r.urgent && current.priority !== "urgent" && (
        <p className="flex flex-wrap items-center justify-between gap-2 text-kenya-red"><span>Looks urgent: {r.why}</span><button type="button" onClick={onUrgent} className="text-xs font-semibold text-ocean hover:underline">Mark urgent</button></p>
      )}
      {r.duplicates.length > 0 && <p>Possibly the same problem as <b>{r.duplicates.join(", ")}</b>.</p>}
      {r.reply && (
        <div className="rounded-lg bg-white p-2.5 ring-1 ring-line">
          <p className="text-slate-700">{r.reply}</p>
          <button type="button" onClick={() => onReply(r.reply)} className="mt-1 text-xs font-semibold text-ocean hover:underline">Use as the update to the resident</button>
        </div>
      )}
      {!topic && !r.urgent && !r.duplicates.length && !r.reply && <p className="text-slate-500">No suggestions for this case.</p>}
    </div>
  );
}

const SMS_BADGE = {
  sent: { label: "Sent · awaiting delivery report", tone: "amber" },
  delivered: { label: "Delivered", tone: "green" },
  failed: { label: "Not delivered", tone: "red" },
} as const;

function SmsBadge({ status }: { status?: "sent" | "delivered" | "failed" | null }) {
  const b = SMS_BADGE[status ?? "sent"];
  return <Badge tone={b.tone} className="ml-1">{b.label}</Badge>;
}

/** Text the resident directly. Says plainly when this server can't send SMS, and what happened after sending. */
function SmsResident({ id, reference, live }: { id: string; reference: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = useSmsResident(id);
  const prefix = `Team Shahbal: about your report ${reference}: `;
  const parts = Math.max(1, Math.ceil((prefix.length + text.length + 40) / 153));
  if (!live) {
    return (
      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-navy-900 ring-1 ring-amber-200">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
        SMS isn&apos;t switched on for this server yet, so nothing can be texted. HQ: set SMS_PROVIDER=mobilesasa in backend/.env.
      </p>
    );
  }
  if (!open) return <Button size="sm" variant="secondary" className="mt-2" icon={<Send className="size-4" />} onClick={() => setOpen(true)}>Send SMS</Button>;
  return (
    <div className="mt-2 space-y-2">
      <Textarea label="Message to the resident" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)}
        hint={`Starts with “Team Shahbal: about your report ${reference}:”. ${text.length}/300 · about ${parts} SMS`} />
      <div className="flex gap-2">
        <Button size="sm" icon={<Send className="size-4" />} loading={send.isPending} disabled={text.trim().length < 3}
          onClick={() => send.mutate(text.trim(), {
            onSuccess: (d) => {
              const last = d.updates[d.updates.length - 1];
              if (last?.kind === "sms") toast.success(last.sms_status === "delivered" ? "SMS delivered" : "SMS sent. Its delivery shows in the history.");
              else toast.error(last?.note?.split(" not sent: ")[1] ?? "The SMS didn't go out");
              setText(""); setOpen(false);
            },
            onError: (e) => toast.error(e.message),
          })}>Send SMS</Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
      </div>
    </div>
  );
}
