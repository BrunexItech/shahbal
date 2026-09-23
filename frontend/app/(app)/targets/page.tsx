"use client";

import { Check, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/loaders";
import { Button, Card, CardHeader, ErrorState, PageHeader, ProgressBar } from "@/components/ui";
import { useDashboard } from "@/features/dashboard/api";
import { useUpdateWard } from "@/features/geo/api";
import { useUser } from "@/lib/auth";
import { num, pct } from "@/lib/format";
import { can } from "@/lib/roles";
import type { WardProgress } from "@/lib/types";

export default function TargetsPage() {
  const user = useUser();
  const { data, isLoading, error, refetch } = useDashboard();
  const editable = can.setTargets(user.role);

  return (
    <>
      <PageHeader eyebrow="Planning" title="Ward targets"
        subtitle="Set how many supporters each ward must reach. Achieved = captured records that aren't rejected; gap = target − achieved." />
      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
      ) : error || !data ? (
        <Card><ErrorState error={error} onRetry={refetch} /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data.constituencies.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              <CardHeader title={c.name}
                subtitle={<span className="tabular-nums">{num(c.achieved)} of {c.target ? num(c.target) : "—"} · {pct(c.percent)} · gap {num(c.gap)}</span>}
                action={<ProgressBar percent={c.percent} className="mt-2 w-28" />} />
              <ul className="divide-y divide-line">
                {data.wards.filter((w) => w.constituency_id === c.id).map((w) => <WardRow key={w.id} ward={w} editable={editable} />)}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function WardRow({ ward, editable }: { ward: WardProgress; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(String(ward.target || ""));
  const [reg, setReg] = useState(ward.registered_voters?.toString() ?? "");
  const update = useUpdateWard();

  function save() {
    update.mutate(
      { id: ward.id, target: +target || 0, registered_voters: reg ? +reg : null },
      { onSuccess: () => { toast.success(`${ward.name} updated`); setEditing(false); }, onError: (e) => toast.error(e.message) },
    );
  }

  return (
    <li className="px-5 py-3">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-semibold text-navy-900">{ward.name}</p>
            <p className="text-xs text-muted tabular-nums">{num(ward.achieved)} / {ward.target ? num(ward.target) : "—"} · <b className="text-navy-900">{pct(ward.percent)}</b></p>
          </div>
          <ProgressBar percent={ward.percent} thin className="mt-2" />
        </div>
        {editable && !editing && (
          <button onClick={() => setEditing(true)} className="rounded-lg p-2 text-muted hover:bg-slate-100 hover:text-navy-900" aria-label={`Edit ${ward.name} target`}>
            <Pencil className="size-4" />
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 flex animate-fade-up flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
          <label className="text-xs font-semibold text-navy-900">Target
            <input autoFocus inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))}
              className="mt-1 block h-9 w-28 rounded-lg border border-line bg-white px-2.5 text-sm focus:border-ocean focus:outline-none" />
          </label>
          <label className="text-xs font-semibold text-navy-900">Registered voters (IEBC)
            <input inputMode="numeric" value={reg} onChange={(e) => setReg(e.target.value.replace(/\D/g, ""))}
              className="mt-1 block h-9 w-36 rounded-lg border border-line bg-white px-2.5 text-sm focus:border-ocean focus:outline-none" />
          </label>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" loading={update.isPending} onClick={save} icon={<Check className="size-3.5" />}>Save</Button>
          </div>
        </div>
      )}
    </li>
  );
}
