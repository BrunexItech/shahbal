"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";

import { Skeleton } from "@/components/loaders";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

type Stats = {
  days: number; campaigns: number; total: number; sent: number; delivered: number; failed: number; queued: number; opted_out: number;
  delivery_rate: number | null; by_channel: Record<string, { total: number; delivered: number; failed: number }>;
  series: { date: string; total: number; delivered: number; failed: number; pending: number }[];
  constituencies: { name: string; total: number; delivered: number; failed: number }[];
};
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00+03:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" });

/** Everything we've sent and what became of it: by day, by channel and by place. */
export function MessagingOverview() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["messaging", "stats", days], queryFn: () => api<Stats>("/messaging/stats", { query: { days } }), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const d = q.data;
  if (!d) return <Skeleton className="mb-6 h-72 rounded-3xl" />;
  const maxPlace = Math.max(1, ...d.constituencies.map((c) => c.total));

  return (
    <section className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-navy-900">Last {days} days · {num(d.campaigns)} campaign{d.campaigns === 1 ? "" : "s"}</p>
        <div role="tablist" aria-label="Window" className="inline-flex rounded-xl bg-white p-1 ring-1 ring-line">
          {[7, 30, 90].map((n) => (
            <button key={n} role="tab" aria-selected={days === n} onClick={() => setDays(n)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", days === n ? "bg-navy-950 text-white" : "text-slate-500")}>{n} days</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([
          ["Messages", num(d.total), "#0b1f3a", null],
          ["Delivered", num(d.delivered), "#006b3f", d.delivery_rate != null ? `${d.delivery_rate}% of all` : null],
          ["Failed", num(d.failed), "#bb1e10", d.total ? `${Math.round((d.failed / d.total) * 100)}%` : null],
          ["Waiting to send", num(d.queued), "#c9a227", "queued or quiet hours"],
          ["Opted out", num(d.opted_out), "#64748b", "never messaged again"],
        ] as const).map(([k, v, c, sub]) => (
          <div key={k} className="relative overflow-hidden rounded-3xl bg-white p-4 ring-1 ring-line">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: c }} />
            <p className="text-xs font-bold tracking-[.12em] text-slate-500 uppercase">{k}</p>
            <p className="mt-1 font-display text-3xl font-extrabold text-navy-900 tabular-nums">{v}</p>
            {sub && <p className="text-xs text-slate-500">{sub}</p>}
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="rounded-3xl bg-white p-5 ring-1 ring-line">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-navy-900">Day by day</p>
            <div className="flex gap-3 text-xs text-slate-600">
              {([["Delivered", "#006b3f"], ["Pending", "#c9a227"], ["Failed", "#bb1e10"]] as const).map(([l, c]) => (
                <span key={l} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: c }} />{l}</span>
              ))}
            </div>
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.series} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip cursor={{ fill: "#0b1f3a", fillOpacity: 0.04 }} labelFormatter={(v) => fmtDay(String(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
                <Bar dataKey="delivered" name="Delivered" stackId="m" fill="#006b3f" />
                <Bar dataKey="pending" name="Pending" stackId="m" fill="#c9a227" />
                <Bar dataKey="failed" name="Failed" stackId="m" fill="#bb1e10" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-line">
          <p className="font-bold text-navy-900">Where messages went</p>
          <ul className="mt-3 space-y-3">
            {d.constituencies.length ? d.constituencies.map((c) => (
              <li key={c.name}>
                <div className="flex justify-between text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold text-navy-900"><span className="size-2.5 rounded-full" style={{ background: CONSTITUENCY_COLORS[c.name] ?? "#94a3b8" }} />{c.name}</span>
                  <span className="text-xs text-slate-500 tabular-nums"><b className="text-sm text-navy-900">{num(c.total)}</b> · {num(c.delivered)} delivered</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(c.total / maxPlace) * 100}%`, background: CONSTITUENCY_COLORS[c.name] ?? "#64748b" }} /></div>
              </li>
            )) : <li className="text-sm text-slate-500">Nothing sent in this window.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-dashed border-line pt-3 text-xs">
            {Object.entries(d.by_channel).map(([ch, v]) => (
              <span key={ch} className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-navy-900">{ch === "sms" ? "SMS" : "WhatsApp"} · {num(v.total)} sent · {num(v.delivered)} delivered</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
