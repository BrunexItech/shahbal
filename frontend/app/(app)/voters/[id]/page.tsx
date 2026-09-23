"use client";

import { ArrowLeft, Eye, MapPin, Phone, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, ErrorState, SOURCE_LABEL, StatusBadge, SUPPORT, SupportBadge } from "@/components/ui";
import { revealNationalId, useUpdateVoter, useVoter } from "@/features/voters/api";
import { VerifyActions } from "@/features/voters/components/VerifyActions";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateTime, initials } from "@/lib/format";
import { can } from "@/lib/roles";
import type { Support } from "@/lib/types";

export default function VoterProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const { data: v, isLoading, error, refetch } = useVoter(id);
  const update = useUpdateVoter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  if (isLoading) return <ProfileSkeleton />;
  if (error || !v) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;

  async function reveal() {
    setRevealing(true);
    try {
      setRevealed((await revealNationalId(id)).national_id);
      toast.message("ID revealed — this access has been logged");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not allowed");
    } finally {
      setRevealing(false);
    }
  }

  const setSupport = (support: Support) =>
    update.mutate({ id, support }, { onSuccess: () => toast.success("Support level updated"), onError: (e) => toast.error(e.message) });

  const rows: [string, React.ReactNode][] = [
    ["Reference", <span key="r" className="font-mono">{v.reference}</span>],
    ["Phone", v.phone],
    ["National ID", (
      <span key="n" className="inline-flex items-center gap-2 font-mono">
        {revealed ?? v.national_id_masked}
        {can.revealId(user.role) && !revealed && (
          <Button size="sm" variant="ghost" loading={revealing} onClick={reveal} icon={<Eye className="size-3.5" />}>Reveal</Button>
        )}
      </span>
    )],
    ["Voter card no.", v.voter_card_no ?? "—"],
    ["Gender", <span key="g" className="capitalize">{v.gender ?? "—"}</span>],
    ["Year of birth", v.birth_year ?? "—"],
    ["Constituency", v.constituency_name],
    ["Ward", v.ward_name],
    ["Polling station", v.station_name ?? "—"],
    ["Source", SOURCE_LABEL[v.source]],
  ];

  return (
    <div className="space-y-6">
      <Link href="/voters" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-navy-900">
        <ArrowLeft className="size-4" /> Back to registry
      </Link>

      <Card className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-navy-950 via-navy-900 to-ocean" />
        <div className="relative flex flex-col gap-5 px-6 pt-12 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className="grid size-24 place-items-center rounded-3xl bg-white font-display text-3xl font-bold text-navy-900 shadow-xl ring-4 ring-white">
              {initials(v.full_name)}
            </span>
            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-navy-900">{v.full_name}</h1>
                <StatusBadge status={v.status} />
                {v.opted_out && <Badge tone="red">Opted out</Badge>}
              </div>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{v.ward_name}, {v.constituency_name}</span>
                <span className="inline-flex items-center gap-1"><Phone className="size-3.5" />{v.phone}</span>
              </p>
            </div>
          </div>
          {can.verify(user.role) && <VerifyActions voter={v} />}
        </div>
        {v.status === "rejected" && v.rejection_reason && (
          <div className="mx-6 mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-kenya-red ring-1 ring-red-100">
            <b>Rejected:</b> {v.rejection_reason}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Voter details" subtitle="The national ID is masked. Only HQ admins can reveal it, and every reveal is audited." />
          <dl className="divide-y divide-line">
            {rows.map(([k, val]) => (
              <div key={k} className="grid grid-cols-[150px_1fr] items-center gap-3 px-5 py-3 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium text-navy-900">{val}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Support level" subtitle="Update after each conversation." />
            <div className="flex flex-wrap gap-2 p-5">
              {(Object.keys(SUPPORT) as Support[]).map((s) => (
                <button key={s} disabled={!can.edit(user.role) || update.isPending} onClick={() => setSupport(s)}
                  className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition disabled:cursor-not-allowed",
                    v.support === s ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-slate-600 ring-line enabled:hover:ring-slate-300")}>
                  {SUPPORT[s][1]}
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Record history" />
            <ol className="space-y-4 p-5">
              <TimelineItem icon={<UserRound className="size-3.5" />} title={`Captured via ${SOURCE_LABEL[v.source].toLowerCase()}`}
                meta={`${v.captured_by_name ?? "Self-registered"} · ${dateTime(v.created_at)}`} />
              <TimelineItem icon={<ShieldCheck className="size-3.5" />} title="Consent recorded" meta={dateTime(v.consent_at)} />
              {v.verified_at && (
                <TimelineItem icon={<ShieldCheck className="size-3.5" />} tone={v.status === "rejected" ? "red" : "green"}
                  title={v.status === "rejected" ? "Rejected" : v.status === "verified" ? "Verified" : "Re-opened"}
                  meta={`${v.verified_by_name ?? "—"} · ${dateTime(v.verified_at)}`} />
              )}
            </ol>
            {v.notes && <p className="mx-5 mb-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-line">{v.notes}</p>}
          </Card>
          <div className="flex items-center gap-2 text-xs text-muted"><SupportBadge support={v.support} /> current classification</div>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ icon, title, meta, tone = "navy" }: { icon: React.ReactNode; title: string; meta: string; tone?: "navy" | "green" | "red" }) {
  const c = { navy: "bg-navy-900", green: "bg-kenya-green", red: "bg-kenya-red" }[tone];
  return (
    <li className="flex gap-3">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-white ${c}`}>{icon}</span>
      <div>
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        <p className="text-xs text-muted">{meta}</p>
      </div>
    </li>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-32" />
      <Card className="p-6"><div className="flex items-end gap-4"><Skeleton className="size-24 rounded-3xl" /><div className="space-y-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-40" /></div></div></Card>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="space-y-4 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</Card>
        <Card className="space-y-4 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</Card>
      </div>
    </div>
  );
}
