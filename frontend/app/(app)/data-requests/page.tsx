"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, timeAgo } from "@/lib/format";

type Holding = { reference: string; name: string; ward: string; polling_centre: string | null; status: string; support: string; source: string; no_contact: boolean };
type Report = { reference: string; topic: string; summary: string; status: string; name_given: string | null };
type Req = { id: string; phone: string; kind: "access" | "correct" | "erase" | "stop"; status: "open" | "done" | "rejected"; details: string | null; note: string | null;
  created_at: string; handled_at: string | null; records: Holding[]; reports: Report[] };

const KIND: Record<Req["kind"], [string, Tone]> = {
  access: ["Copy of their data", "blue"], correct: ["Correction", "amber"], erase: ["Erasure", "red"], stop: ["Stop contact", "slate"],
};
const DUE_DAYS = 7;

export default function DataRequestsPage() {
  const [status, setStatus] = useState("open");
  const [active, setActive] = useState<Req | null>(null);
  const list = useQuery({ queryKey: ["data-requests", status], queryFn: () => api<Req[]>("/data-requests", { query: { status } }) });
  return (
    <>
      <PageHeader eyebrow="Setup" title="Data requests"
        subtitle={`Requests people make from the Privacy page under the Data Protection Act. Answer each within ${DUE_DAYS} days; every action is recorded in the audit trail.`} />
      <div className="mb-4 flex flex-wrap gap-2">
        {[["open", "Open"], ["done", "Completed"], ["rejected", "Declined"], ["all", "All"]].map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1", status === k ? "bg-navy-950 text-white ring-navy-950" : "text-navy-900 ring-line hover:bg-slate-50")}>{l}</button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {list.isLoading ? <SkeletonRows rows={4} /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data?.length ? (
          <EmptyState icon={<ShieldCheck className="size-6" />} title={status === "open" ? "No open requests" : "Nothing here"} body="Verified requests from the public Privacy page appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((r) => {
              const overdue = r.status === "open" && Date.now() - new Date(r.created_at).getTime() > DUE_DAYS * 864e5;
              return (
                <li key={r.id}>
                  <button onClick={() => setActive(r)} className="flex w-full flex-col gap-1 px-5 py-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                        <Badge tone={KIND[r.kind][1]}>{KIND[r.kind][0]}</Badge>{r.phone === "erased" ? "Number erased" : r.phone}
                        {overdue && <Badge tone="red">Overdue</Badge>}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-slate-600">{r.details || `${r.records.length} record(s), ${r.reports.length} report(s) held`}</p>
                    </div>
                    <p className="text-xs text-slate-500">{r.status === "open" ? `Received ${timeAgo(r.created_at)}` : `Closed ${dateTime(r.handled_at)}`}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {active && <Resolve req={active} onClose={() => setActive(null)} />}
    </>
  );
}

function Resolve({ req, onClose }: { req: Req; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const open = req.status === "open";
  const go = useMutation({
    mutationFn: (b: { outcome: "done" | "rejected"; erase?: boolean }) => api<{ erased_records: number }>(`/data-requests/${req.id}/resolve`, { body: { ...b, note } }),
    onSuccess: (r, b) => {
      qc.invalidateQueries({ queryKey: ["data-requests"] });
      toast.success(b.erase ? `Erased ${r.erased_records} record(s). The person has been told by SMS.` : "Request closed. The person has been told by SMS.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const noteOk = note.trim().length >= 3;
  return (
    <Modal open onClose={onClose} size="lg" title={KIND[req.kind][0]} subtitle={`${req.phone} · received ${dateTime(req.created_at)}`}
      footer={open ? (
        <>
          <Button variant="ghost" loading={go.isPending && go.variables?.outcome === "rejected"} disabled={!noteOk} onClick={() => go.mutate({ outcome: "rejected" })}>Decline</Button>
          {req.kind === "erase"
            ? <Button variant="danger" loading={go.isPending && !!go.variables?.erase} disabled={!noteOk} onClick={() => go.mutate({ outcome: "done", erase: true })}>Erase and complete</Button>
            : <Button loading={go.isPending && go.variables?.outcome === "done"} disabled={!noteOk} onClick={() => go.mutate({ outcome: "done" })}>Mark completed</Button>}
        </>
      ) : <Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        {req.details && <div><p className="text-xs font-bold tracking-wider text-slate-500 uppercase">What they asked</p><p className="mt-1 text-sm whitespace-pre-line text-slate-700">{req.details}</p></div>}
        <div>
          <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">What we hold for this number</p>
          {!req.records.length && !req.reports.length && <p className="mt-1 text-sm text-slate-500">No records or reports.</p>}
          <ul className="mt-2 space-y-2">
            {req.records.map((v) => (
              <li key={v.reference} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <p className="font-semibold text-navy-900">{v.name} <span className="font-normal text-slate-500">· {v.reference}</span></p>
                <p className="text-xs text-slate-500">{v.ward}{v.polling_centre ? `, ${v.polling_centre}` : ""} · {v.status} · {v.source}{v.no_contact ? " · no contact" : ""}</p>
              </li>
            ))}
            {req.reports.map((i) => (
              <li key={i.reference} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <p className="font-semibold text-navy-900">Report {i.reference} <span className="font-normal text-slate-500">· {i.topic}</span></p>
                <p className="truncate text-xs text-slate-500">{i.summary}</p>
              </li>
            ))}
          </ul>
        </div>
        {req.kind === "access" && open && <p className="rounded-xl bg-ocean-50 px-3 py-2 text-sm text-navy-900">Send them a copy of the records above (for example by SMS or email), then mark completed.</p>}
        {req.kind === "correct" && open && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-navy-900">Open the record in the Voter Registry, make the correction, then mark completed.</p>}
        {req.kind === "erase" && open && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-navy-900">Erasing deletes the voter records above with their messages, call logs and recordings, and removes the name and number from their reports. This cannot be undone.</p>}
        {open ? (
          <Textarea label="Reply to the person" required rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            hint="Sent to them by SMS and kept with the request." />
        ) : req.note && <div><p className="text-xs font-bold tracking-wider text-slate-500 uppercase">Our reply</p><p className="mt-1 text-sm text-slate-700">{req.note}</p></div>}
      </div>
    </Modal>
  );
}
