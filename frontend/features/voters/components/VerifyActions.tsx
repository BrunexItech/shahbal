"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Modal, Textarea } from "@/components/ui";
import { useReject, useReopen, useVerify } from "@/features/voters/api";
import type { Voter } from "@/lib/types";

const QUICK_REASONS = ["Phone unreachable", "Wrong ward / station", "Duplicate person", "Details could not be confirmed"];

export function VerifyActions({ voter, compact }: { voter: Voter; compact?: boolean }) {
  const verify = useVerify();
  const reject = useReject();
  const reopen = useReopen();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const size = compact ? "sm" : "md";

  const onErr = (e: Error) => toast.error(e.message);

  if (voter.status !== "pending") {
    return (
      <Button variant="secondary" size={size} loading={reopen.isPending} icon={<RotateCcw className="size-4" />}
        onClick={() => reopen.mutate(voter.id, { onSuccess: () => toast.success("Moved back to pending"), onError: onErr })}>
        Re-open
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      <Button size={size} loading={verify.isPending} icon={<Check className="size-4" />}
        onClick={() => verify.mutate(voter.id, { onSuccess: () => toast.success(`${voter.full_name} verified`), onError: onErr })}>
        Verify
      </Button>
      <Button size={size} variant="danger-soft" icon={<X className="size-4" />} onClick={() => setOpen(true)}>Reject</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="sm" title="Reject record" subtitle={`${voter.full_name} · ${voter.reference}`}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={reject.isPending} disabled={reason.trim().length < 3}
            onClick={() => reject.mutate({ id: voter.id, reason: reason.trim() }, {
              onSuccess: () => { toast.success("Record rejected"); setOpen(false); setReason(""); },
              onError: onErr,
            })}>Reject record</Button>
        </>}>
        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">{r}</button>
          ))}
        </div>
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why can't this record be verified?" />
      </Modal>
    </div>
  );
}
