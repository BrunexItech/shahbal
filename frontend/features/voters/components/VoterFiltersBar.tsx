"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { SOURCE_LABEL, SUPPORT } from "@/components/ui";
import type { VoterFilters } from "@/features/voters/api";
import type { Constituency, Source, Support } from "@/lib/types";

const pill = "h-10 rounded-xl border border-line bg-white px-3 text-sm text-navy-900 focus:border-ocean focus:outline-none focus:ring-4 focus:ring-ocean/10";

export function VoterFiltersBar({ value, onChange, tree, hideStatus }: {
  value: VoterFilters;
  onChange: (f: VoterFilters) => void;
  tree?: Constituency[];
  hideStatus?: boolean;
}) {
  const [q, setQ] = useState(value.q ?? "");
  // Debounce free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => q !== (value.q ?? "") && onChange({ ...value, q, page: 1 }), 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const wards = tree?.find((c) => c.id === value.constituency_id)?.wards ?? tree?.flatMap((c) => c.wards) ?? [];
  const patch = (p: Partial<VoterFilters>) => onChange({ ...value, ...p, page: 1 });

  return (
    <div className="flex flex-wrap gap-2 border-b border-line p-4">
      <div className="relative min-w-60 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, reference, national ID, phone or voter card"
          className={`${pill} w-full pl-9`} />
      </div>
      {tree && tree.length > 1 && (
        <select className={pill} value={value.constituency_id ?? ""} onChange={(e) => patch({ constituency_id: e.target.value, ward_id: "" })}>
          <option value="">All constituencies</option>
          {tree.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {wards.length > 1 && (
        <select className={pill} value={value.ward_id ?? ""} onChange={(e) => patch({ ward_id: e.target.value })}>
          <option value="">All wards</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
      {!hideStatus && (
        <select className={pill} value={value.status ?? ""} onChange={(e) => patch({ status: e.target.value as VoterFilters["status"] })}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
      )}
      <select className={pill} value={value.support ?? ""} onChange={(e) => patch({ support: e.target.value as Support })}>
        <option value="">All support levels</option>
        {(Object.keys(SUPPORT) as Support[]).map((s) => <option key={s} value={s}>{SUPPORT[s][1]}</option>)}
      </select>
      <select className={pill} value={value.source ?? ""} onChange={(e) => patch({ source: e.target.value as Source })}>
        <option value="">All sources</option>
        {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
      </select>
    </div>
  );
}
