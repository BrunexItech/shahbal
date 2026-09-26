"use client";

import { Check, ChevronLeft, ChevronRight, ClipboardList, MapPin, Plus, SkipForward, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { useConfirm } from "@/components/ui/Confirm";
import { type AgentDay, useCreateTask, useDayPlan, useDeleteTask } from "@/features/assignments/api";
import { useStations } from "@/features/geo/api";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { can } from "@/lib/roles";

const PRESETS = ["Door to door", "Market walk", "Capture at the polling centre", "Verify pending records", "Distribute materials", "Support a town hall"];
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default function DailyPlansPage() {
  const user = useUser();
  const editor = can.manageStations(user.role);
  const [day, setDay] = useState<string | undefined>(undefined);
  const plan = useDayPlan(day);
  const current = plan.data?.day;
  const isPast = !!(plan.data && plan.data.day < plan.data.today);
  const [adding, setAdding] = useState<AgentDay | null>(null);
  const [q, setQ] = useState("");
  const agents = useMemo(() => (plan.data?.agents ?? []).filter((a) => !q || `${a.name} ${a.ward}`.toLowerCase().includes(q.toLowerCase())), [plan.data, q]);
  const all = plan.data?.agents ?? [];
  const tasks = all.flatMap((a) => a.tasks);
  const stats = [
    ["Agents with a plan", `${num(all.filter((a) => a.tasks.length).length)} / ${num(all.length)}`],
    ["Tasks done", `${num(tasks.filter((t) => t.status === "done").length)} / ${num(tasks.length)}`],
    ["Skipped", num(tasks.filter((t) => t.status === "skipped").length)],
    ["Captured that day", num(all.reduce((s, a) => s + a.captured, 0))],
  ];

  return (
    <>
      <PageHeader eyebrow="Outreach" title="Daily plans"
        subtitle="Where each field agent goes and what they do. Agents see their plan on their home screen and tick tasks off as they go." />

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
          <button onClick={() => current && setDay(addDays(current, -1))} className="grid size-9 place-items-center rounded-lg ring-1 ring-line hover:bg-slate-50" aria-label="Previous day"><ChevronLeft className="size-4" /></button>
          <button onClick={() => current && setDay(addDays(current, 1))} className="grid size-9 place-items-center rounded-lg ring-1 ring-line hover:bg-slate-50" aria-label="Next day"><ChevronRight className="size-4" /></button>
          <button onClick={() => setDay(undefined)} className="h-9 rounded-lg px-3 text-sm font-semibold ring-1 ring-line hover:bg-slate-50">Today</button>
          <input type="date" value={current ?? ""} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Choose a day"
            className="h-9 rounded-lg border border-line px-2 text-base sm:text-sm" />
          <h2 className="mr-auto min-w-0 truncate font-display text-lg font-bold text-navy-900">{current ? label(current) : ""}</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an agent or ward" aria-label="Find an agent or ward"
            className="h-9 w-full rounded-lg border border-line px-3 text-base sm:w-56 sm:text-sm" />
        </div>
        <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
          {stats.map(([k, v]) => (
            <div key={k} className="px-5 py-3"><p className="text-xs text-slate-500">{k}</p><p className="font-display text-xl font-bold text-navy-900 tabular-nums">{v}</p></div>
          ))}
        </div>
      </Card>

      {plan.error ? <Card><ErrorState error={plan.error} onRetry={plan.refetch} /></Card>
        : !plan.data ? <Card><SkeletonRows rows={5} /></Card>
        : !all.length ? <Card><EmptyState icon={<Users className="size-6" />} title="No field agents in your area yet" body="Invite field agents from Team; they'll appear here to plan." /></Card>
        : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {agents.map((a) => {
              const target = a.tasks.reduce((s, t) => s + (t.target_captures ?? 0), 0);
              return (
                <Card key={a.id} className="flex flex-col overflow-hidden">
                  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <Avatar userId={a.id} name={a.name} size={40} hasPhoto={a.has_photo} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-navy-900">{a.name}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin className="size-3.5" />{a.ward}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg leading-none font-bold text-navy-900 tabular-nums">{num(a.captured)}{target ? <span className="text-sm text-slate-400"> / {num(target)}</span> : null}</p>
                      <p className="text-xs text-slate-500">captured</p>
                    </div>
                  </div>
                  <ul className="flex-1 divide-y divide-line">
                    {a.tasks.map((t) => <TaskLine key={t.id} t={t} editor={editor && !isPast} />)}
                    {!a.tasks.length && <li className="px-4 py-4 text-sm text-slate-400">Nothing planned.</li>}
                  </ul>
                  {editor && !isPast && (
                    <button onClick={() => setAdding(a)} className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-sm font-semibold text-ocean hover:bg-ocean-50/50">
                      <Plus className="size-4" /> Add a task
                    </button>
                  )}
                </Card>
              );
            })}
            {!agents.length && <Card className="md:col-span-2"><p className="p-5 text-sm text-slate-500">No agent matches “{q}”.</p></Card>}
          </div>
        )}
      {adding && current && <AddTask agent={adding} day={current} onClose={() => setAdding(null)} />}
    </>
  );
}

