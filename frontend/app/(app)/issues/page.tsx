"use client";

import { AlertTriangle, Clock, Inbox, Megaphone, Plus, Search, ShieldCheck, Siren } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Skeleton, SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { FlagTabs } from "@/components/ui/FlagTabs";
import { Pagination } from "@/components/ui/Pagination";
import { useGeoTree } from "@/features/geo/api";
import { type IssueFilters, type IssueStats, useIssues, useIssueStats } from "@/features/issues/api";
import { IssueCase } from "@/features/issues/IssueCase";
import { CATEGORIES, CATEGORY, PRIORITY, SOURCE, STATUS } from "@/features/issues/meta";
import { ReportIssueModal } from "@/features/issues/ReportIssueModal";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num, timeAgo } from "@/lib/format";
import { can } from "@/lib/roles";

const TABS = [
  { id: "overview", label: "Overview", hint: "What Mombasa is telling us" },
  { id: "cases", label: "Cases", hint: "Every report, and who's on it" },
] as const;

export default function CommunityVoicePage() {
  const user = useUser();
  const agent = user.role === "field_agent" || user.role === "call_agent";
  const [tab, setTab] = useState<string>(agent ? "cases" : "overview");
  const [switching, setSwitching] = useState(0);
  const [filters, setFilters] = useState<IssueFilters>({ status: "open", page: 1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const stats = useIssueStats();

  // Deep link: /issues?case=<id> opens that case (used by the map).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    if (id) { setOpenId(id); setTab("cases"); }
  }, []);

  const go = (id: string) => { setTab(id); setSwitching((n) => n + 1); };
  const filterWard = (ward_id: string) => { setFilters({ status: "open", ward_id, page: 1 }); go("cases"); };

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Community Voice"
        subtitle={agent ? "Problems residents raised with you, and where each one stands." : "What residents are asking for, ward by ward, and how fast the team responds."}
        actions={can.capture(user.role) && <Button icon={<Plus className="size-4" />} onClick={() => setReporting(true)}>Report an issue</Button>} />
      {!agent && <FlagTabs tabs={TABS} active={tab} onChange={go} label="Community Voice" switching={switching} />}

      <div key={tab} className="tab-in">
        {tab === "overview" && !agent ? (
          stats.error ? <Card><ErrorState error={stats.error} onRetry={stats.refetch} /></Card>
          : !stats.data ? <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-3xl" />)}</div>
          : <Overview s={stats.data} onWard={filterWard} onCategory={(category) => { setFilters({ status: "open", category, page: 1 }); go("cases"); }} />
        ) : <Cases filters={filters} setFilters={setFilters} onOpen={setOpenId} />}
      </div>

      {openId && <IssueCase id={openId} onClose={() => setOpenId(null)} />}
      {reporting && <ReportIssueModal onClose={() => setReporting(false)} />}
    </>
  );
}

