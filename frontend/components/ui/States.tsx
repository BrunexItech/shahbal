import { AlertTriangle, Inbox } from "lucide-react";

import { Button } from "@/components/ui/Button";

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon ?? <Inbox className="size-6" />}</div>
      <p className="mt-4 font-display font-semibold text-navy-900">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-red-50 text-kenya-red"><AlertTriangle className="size-6" /></div>
      <p className="mt-4 font-display font-semibold text-navy-900">Couldn&apos;t load this</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
