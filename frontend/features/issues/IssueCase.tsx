"use client";

import { Camera, ExternalLink, MapPin, MessageSquareText, Phone, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Badge, Button, Modal, Select, Textarea } from "@/components/ui";
import { PhotoImg } from "@/features/visits/photos";
import { cn } from "@/lib/cn";
import { dateTime, timeAgo } from "@/lib/format";

import { useAssignees, useIssue, useIssuePhoto, useUpdateIssue } from "./api";
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

  const run = (body: Parameters<typeof update.mutate>[0], ok: string) =>
    update.mutate(body, { onSuccess: () => { toast.success(ok); setNote(""); setShare(false); }, onError: (e) => toast.error(e.message) });

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
                  <p className="text-xs text-slate-500">{d.contact_ok ? "Gets SMS updates on this case" : "Didn't ask for updates"}</p>
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
              <p className="text-sm font-bold text-navy-900">Move the case on</p>
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
                Share this with the resident{d.contact_ok ? " (they'll get it by SMS)" : ""}
              </label>
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
                    <b>{u.kind === "status" && u.status ? STATUS[u.status].en : u.kind === "created" ? "Reported" : u.kind === "sms" ? "SMS sent" : u.kind === "note" ? "Note" : "Updated"}</b>
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
