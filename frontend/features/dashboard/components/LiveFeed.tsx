import Link from "next/link";

import { SOURCE_LABEL, StatusBadge } from "@/components/ui";
import { initials, timeAgo } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";

export function LiveFeed({ items }: { items: DashboardSummary["recent"] }) {
  if (!items.length) return <p className="px-5 py-10 text-center text-sm text-muted">No captures yet. The feed updates live as your team works.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((r, i) => (
        <li key={r.id} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
          <Link href={`/voters/${r.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50/70">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-900/5 text-xs font-bold text-navy-800">{initials(r.full_name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-navy-900">{r.full_name}</p>
              <p className="truncate text-xs text-muted">{r.ward} · {SOURCE_LABEL[r.source]} · {timeAgo(r.created_at)}</p>
            </div>
            <StatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
