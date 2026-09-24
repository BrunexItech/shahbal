"use client";

import { Activity as ActivityIcon } from "lucide-react";

import { Badge, type Tone } from "@/components/ui";
import { useActivity } from "@/features/map/api";
import { timeAgo } from "@/lib/format";

const LABEL: Record<string, [Tone, string]> = {
  CREATE: ["blue", "created"], UPDATE: ["slate", "updated"], VERIFY: ["green", "verified"], REJECT: ["red", "rejected"],
  CALL: ["blue", "called"], CHECKIN: ["gold", "checked in"], COMPLETE: ["green", "completed"], CANCEL: ["slate", "cancelled"],
  APPROVE: ["green", "approved"], MARK_VOTED: ["green", "marked voted"], EXPORT: ["amber", "exported"], REVEAL_ID: ["red", "revealed ID"],
  OPT_OUT: ["red", "opted out"], LOCKOUT: ["red", "locked out"], MFA_ENABLE: ["green", "enabled 2FA"], IMPORT: ["gold", "imported"],
};

/** HQ-only live stream of what the whole team is doing, refreshed every 10s. */
export function ActivityFeed() {
  const { data } = useActivity(true);
  if (!data?.length) return <p className="px-5 py-10 text-center text-sm text-muted">Activity appears here as your team works.</p>;
  return (
    <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
      {data.map((a) => {
        const [tone, verb] = LABEL[a.action] ?? ["slate", a.action.toLowerCase().replace(/_/g, " ")];
        return (
          <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <ActivityIcon className="size-4 shrink-0 text-slate-300" />
            <p className="min-w-0 flex-1 truncate">
              <b className="text-navy-900">{a.actor}</b> <Badge tone={tone}>{verb}</Badge> <span className="text-muted">{a.entity}</span>
            </p>
            <span className="text-[11px] whitespace-nowrap text-muted">{timeAgo(a.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}
