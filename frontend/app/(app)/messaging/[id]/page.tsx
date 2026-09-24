"use client";

import { ArrowLeft, Ban, Check, X } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";

import { Skeleton, SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, ErrorState, Modal, Pagination, ProgressBar, Textarea, useConfirm } from "@/components/ui";
import { useCampaign, useCampaignMessages, useCancelCampaign, useReviewCampaign } from "@/features/messaging/api";
import { CampaignStatusBadge, PhonePreview } from "@/features/messaging/components";
import { StatTile } from "@/features/dashboard/components/StatTile";
import { useUser } from "@/lib/auth";
import { CAMPAIGN_NAME } from "@/lib/config";
import { dateTime, num } from "@/lib/format";
import { can } from "@/lib/roles";

const MSG_TONE = { queued: "slate", sent: "blue", delivered: "green", failed: "red" } as const;

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const { data: c, isLoading, error, refetch } = useCampaign(id);
  const [page, setPage] = useState(1);
  const msgs = useCampaignMessages(id, page, c?.status);
  const review = useReviewCampaign();
  const cancel = useCancelCampaign();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const confirm = useConfirm();

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 rounded-2xl" /></div>;
  if (error || !c) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;

  const pctDelivered = c.recipients ? (c.delivered / c.recipients) * 100 : null;
  const cancellable = ["pending_approval", "scheduled", "sending"].includes(c.status);
  const a = c.audience;

  return (
    <div className="space-y-6">
      <Link href="/messaging" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-navy-900"><ArrowLeft className="size-4" /> All messages</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-navy-900">{c.name}</h1>
            <CampaignStatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {c.channel.toUpperCase()} · created by {c.created_by_name} · {c.status === "scheduled" ? "sends" : "scheduled"} {dateTime(c.scheduled_at)}
            {c.reviewed_by_name && c.status !== "pending_approval" && ` · reviewed by ${c.reviewed_by_name}`}
          </p>
        </div>
        <div className="flex gap-2">
          {c.status === "pending_approval" && can.approveMessages(user.role) && (
            <>
              <Button icon={<Check className="size-4" />} loading={review.isPending && !rejecting}
                onClick={() => review.mutate({ id, approve: true }, { onSuccess: () => toast.success("Approved"), onError: (e) => toast.error(e.message) })}>Approve</Button>
              <Button variant="danger-soft" icon={<X className="size-4" />} onClick={() => setRejecting(true)}>Reject</Button>
            </>
          )}
          {cancellable && (
            <Button variant="secondary" icon={<Ban className="size-4" />} loading={cancel.isPending}
              onClick={async () => {
                if (await confirm({ title: "Cancel this message?", body: "Anything not yet sent will not go out. This can't be undone.", confirmLabel: "Cancel message" }))
                  cancel.mutate(id, { onSuccess: () => toast.success("Cancelled"), onError: (e) => toast.error(e.message) });
              }}>Cancel</Button>
          )}
        </div>
      </div>

      {c.review_note && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-line"><b>Review note:</b> {c.review_note}</p>}

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Recipients" value={c.recipients ? num(c.recipients) : "—"} icon={<span className="text-xs font-bold">#</span>}
          sub={c.status === "pending_approval" || c.status === "scheduled" ? "Counted when sending starts" : undefined} />
        <StatTile label="Sent" value={num(c.sent)} accent="ocean" icon={<span className="text-xs font-bold">↑</span>} />
        <StatTile label="Delivered" value={num(c.delivered)} accent="green" icon={<Check className="size-4" />}
          sub={<ProgressBar percent={pctDelivered} thin className="mt-1" />} />
        <StatTile label="Failed" value={num(c.failed)} accent="red" icon={<X className="size-4" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader title="Delivery log" subtitle="Per-voter status from the gateway" />
          {msgs.isLoading ? <SkeletonRows rows={5} cols={4} /> : !msgs.data?.items.length ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              {c.status === "pending_approval" ? "Waiting for HQ approval." : c.status === "scheduled" ? "Recipients are locked in when sending starts." : "No messages."}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line bg-slate-50/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                    <th className="px-5 py-2.5">Voter</th><th className="px-3 py-2.5">Phone</th><th className="px-3 py-2.5">Status</th><th className="px-5 py-2.5">Sent</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {msgs.data.items.map((m) => (
                      <tr key={m.id}>
                        <td className="px-5 py-2.5"><Link href={`/voters/${m.voter_id}`} className="font-medium text-navy-900 hover:underline">{m.voter_name}</Link></td>
                        <td className="px-3 py-2.5 font-mono text-xs">{m.phone}</td>
                        <td className="px-3 py-2.5"><Badge tone={MSG_TONE[m.status]}>{m.status}</Badge>{m.error && <span className="ml-2 text-xs text-kenya-red">{m.error}</span>}</td>
                        <td className="px-5 py-2.5 text-xs text-slate-600">{dateTime(m.sent_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={msgs.data.page} size={msgs.data.size} total={msgs.data.total} onPage={setPage} />
            </>
          )}
        </Card>
        <div className="space-y-4">
          <PhonePreview text={c.body} channel={c.channel} sender={CAMPAIGN_NAME} />
          <Card className="p-4 text-xs text-slate-700">
            <p className="mb-2 font-semibold text-navy-900">Audience</p>
            <ul className="space-y-1">
              <li>Wards: {a.ward_ids?.length ? `${a.ward_ids.length} selected` : a.constituency_ids?.length ? `${a.constituency_ids.length} constituencies` : "whole area"}</li>
              <li>Support: {a.support?.length ? a.support.join(", ") : "all"}</li>
              <li>Status: {a.statuses?.length ? a.statuses.join(", ") : "all"}</li>
              {a.voted === false && <li>Only voters not yet marked as voted</li>}
            </ul>
          </Card>
        </div>
      </div>

      <Modal open={rejecting} onClose={() => setRejecting(false)} size="sm" title="Reject message" subtitle="The coordinator will see your note."
        footer={<>
          <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          <Button variant="danger" loading={review.isPending} onClick={() => review.mutate({ id, approve: false, note: note.trim() || undefined }, {
            onSuccess: () => { toast.success("Rejected"); setRejecting(false); }, onError: (e) => toast.error(e.message) })}>Reject</Button>
        </>}>
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to change?" />
      </Modal>
    </div>
  );
}
