import { ChevronLeft, ChevronRight } from "lucide-react";

import { num } from "@/lib/format";

export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
      <span>
        {num(from)}–{num(Math.min(page * size, total))} of {num(total)}
      </span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 font-medium text-navy-900">{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-40" aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
