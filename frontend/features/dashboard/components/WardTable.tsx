"use client";

import { ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import { ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { num, pct } from "@/lib/format";
import type { WardProgress } from "@/lib/types";

type Key = "name" | "achieved" | "gap" | "percent";

/** Sorted by gap by default: the question coordinators ask is "where are we furthest behind?". */
export function WardTable({ wards }: { wards: WardProgress[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "gap", dir: -1 });
  const rows = useMemo(
    () =>
      [...wards].sort((a, b) => {
        const av = a[sort.key] ?? -1;
        const bv = b[sort.key] ?? -1;
        return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
      }),
    [wards, sort],
  );
  const th = (key: Key, label: string, cls = "") => (
    <th className={cn("px-3 py-3", cls)}>
      <button className="inline-flex items-center gap-1 tracking-wider uppercase hover:text-navy-900" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}>
        {label} <ArrowUpDown className={cn("size-3", sort.key === key ? "text-navy-900" : "opacity-40")} />
      </button>
    </th>
  );

  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-line text-left text-xs font-semibold tracking-wider text-muted uppercase">
            {th("name", "Ward", "pl-5")}
            {th("achieved", "Achieved", "text-right")}
            <th className="px-3 py-3 text-right">Target</th>
            {th("gap", "Gap", "text-right")}
            {th("percent", "Progress", "w-[32%] pr-5")}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((w) => (
            <tr key={w.id} className="hover:bg-slate-50/70">
              <td className="py-2.5 pr-3 pl-5">
                <p className="font-semibold text-navy-900">{w.name}</p>
                <p className="text-xs text-muted">{w.constituency}</p>
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{num(w.achieved)}</td>
              <td className="px-3 py-2.5 text-right text-muted tabular-nums">{w.target ? num(w.target) : "—"}</td>
              <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", w.gap > 0 ? "text-kenya-red" : "text-kenya-green")}>{w.target ? num(w.gap) : "—"}</td>
              <td className="py-2.5 pr-5 pl-3">
                <div className="flex items-center gap-3">
                  <ProgressBar percent={w.percent} thin className="flex-1" />
                  <span className="w-11 text-right text-xs font-semibold text-navy-900 tabular-nums">{pct(w.percent)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
