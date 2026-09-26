"use client";

import { Check, Lock, MapPin, Repeat, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge, Button, Modal } from "@/components/ui";
import { useConfirm } from "@/components/ui/Confirm";
import { num } from "@/lib/format";

import { useDeleteEvent, useUpdateEvent } from "./api";
import { type Entry, FAMILY, kindOf } from "./meta";

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", ...opts });
export const when = (e: Entry) => {
  const day = fmt(e.starts_at, { weekday: "long", day: "numeric", month: "long" });
  if (e.all_day) return `${day} · all day`;
  const t = (iso: string) => fmt(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${t(e.starts_at)}${e.ends_at ? `–${t(e.ends_at)}` : ""}`;
};

export function EntryDetails({ entry: e, onClose }: { entry: Entry; onClose: () => void }) {
  const m = kindOf(e.kind);
  const fam = FAMILY[m.family];
  const update = useUpdateEvent();
  const remove = useDeleteEvent();
  const confirm = useConfirm();

  const setStatus = (status: string) => update.mutate({ id: e.id, status }, {
    onSuccess: () => { toast.success(status === "done" ? "Marked done" : "Cancelled"); onClose(); }, onError: (err) => toast.error(err.message) });
  async function del(series: boolean) {
    const ok = await confirm({ title: series ? "Delete this and later repeats?" : "Delete this entry?", body: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    remove.mutate({ id: e.id, series }, { onSuccess: (r) => { toast.success(`Deleted ${r.deleted} ${r.deleted === 1 ? "entry" : "entries"}`); onClose(); }, onError: (err) => toast.error(err.message) });
  }

  return (
    <Modal open onClose={onClose} title={e.title} subtitle={when(e)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ background: fam.color }}>
            <m.icon className="size-3.5" />{m.label}
          </span>
          {e.status && e.status !== "planned" && e.status !== "scheduled" && <Badge tone={e.status === "cancelled" ? "slate" : "green"}>{e.status.replace("_", " ")}</Badge>}
          {e.hq_only && <Badge tone="navy"><Lock className="size-3" /> HQ only</Badge>}
          {e.series_id && <Badge tone="slate"><Repeat className="size-3" /> Repeats weekly</Badge>}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {(e.ward || e.constituency || e.source === "event") && (
            <div><dt className="text-xs text-slate-500">Area</dt><dd className="font-semibold text-navy-900">{e.ward ? `${e.ward}${e.constituency ? `, ${e.constituency}` : ""}` : e.constituency ?? "Whole county"}</dd></div>
          )}
          {e.location && <div><dt className="text-xs text-slate-500">Where</dt><dd className="flex items-center gap-1.5 font-semibold text-navy-900"><MapPin className="size-4 text-slate-400" />{e.location}</dd></div>}
          {e.lead && <div><dt className="text-xs text-slate-500">Led by</dt><dd className="font-semibold text-navy-900">{e.lead}</dd></div>}
          {(e.expected_attendance != null || e.attendance != null) && (
            <div><dt className="text-xs text-slate-500">Attendance</dt><dd className="flex items-center gap-1.5 font-semibold text-navy-900"><Users className="size-4 text-slate-400" />
              {e.attendance != null ? `${num(e.attendance)} came` : "—"}{e.expected_attendance != null ? ` · ${num(e.expected_attendance)} expected` : ""}</dd></div>
          )}
          {e.target != null && <div><dt className="text-xs text-slate-500">{e.source === "sms" ? "Recipients" : "Target"}</dt><dd className="font-semibold text-navy-900">{num(e.target)}</dd></div>}
        </dl>
        {e.notes && <p className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-line text-slate-700 ring-1 ring-line">{e.notes}</p>}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {e.source === "visit" && <Link href="/visits" className="inline-flex h-9 items-center rounded-xl bg-navy-950 px-3 text-sm font-semibold text-white">Open in Campaign Visits</Link>}
          {e.source === "sms" && <Link href="/messaging" className="inline-flex h-9 items-center rounded-xl bg-navy-950 px-3 text-sm font-semibold text-white">Open in Messaging</Link>}
          {e.source === "plan" && <Link href="/plan" className="inline-flex h-9 items-center rounded-xl bg-navy-950 px-3 text-sm font-semibold text-white">Open the Campaign Plan</Link>}
          {e.source === "event" && e.can_edit && (
            <>
              {e.status === "planned" && <Button size="sm" icon={<Check className="size-4" />} loading={update.isPending} onClick={() => setStatus("done")}>Mark done</Button>}
              {e.status === "planned" && <Button size="sm" variant="secondary" icon={<X className="size-4" />} disabled={update.isPending} onClick={() => setStatus("cancelled")}>Cancel it</Button>}
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} disabled={remove.isPending} onClick={() => del(false)}>Delete</Button>
              {e.series_id && <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => del(true)}>Delete this and later repeats</Button>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
