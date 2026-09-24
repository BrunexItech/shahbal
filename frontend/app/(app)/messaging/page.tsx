"use client";

import { MessageSquarePlus, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { useCampaigns } from "@/features/messaging/api";
import { CampaignStatusBadge } from "@/features/messaging/components";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateTime, num } from "@/lib/format";
import { can } from "@/lib/roles";

const KIND_LABEL = { broadcast: "Broadcast", visit: "Visit notice", gotv: "Get out the vote" } as const;

export default function MessagingPage() {
  const user = useUser();
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "approval">("all");
  const { data, isLoading, error, refetch } = useCampaigns(tab === "approval" ? "pending_approval" : undefined);
  const approvals = useCampaigns("pending_approval");
  const pending = approvals.data?.length ?? 0;

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Messaging"
        subtitle="Targeted SMS & WhatsApp to the right wards and voters. Opted-out voters are always excluded and nothing sends between 9 pm and 8 am."
        actions={<Link href="/messaging/new"><Button icon={<MessageSquarePlus className="size-4" />}>New message</Button></Link>} />
      <Card className="overflow-hidden">
        <div className="flex gap-1 border-b border-line px-4 pt-3">
          {([["all", "All campaigns"], ["approval", "Awaiting approval"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("relative -mb-px rounded-t-lg px-4 py-2.5 text-sm font-semibold transition",
                tab === k ? "border-b-2 border-navy-900 text-navy-900" : "text-muted hover:text-navy-900")}>
              {label}
              {k === "approval" && pending > 0 && <Badge tone="amber" className="ml-2">{pending}</Badge>}
            </button>
          ))}
        </div>
        {isLoading ? <SkeletonRows rows={5} /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.length ? (
          <EmptyState icon={<MessageSquareText className="size-6" />}
            title={tab === "approval" ? "Nothing waiting for approval" : "No messages yet"}
            body={tab === "approval" ? "Messages from coordinators appear here for HQ sign-off." : "Compose your first targeted message to supporters."}
            action={tab === "all" && <Link href="/messaging/new"><Button>New message</Button></Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Campaign</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Recipients</th>
                  <th className="px-3 py-3 text-right">Delivered</th><th className="px-3 py-3">Send time</th><th className="px-5 py-3">Created by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => router.push(`/messaging/${c.id}`)}>
                    <td className="max-w-md px-5 py-3">
                      <p className="font-semibold text-navy-900">{c.name}</p>
                      <p className="truncate text-xs text-muted">{KIND_LABEL[c.kind]} · {c.channel.toUpperCase()} · {c.body}</p>
                    </td>
                    <td className="px-3 py-3"><CampaignStatusBadge status={c.status} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.recipients ? num(c.recipients) : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {c.recipients ? <>{num(c.delivered)} <span className="text-xs text-muted">({Math.round((c.delivered / c.recipients) * 100)}%)</span></> : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-600">{dateTime(c.scheduled_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{c.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {!can.approveMessages(user.role) && (
        <p className="mt-4 text-xs text-muted">Messages you create are reviewed by HQ before they go out.</p>
      )}
    </>
  );
}
