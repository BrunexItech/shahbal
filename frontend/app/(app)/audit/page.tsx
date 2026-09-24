"use client";

import { History } from "lucide-react";
import { useState } from "react";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, type Tone } from "@/components/ui";
import { useAudit } from "@/features/audit/api";
import { dateTime } from "@/lib/format";

const ACTIONS = ["LOGIN", "LOGOUT", "LOCKOUT", "MFA_ENABLE", "MFA_DISABLE", "MFA_FAIL", "PASSWORD_CHANGE", "SESSIONS_REVOKE", "CREATE", "UPDATE",
  "VIEW", "VERIFY", "REJECT", "REOPEN", "REVEAL_ID", "EXPORT", "IMPORT", "APPROVE", "CANCEL", "CALL", "CHECKIN", "COMPLETE",
  "MARK_VOTED", "UNMARK_VOTED", "OPT_OUT", "PORTAL_DUPLICATE"];
const TONE: Record<string, Tone> = {
  REVEAL_ID: "red", REJECT: "red", LOCKOUT: "red", MFA_FAIL: "red", EXPORT: "amber", OPT_OUT: "amber", PORTAL_DUPLICATE: "amber",
  VERIFY: "green", APPROVE: "green", MFA_ENABLE: "green", MARK_VOTED: "green", CREATE: "blue", CALL: "blue", IMPORT: "gold",
};

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useAudit({ action: action || undefined, page });

  return (
    <>
      <PageHeader eyebrow="Compliance" title="Audit trail" subtitle="Every sign-in, view, change, verification and ID reveal. Kept for accountability under the Data Protection Act." />
      <Card className="overflow-hidden">
        <div className="border-b border-line p-4">
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="h-10 rounded-xl border border-line bg-white px-3 text-base">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        {isLoading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.items.length ? (
          <EmptyState icon={<History className="size-6" />} title="No activity recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Time</th><th className="px-3 py-3">Who</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Entity</th><th className="px-3 py-3">Details</th><th className="px-5 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap text-slate-600">{dateTime(a.created_at)}</td>
                    <td className="px-3 py-2.5 font-medium text-navy-900">{a.actor_name ?? <span className="text-muted">Public portal</span>}</td>
                    <td className="px-3 py-2.5"><Badge tone={TONE[a.action] ?? "slate"}>{a.action.replace(/_/g, " ")}</Badge></td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{a.entity}{a.entity_id && <span className="font-mono text-muted"> · {a.entity_id.slice(0, 8)}</span>}</td>
                    <td className="max-w-72 truncate px-3 py-2.5 font-mono text-xs text-muted">{a.meta ? JSON.stringify(a.meta) : "—"}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-muted">{a.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