function TaskLine({ t, editor }: { t: AgentDay["tasks"][number]; editor: boolean }) {
  const del = useDeleteTask();
  const confirm = useConfirm();
  return (
    <li className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ring-2", t.status === "done" ? "bg-kenya-green text-white ring-kenya-green" : t.status === "skipped" ? "bg-slate-200 text-slate-500 ring-slate-200" : "ring-slate-300")}>
        {t.status === "done" && <Check className="size-3" strokeWidth={3} />}{t.status === "skipped" && <SkipForward className="size-2.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold text-navy-900", t.status !== "pending" && "text-slate-500")}>{t.title}</p>
        <p className="text-xs text-slate-500">{[t.station, t.target_captures ? `target ${t.target_captures}` : null].filter(Boolean).join(" · ")}</p>
        {t.report && <p className="mt-0.5 text-xs text-slate-600">“{t.report}”</p>}
      </div>
      {editor && (
        <button aria-label={`Remove ${t.title}`} disabled={del.isPending} onClick={async () => {
          if (await confirm({ title: "Remove this task?", body: t.title, confirmLabel: "Remove", danger: true })) del.mutate(t.id, { onError: (e) => toast.error(e.message) });
        }} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-kenya-red"><Trash2 className="size-4" /></button>
      )}
    </li>
  );
}

function AddTask({ agent, day, onClose }: { agent: AgentDay; day: string; onClose: () => void }) {
  const create = useCreateTask();
  const stations = useStations(agent.ward_id);
  const [title, setTitle] = useState("");
  const [station, setStation] = useState("");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [repeat, setRepeat] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  function save() {
    if (title.trim().length < 3) return setErrors({ title: "Describe the task in a few words" });
    create.mutate({ user_id: agent.id, day, title: title.trim(), station_id: station || undefined, target_captures: target ? +target : undefined, notes: notes.trim() || undefined, repeat_days: repeat }, {
      onSuccess: (r) => { toast.success(r.created > 1 ? `Planned for ${r.created} days` : "Task added"); onClose(); },
      onError: (e) => { if (e instanceof ApiError) setErrors(e.fields); toast.error(e.message); },
    });
  }
  return (
    <Modal open onClose={onClose} title={`Plan for ${agent.name}`} subtitle={`${agent.ward} · ${label(day)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} icon={<ClipboardList className="size-4" />} onClick={save}>Add task</Button></>}>
      <div className="space-y-4">
        <div>
          <Input label="Task" required value={title} maxLength={140} error={errors.title} onChange={(e) => setTitle(e.target.value)} placeholder="What should they do?" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => <button key={p} type="button" onClick={() => setTitle(p)} className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-navy-900 ring-1 ring-line hover:bg-slate-100">{p}</button>)}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Polling centre" value={station} placeholder="Anywhere in the ward" onChange={(e) => setStation(e.target.value)}>
            {stations.data?.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="Capture target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, "").slice(0, 4))} hint="Optional" />
        </div>
        <Textarea label="Notes for the agent" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Streets to cover, who to meet, what to bring…" />
        <Select label="Repeat" value={String(repeat)} onChange={(e) => setRepeat(+e.target.value)}>
          <option value="0">Just this day</option>
          {[1, 2, 4, 6, 13].map((n) => <option key={n} value={n}>This day and the next {n} day{n > 1 ? "s" : ""}</option>)}
        </Select>
      </div>
    </Modal>
  );
}