function hours(h: number | null) {
  if (h == null) return "—";
  return h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(h < 240 ? 1 : 0)} days`;
}

function Overview({ s, onWard, onCategory }: { s: IssueStats; onWard: (id: string) => void; onCategory: (c: string) => void }) {
  const [allWards, setAllWards] = useState(false);
  if (!s.total) {
    return <Card><EmptyState icon={<Megaphone className="size-6" />} title="No reports yet"
      body="Residents report problems from the public page (“Tell us what matters”), and the team logs what people raise in the field or on calls." /></Card>;
  }
  const maxCat = Math.max(1, ...s.by_category.map((c) => c.total));
  const tiles: [string, string, string, typeof Inbox, string][] = [
    ["Open cases", num(s.open), `${num(s.recent)} new in ${s.days} days`, Inbox, "text-navy-900"],
    ["Waiting for a first response", num(s.new), "Nobody has picked these up yet", AlertTriangle, s.new ? "text-kenya-red" : "text-navy-900"],
    ["Urgent and open", num(s.urgent), "Marked urgent by a coordinator", Siren, s.urgent ? "text-kenya-red" : "text-navy-900"],
    ["Resolved", num(s.resolved), `of ${num(s.total)} reported`, ShieldCheck, "text-kenya-green"],
    ["Typical time to resolve", hours(s.median_hours_to_resolve), s.oldest_open_at ? `Oldest open case: ${timeAgo(s.oldest_open_at)}` : "No open cases", Clock, "text-navy-900"],
  ];
  const weekly = s.weekly.map((w) => ({ ...w, label: new Date(w.week).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) }));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map(([k, v, hint, Icon, color]) => (
          <Card key={k} className="p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon className="size-4" />{k}</p>
            <p className={cn("mt-1 font-display text-3xl font-bold tabular-nums", color)}>{v}</p>
            <p className="text-xs text-slate-500">{hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="What people are raising" subtitle="All reports by topic. Tap one to see its open cases." />
          <ul className="space-y-2.5 p-5 pt-1">
            {s.by_category.map((c) => {
              const C = CATEGORY[c.category];
              return (
                <li key={c.category}>
                  <button onClick={() => onCategory(c.category)} className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-left">
                    <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-ocean group-hover:bg-navy-950 group-hover:text-gold"><C.icon className="size-4" /></span>
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-semibold text-navy-900">{C.en}</span>
                        <span className="text-xs text-slate-500 tabular-nums">{num(c.open)} open · {num(c.resolved)} resolved</span></span>
                      <span className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-slate-100" style={{ width: `${(c.total / maxCat) * 100}%`, minWidth: 8 }}>
                        <span className="h-full bg-kenya-green" style={{ width: `${(c.resolved / c.total) * 100}%` }} />
                        <span className="h-full bg-navy-800" style={{ width: `${((c.total - c.resolved) / c.total) * 100}%`, marginLeft: c.resolved && c.total - c.resolved ? 2 : 0 }} />
                      </span>
                    </span>
                    <span className="w-10 text-right font-display text-lg font-bold text-navy-900 tabular-nums">{num(c.total)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="flex gap-4 px-5 pb-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-kenya-green" />Resolved</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-navy-800" />Not yet resolved</span>
          </p>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="Reported vs resolved, by week" subtitle="Are we keeping up? Resolved should catch up with reported." />
          <div className="h-72 min-h-72 flex-1 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekly} margin={{ top: 12, right: 12, left: -8, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip cursor={{ fill: "#0b1f3a", fillOpacity: 0.04 }} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="reported" name="Reported" fill="#1a3a66" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="resolved" name="Resolved" fill="#006b3f" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Wards" subtitle="Where reports come from and what each ward raises most. Tap a ward to work its open cases." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-slate-50/70 text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th className="px-5 py-3">Ward</th><th className="px-3 py-3">Raised most</th><th className="px-3 py-3 text-right">Reports</th>
                <th className="px-3 py-3 text-right">Open</th><th className="px-5 py-3 text-right">Resolved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(allWards ? s.by_ward : s.by_ward.slice(0, 10)).map((w) => {
                const top = w.top ? CATEGORY[w.top] : null;
                return (
                  <tr key={w.ward_id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => onWard(w.ward_id)}>
                    <td className="px-5 py-3"><p className="font-semibold text-navy-900">{w.ward}</p><p className="text-xs text-muted">{w.constituency}</p></td>
                    <td className="px-3 py-3">{top && <span className="inline-flex items-center gap-1.5 text-navy-900"><top.icon className="size-4 text-ocean" />{top.en}</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{num(w.total)}</td>
                    <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", w.open ? "text-navy-900" : "text-slate-400")}>{num(w.open)}</td>
                    <td className="px-5 py-3 text-right text-kenya-green tabular-nums">{num(w.resolved)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {s.by_ward.length > 10 && (
          <button onClick={() => setAllWards((x) => !x)} className="w-full border-t border-line px-5 py-3 text-sm font-semibold text-ocean hover:bg-slate-50">
            {allWards ? "Show the top 10" : `Show all ${s.by_ward.length} wards`}
          </button>
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-slate-500">
          Sources: {Object.entries(s.by_source).map(([k, v]) => `${SOURCE[k as keyof typeof SOURCE]} ${num(v)}`).join(" · ")}
        </p>
      </Card>
    </div>
  );
}

function Cases({ filters, setFilters, onOpen }: { filters: IssueFilters; setFilters: (f: IssueFilters) => void; onOpen: (id: string) => void }) {
  const user = useUser();
  const tree = useGeoTree();
  const [q, setQ] = useState(filters.q ?? "");
  useEffect(() => {
    const t = window.setTimeout(() => { if ((filters.q ?? "") !== q) setFilters({ ...filters, q: q || undefined, page: 1 }); }, 350);
    return () => window.clearTimeout(t);
  }, [q, filters, setFilters]);
  const list = useIssues(filters);
  const set = (k: keyof IssueFilters, v: string | boolean | undefined) => setFilters({ ...filters, [k]: v || undefined, page: 1 });
  const wards = useMemo(() => tree.data ?? [], [tree.data]);
  const select = "h-10 rounded-xl border border-line bg-white px-3 text-base sm:text-sm";

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-line p-4">
        <label className="relative min-w-0 flex-[1_1_220px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, place or words" aria-label="Search cases"
            className="h-10 w-full rounded-xl border border-line pr-3 pl-9 text-base focus:border-ocean focus:outline-none focus:ring-4 focus:ring-ocean/10 sm:text-sm" />
        </label>
        <select aria-label="Status" value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)} className={select}>
          <option value="open">Open</option><option value="">All statuses</option>
          {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((s) => <option key={s} value={s}>{STATUS[s].en}</option>)}
        </select>
        <select aria-label="Topic" value={filters.category ?? ""} onChange={(e) => set("category", e.target.value)} className={select}>
          <option value="">All topics</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.en}</option>)}
        </select>
        {wards.some((c) => c.wards.length > 1) && (
          <select aria-label="Ward" value={filters.ward_id ?? ""} onChange={(e) => set("ward_id", e.target.value)} className={select}>
            <option value="">All wards</option>
            {wards.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
          </select>
        )}
        {can.manageStations(user.role) && (
          <button onClick={() => set("mine", !filters.mine)} aria-pressed={!!filters.mine}
            className={cn("h-10 rounded-xl px-3 text-sm font-semibold ring-1", filters.mine ? "bg-navy-950 text-white ring-navy-950" : "text-navy-900 ring-line hover:bg-slate-50")}>Assigned to me</button>
        )}
      </div>
      {list.isLoading ? <SkeletonRows rows={6} /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data?.items.length ? (
        <EmptyState icon={<Inbox className="size-6" />} title="No cases here" body={filters.status === "open" ? "Nothing open matches. Try “All statuses”." : "Try clearing a filter."} />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {list.data.items.map((i) => {
              const C = CATEGORY[i.category];
              return (
                <li key={i.id}>
                  <button onClick={() => onOpen(i.id)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-slate-50/70 sm:px-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-ocean"><C.icon className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-xs font-bold text-slate-500">{i.reference}</span>
                        <Badge tone={STATUS[i.status].tone} dot>{STATUS[i.status].en}</Badge>
                        {i.priority !== "normal" && <Badge tone={PRIORITY[i.priority].tone}>{PRIORITY[i.priority].label}</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate font-semibold text-navy-900">{i.summary}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {i.ward}{i.area ? ` · ${i.area}` : ""} · {timeAgo(i.created_at)} · {i.assigned_to ? `with ${i.assigned_to}` : "not assigned"}{i.photos ? ` · ${i.photos} photo${i.photos > 1 ? "s" : ""}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Pagination page={filters.page ?? 1} size={30} total={list.data.total} onPage={(page) => setFilters({ ...filters, page })} />
        </>
      )}
    </Card>
  );
}
