"use client";

import { useQuery } from "@tanstack/react-query";
import { HeartHandshake, Trophy } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Skeleton } from "@/components/loaders";
import { Card, CardHeader, SOURCE_LABEL } from "@/components/ui";
import { CONSTITUENCY_COLORS } from "@/features/map/regions";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import type { Source } from "@/lib/types";

type Profile = {
  total: number; verified: number; supporters: number; reachable: number; opted_out: number; new_supporters_7d: number;
  funnel: { stage: string; value: number }[];
  mix: Record<string, number>; gender: Record<string, number>; supporter_gender: Record<string, number>;
  age: { band: string; people: number; supporters: number }[];
  constituencies: { name: string; people: number; supporters: number; undecided: number; share: number | null }[];
  sources: Record<string, number>; referred: number; recruiters: { name: string; ward: string; signups: number }[];
};

const SUPPORT_ORDER: [string, string, string][] = [
  ["supporter", "Supporters", "#006b3f"], ["leaning", "Leaning", "#0b7fa6"], ["undecided", "Undecided", "#c9a227"],
  ["opposed", "Opposed", "#bb1e10"], ["unknown", "Not asked yet", "#94a3b8"],
];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Who our supporters are, and where the next ones will come from. */
export function SupporterProfile() {
  const q = useQuery({ queryKey: ["dashboard", "supporters"], queryFn: () => api<Profile>("/dashboard/supporters"), staleTime: 30_000 });
  const d = q.data;
  if (!d) return <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-3xl" />)}</div>;
  const persuadable = (d.mix.leaning ?? 0) + (d.mix.undecided ?? 0);
  const maxFunnel = Math.max(1, ...d.funnel.map((f) => f.value));

  return (
    <div className="space-y-4">
      {/* Funnel */}
      <Card className="overflow-hidden">
        <CardHeader title="From captured to reachable" subtitle="Each step shows how many carry on to the next." />
        <div className="space-y-3 p-5">
          {d.funnel.map((f, i) => {
            const prev = i ? d.funnel[i - 1].value : null;
            return (
              <div key={f.stage} className="grid grid-cols-[8rem_minmax(0,1fr)_5rem] items-center gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_6rem]">
                <p className="text-sm font-semibold text-navy-900">{f.stage}</p>
                <div className="relative h-9 rounded-xl bg-slate-100">
                  <div className="absolute inset-y-0 left-0 flex items-center rounded-xl px-3 text-sm font-bold text-white transition-[width] duration-700"
                    style={{ width: `${Math.max(8, (f.value / maxFunnel) * 100)}%`, background: ["#0b1f3a", "#0b7fa6", "#006b3f", "#c9a227"][i] }}>
                    {num(f.value)}
                  </div>
                </div>
                <p className="text-right text-xs text-slate-500 tabular-nums">{prev != null ? <><b className="text-navy-900">{pct(f.value, prev)}%</b> kept</> : "start"}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Support mix */}
        <Card>
          <CardHeader title="Where people stand" subtitle={`${num(d.total)} people captured`} />
          <div className="p-5">
            <div className="flex h-5 overflow-hidden rounded-full ring-1 ring-line">
              {SUPPORT_ORDER.map(([k, , c]) => (d.mix[k] ? <span key={k} className="h-full border-r-2 border-white last:border-r-0" style={{ width: `${(d.mix[k] / d.total) * 100}%`, background: c }} title={`${k}: ${d.mix[k]}`} /> : null))}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {SUPPORT_ORDER.map(([k, label, c]) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-slate-700"><span className="size-2.5 rounded-sm" style={{ background: c }} />{label}</span>
                  <span className="tabular-nums"><b className="text-navy-900">{num(d.mix[k] ?? 0)}</b> <span className="text-slate-400">{pct(d.mix[k] ?? 0, d.total)}%</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-2xl bg-gold-50 px-4 py-3 text-sm text-navy-900 ring-1 ring-gold/30">
              <b>{num(persuadable)}</b> people are leaning or undecided. These are the call centre&apos;s best targets.
              <b className="ml-1">{num(d.new_supporters_7d)}</b> new supporters this week.
            </p>
          </div>
        </Card>

        {/* Share by constituency */}
        <Card>
          <CardHeader title="Supporter share by constituency" subtitle="Supporters as a share of everyone captured there" />
          <ul className="space-y-3 p-5">
            {[...d.constituencies].sort((a, b) => (b.share ?? 0) - (a.share ?? 0)).map((c) => (
              <li key={c.name}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold text-navy-900"><span className="size-2.5 rounded-full" style={{ background: CONSTITUENCY_COLORS[c.name] ?? "#94a3b8" }} />{c.name}</span>
                  <span className="text-xs text-slate-500 tabular-nums"><b className="text-sm text-navy-900">{c.share ?? 0}%</b> · {num(c.undecided)} persuadable</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${c.share ?? 0}%`, background: CONSTITUENCY_COLORS[c.name] ?? "#64748b" }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Age */}
        <Card>
          <CardHeader title="Age" subtitle="Everyone captured, and how many of them support us" />
          <div className="h-64 px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.age} margin={{ top: 12, right: 12, left: -8, bottom: 0 }} barGap={3}>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="band" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip cursor={{ fill: "#0b1f3a", fillOpacity: 0.04 }} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
                <Bar dataKey="people" name="People" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="supporters" name="Supporters" fill="#006b3f" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 px-5 pb-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-slate-300" />People</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-kenya-green" />Supporters</span>
          </div>
        </Card>

        {/* Gender */}
        <Card>
          <CardHeader title="Gender" subtitle="Share of people, and of supporters" />
          <div className="space-y-5 p-5">
            {([["Everyone captured", d.gender], ["Supporters", d.supporter_gender]] as const).map(([label, g]) => {
              const tot = Object.values(g).reduce((a, b) => a + b, 0);
              return (
                <div key={label}>
                  <p className="mb-1.5 text-sm font-semibold text-navy-900">{label} <span className="font-normal text-slate-500">· {num(tot)}</span></p>
                  <div className="flex h-8 overflow-hidden rounded-xl text-xs font-bold text-white">
                    {([["female", "Women", "#7b4fb8"], ["male", "Men", "#0b7fa6"], ["other", "Other", "#c9a227"], ["unknown", "Not given", "#94a3b8"]] as const).map(([k, l, c]) =>
                      g[k] ? <span key={k} className="flex items-center justify-center border-r-2 border-white last:border-r-0" style={{ width: `${(g[k] / tot) * 100}%`, background: c }} title={`${l}: ${g[k]}`}>{pct(g[k], tot) >= 12 ? `${l} ${pct(g[k], tot)}%` : ""}</span> : null)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Recruiters */}
        <Card>
          <CardHeader title="Top recruiters" subtitle={`${num(d.referred)} people joined through a supporter's invite link`} />
          {d.recruiters.length ? (
            <ol className="space-y-3 p-5">
              {d.recruiters.map((r, i) => (
                <li key={`${r.name}-${i}`} className="flex items-center gap-3">
                  <span className={`grid size-8 place-items-center rounded-full text-xs font-bold ${i === 0 ? "bg-gold text-navy-950" : "bg-slate-100 text-slate-600"}`}>{i === 0 ? <Trophy className="size-4" /> : i + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-navy-900">{r.name}</p><p className="text-xs text-slate-500">{r.ward}</p></div>
                  <span className="font-display text-lg font-bold text-navy-900 tabular-nums">{num(r.signups)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="flex items-start gap-3 p-5 text-sm text-slate-600"><HeartHandshake className="size-5 shrink-0 text-kenya-green" />Every supporter who joins online gets a personal invite link. Sign-ups through it will be credited here.</p>
          )}
        </Card>

        {/* Channels */}
        <Card>
          <CardHeader title="How people joined" subtitle={`${num(d.opted_out)} have opted out of messages`} />
          <ul className="space-y-3 p-5">
            {Object.entries(d.sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k}>
                <div className="flex justify-between text-sm"><span className="font-semibold text-navy-900">{SOURCE_LABEL[k as Source] ?? k}</span><span className="tabular-nums text-slate-600"><b className="text-navy-900">{num(v)}</b> · {pct(v, d.total)}%</span></div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-ocean" style={{ width: `${pct(v, d.total)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
