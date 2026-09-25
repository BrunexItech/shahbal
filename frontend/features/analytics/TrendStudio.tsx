"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Skeleton } from "@/components/loaders";
import { Card } from "@/components/ui";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

type Point = { date: string; captured: number; verified: number; supporters: number; cumulative: number };
type Trends = {
  days: number; series: Point[]; total: number; previous: number; avg: number; best: Point | null; start_total: number;
  constituencies: { name: string; series: number[]; total: number }[];
};
type Metric = "captured" | "verified" | "supporters" | "cumulative";

const METRICS: { id: Metric; label: string; color: string }[] = [
  { id: "captured", label: "Captured", color: "#006b3f" },
  { id: "verified", label: "Verified", color: "#0b7fa6" },
  { id: "supporters", label: "Supporters", color: "#c9a227" },
  { id: "cumulative", label: "Running total", color: "#0b1f3a" },
];
const fmtDay = (iso: string, long = false) =>
  new Date(`${iso}T12:00:00+03:00`).toLocaleDateString("en-KE", long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });

/**
 * Trends: pick a window and a measure. The area is the day-by-day figure; the dashed line
 * is its 7-day average (the real direction, without weekday noise). Below, every
 * constituency's own pattern on the same dates.
 */
export function TrendStudio({ target }: { target: number }) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>("captured");
  const q = useQuery({ queryKey: ["dashboard", "trends", days], queryFn: () => api<Trends>("/dashboard/trends", { query: { days } }), placeholderData: keepPreviousData });
  const m = METRICS.find((x) => x.id === metric)!;

  const data = useMemo(() => (q.data?.series ?? []).map((p, i, all) => {
    const win = all.slice(Math.max(0, i - 6), i + 1);
    return { ...p, ma: Math.round((win.reduce((a, x) => a + x[metric === "cumulative" ? "captured" : metric], 0) / win.length) * 10) / 10 };
  }), [q.data, metric]);

  const d = q.data;
  const change = d && d.previous ? Math.round(((d.total - d.previous) / d.previous) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Measure" className="inline-flex flex-wrap rounded-2xl bg-white p-1 ring-1 ring-line">
          {METRICS.map((x) => (
            <button key={x.id} role="tab" aria-selected={metric === x.id} onClick={() => setMetric(x.id)}
              className={cn("inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition", metric === x.id ? "bg-navy-950 text-white" : "text-slate-500 hover:text-navy-900")}>
              <span className="size-2 rounded-full" style={{ background: x.color }} />{x.label}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="Window" className="inline-flex rounded-2xl bg-white p-1 ring-1 ring-line">
          {[14, 30, 90].map((n) => (
            <button key={n} role="tab" aria-selected={days === n} onClick={() => setDays(n)}
              className={cn("rounded-xl px-3.5 py-2 text-sm font-semibold tabular-nums transition", days === n ? "bg-gold text-navy-950" : "text-slate-500 hover:text-navy-900")}>{n} days</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Captured in period", d ? num(d.total) : "—", null],
          ["Average per day", d ? num(d.avg) : "—", null],
          ["Best day", d?.best?.captured ? num(d.best.captured) : "—", d?.best?.captured ? fmtDay(d.best.date, true) : null],
          ["vs previous period", change == null ? "—" : `${change >= 0 ? "+" : ""}${change}%`, d ? `${num(d.previous)} before` : null],
        ].map(([k, v, sub], i) => (
          <div key={k as string} className="relative overflow-hidden rounded-3xl bg-white p-4 ring-1 ring-line">
            <p className="text-xs font-bold tracking-[.12em] text-slate-500 uppercase">{k}</p>
            <p className={cn("mt-1.5 flex items-center gap-1 font-display text-3xl font-extrabold tabular-nums",
              i === 3 && change != null ? (change >= 0 ? "text-kenya-green" : "text-kenya-red") : "text-navy-900")}>
              {i === 3 && change != null && (change >= 0 ? <ArrowUpRight className="size-6" /> : <ArrowDownRight className="size-6" />)}{v}
            </p>
            {sub && <p className="text-xs text-slate-500">{sub}</p>}
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-2 px-5 pt-5">
          <div>
            <p className="font-bold text-navy-900">{m.label}, last {days} days</p>
            <p className="text-sm text-slate-500">{metric === "cumulative" ? "Everyone captured so far, against the county target." : "Each day, with the 7-day average showing the real direction."}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: m.color, opacity: 0.35 }} />{metric === "cumulative" ? "Running total" : "Daily"}</span>
            {metric !== "cumulative" ? <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-gold" />7-day average</span>
              : target > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-kenya-red" />Target</span>}
          </div>
        </div>
        <div className="h-80 px-2 pt-4 pb-2">
          {!d ? <Skeleton className="h-full rounded-2xl" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ts-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={m.color} stopOpacity={0.35} />
                    <stop offset="1" stopColor={m.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="date" tickFormatter={(v: string) => fmtDay(v)} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={48}
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v))}
                  domain={metric === "cumulative" && target ? [0, (max: number) => Math.max(max, target) * 1.05] : [0, "auto"]} />
                <Tooltip cursor={{ stroke: "#0b1f3a", strokeOpacity: 0.15, strokeWidth: 24 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as Point & { ma: number };
                    return (
                      <div className="rounded-2xl bg-[#06101f] px-4 py-3 text-white shadow-xl">
                        <p className="text-xs text-slate-400">{fmtDay(p.date, true)}</p>
                        <p className="mt-1 font-display text-2xl font-bold tabular-nums">{num(p[metric])}</p>
                        <p className="text-xs text-slate-300">{m.label.toLowerCase()}{metric !== "cumulative" && <> · 7-day avg <b className="text-gold">{num(p.ma)}</b></>}</p>
                      </div>
                    );
                  }} />
                {metric === "cumulative" && target > 0 && <ReferenceLine y={target} stroke="#bb1e10" strokeWidth={2} label={{ value: `Target ${num(target)}`, position: "insideTopRight", fontSize: 12, fill: "#bb1e10" }} />}
                <Area type="monotone" dataKey={metric} stroke={m.color} strokeWidth={2.5} fill="url(#ts-fill)" activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} animationDuration={700} />
                {metric !== "cumulative" && <Line type="monotone" dataKey="ma" stroke="#c9a227" strokeWidth={2.5} strokeDasharray="6 5" dot={false} activeDot={false} animationDuration={900} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div>
        <p className="mb-2 text-sm font-bold text-navy-900">By constituency, same {days} days</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(d?.constituencies ?? []).map((c) => {
            const color = CONSTITUENCY_COLORS[c.name] ?? "#64748b";
            const pts = c.series.map((v, i) => ({ i, v }));
            return (
              <div key={c.name} className="rounded-3xl bg-white p-4 ring-1 ring-line">
                <div className="flex items-baseline justify-between">
                  <p className="flex items-center gap-2 font-semibold text-navy-900"><span className="size-2.5 rounded-full" style={{ background: color }} />{c.name}</p>
                  <p className="font-display text-xl font-bold text-navy-900 tabular-nums">{num(c.total)}</p>
                </div>
                <div className="mt-2 h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pts} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                      <defs><linearGradient id={`sm-${c.name}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.4} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
                      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#sm-${c.name})`} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
