"use client";

import { ClipboardCheck, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SkeletonRows } from "@/components/loaders";
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SOURCE_LABEL, SupportBadge } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { useVoters, type VoterFilters } from "@/features/voters/api";
import { VerifyActions } from "@/features/voters/components/VerifyActions";
import { VoterFiltersBar } from "@/features/voters/components/VoterFiltersBar";
import { initials, num, timeAgo } from "@/lib/format";

export default function VerificationPage() {
  const [filters, setFilters] = useState<VoterFilters>({ page: 1, size: 20, status: "pending" });
  const { data, isLoading, error, refetch } = useVoters(filters);
  const { data: tree } = useGeoTree();

  return (
    <>
      <PageHeader eyebrow="Quality control" title="Verification queue"
        subtitle={data ? `${num(data.total)} records waiting. Call the voter, confirm their details, then verify or reject.` : "Confirm captured details"} />
      <Card className="overflow-hidden">
        <VoterFiltersBar value={filters} onChange={(f) => setFilters({ ...f, status: "pending" })} tree={tree} hideStatus />
        {isLoading ? <SkeletonRows rows={6} /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data?.items.length ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title="Queue is clear" body="Every captured record in your area has been reviewed. 🎉" />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((v) => (
              <li key={v.id} className="flex flex-col gap-3 px-5 py-4 transition hover:bg-slate-50/60 md:flex-row md:items-center md:justify-between">
                <Link href={`/voters/${v.id}`} className="flex min-w-0 items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-sm font-bold text-amber-700 ring-1 ring-amber-200">{initials(v.full_name)}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-navy-900">{v.full_name} <span className="font-normal text-muted">· {v.reference}</span></p>
                    <p className="truncate text-xs text-muted">
                      {v.ward_name} · {v.station_name ?? "no station"} · {SOURCE_LABEL[v.source]} · {timeAgo(v.created_at)}
                    </p>
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <SupportBadge support={v.support} />
                  <a href={`tel:${v.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-ocean ring-1 ring-ocean/20 hover:bg-ocean-50">
                    <Phone className="size-3.5" /> {v.phone}
                  </a>
                  <VerifyActions voter={v} compact />
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 0 && <Pagination page={data.page} size={data.size} total={data.total} onPage={(page) => setFilters((f) => ({ ...f, page }))} />}
      </Card>
    </>
  );
}
