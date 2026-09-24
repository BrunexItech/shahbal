"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SkeletonRows } from "@/components/loaders";
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SOURCE_LABEL, StatusBadge, SupportBadge } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { useVoters, type VoterFilters } from "@/features/voters/api";
import { VoterFiltersBar } from "@/features/voters/components/VoterFiltersBar";
import { useUser } from "@/lib/auth";
import { dateTime, initials, num } from "@/lib/format";
import { can } from "@/lib/roles";

export default function VotersPage() {
  const user = useUser();
  const router = useRouter();
  const [filters, setFilters] = useState<VoterFilters>({ page: 1, size: 25 });
  const { data, isLoading, isFetching, error, refetch } = useVoters(filters);
  const { data: tree } = useGeoTree();

  // Deep link from the coverage map: /voters?ward=<id>
  useEffect(() => {
    const ward = new URLSearchParams(window.location.search).get("ward");
    if (ward) setFilters((f) => ({ ...f, ward_id: ward, page: 1 }));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Voters"
        title="Voter registry"
        subtitle={data ? `${num(data.total)} records in your area` : "Search and manage captured voters"}
        actions={can.capture(user.role) && (
          <Link href="/voters/new"><Button icon={<UserPlus className="size-4" />}>Capture voter</Button></Link>
        )}
      />
      <Card className="overflow-hidden">
        <VoterFiltersBar value={filters} onChange={setFilters} tree={tree} />
        {isLoading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data?.items.length ? (
          <EmptyState title="No voters found" body="Try adjusting your filters, or capture the first voter in this area." />
        ) : (
          <div className={`overflow-x-auto transition-opacity ${isFetching ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Voter</th>
                  <th className="px-3 py-3">National ID</th>
                  <th className="px-3 py-3">Ward / station</th>
                  <th className="px-3 py-3">Support</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Captured</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((v) => (
                  <tr key={v.id} onClick={() => router.push(`/voters/${v.id}`)} className="cursor-pointer transition hover:bg-slate-50/80">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-900/5 text-xs font-bold text-navy-800">{initials(v.full_name)}</span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-navy-900">{v.full_name}</p>
                          <p className="text-xs text-muted">{v.reference} · {v.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{v.national_id_masked}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-navy-900">{v.ward_name}</p>
                      <p className="max-w-52 truncate text-xs text-muted">{v.station_name ?? "No station"}</p>
                    </td>
                    <td className="px-3 py-3"><SupportBadge support={v.support} /></td>
                    <td className="px-3 py-3 text-xs text-slate-600">{SOURCE_LABEL[v.source]}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-600">{dateTime(v.created_at)}</td>
                    <td className="px-5 py-3"><StatusBadge status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pagination page={data.page} size={data.size} total={data.total} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        )}
      </Card>
    </>
  );
}
