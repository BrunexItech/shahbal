"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandHeart, Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";

type Vol = { id: string; full_name: string; phone: string; email: string | null; ward: string; constituency: string; skills: string[]; availability: string | null;
  message: string | null; status: "new" | "contacted" | "onboarded" | "declined"; note: string | null; created_at: string };
const SKILL: Record<string, string> = { canvassing: "Door to door", events: "Events", polling_agent: "Polling agent", call_centre: "Calls", social_media: "Social media",
  driving: "Driving", logistics: "Logistics", it: "IT & data" };
const STATUS: Record<Vol["status"], { label: string; tone: "red" | "amber" | "green" | "slate" }> = {
  new: { label: "New", tone: "red" }, contacted: { label: "Contacted", tone: "amber" }, onboarded: { label: "On the team", tone: "green" }, declined: { label: "Not now", tone: "slate" },
};

export default function VolunteersPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const list = useQuery({ queryKey: ["volunteers", status], queryFn: () => api<{ counts: Record<string, number>; items: Vol[] }>("/site-admin/volunteers", { query: { status: status || undefined } }), refetchInterval: 60_000 });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: Vol["status"]; note?: string }) => api(`/site-admin/volunteers/${id}`, { method: "PATCH", body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["volunteers"] }); toast.success("Updated"); },
    onError: (e) => toast.error(e.message),
  });
  const counts = list.data?.counts ?? {};
  return (
    <>
      <PageHeader eyebrow="Outreach" title="Volunteers" subtitle="People who offered to help through the website. Call them within a few days, then invite the committed ones as field agents from Team." />
      <div className="mb-4 flex flex-wrap gap-2">
        {([["", "All"], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])] as [string, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1", status === k ? "bg-navy-950 text-white ring-navy-950" : "text-navy-900 ring-line hover:bg-slate-50")}>
            {l}{k && counts[k] ? ` · ${counts[k]}` : ""}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {list.isLoading ? <SkeletonRows rows={5} /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data?.items.length ? (
          <EmptyState icon={<HandHeart className="size-6" />} title="No volunteers here yet" body="Share the website's Volunteer page: the sign-ups land here, by ward." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((v) => (
              <li key={v.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">{v.full_name}<Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge></p>
                  <p className="text-xs text-slate-500">{v.ward}, {v.constituency} · signed up {timeAgo(v.created_at)}{v.availability ? ` · ${v.availability}` : ""}</p>
                  {v.skills.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1">{v.skills.map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{SKILL[s] ?? s}</span>)}</p>}
                  {v.message && <p className="mt-1.5 text-sm text-slate-600">“{v.message}”</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`tel:${v.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ocean ring-1 ring-line hover:bg-ocean-50"><Phone className="size-4" />{v.phone}</a>
                  <select aria-label={`Status for ${v.full_name}`} value={v.status} disabled={update.isPending} onChange={(e) => update.mutate({ id: v.id, status: e.target.value as Vol["status"] })}
                    className="h-9 rounded-lg border border-line bg-white px-2 text-base sm:text-sm">
                    {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
