"use client";

import { Check, ClipboardList, MapPin, SkipForward, Target } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";

import { type Task, useDayPlan, useUpdateTask } from "./api";

/** The field agent's checklist for today, set by their coordinator. */
export function TodayPlan() {
  const { data } = useDayPlan();
  const me = data?.agents[0];
  if (!me) return null;
  const target = me.tasks.reduce((a, t) => a + (t.target_captures ?? 0), 0);
  const done = me.tasks.filter((t) => t.status !== "pending").length;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-navy-950 text-gold"><ClipboardList className="size-5" /></span>
          <div>
            <p className="font-bold text-navy-900">Today&apos;s plan</p>
            <p className="text-xs text-slate-500">{me.tasks.length ? `${done} of ${me.tasks.length} done` : "Nothing assigned yet. Your coordinator will plan your day here."}</p>
          </div>
        </div>
        {target > 0 && (
          <div className="min-w-44">
            <p className="flex items-center justify-between text-xs text-slate-500"><span className="flex items-center gap-1"><Target className="size-3.5" />Captured today</span><b className="text-navy-900 tabular-nums">{num(me.captured)} / {num(target)}</b></p>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-kenya-green" style={{ width: `${Math.min(100, (me.captured / target) * 100)}%` }} /></span>
          </div>
        )}
      </div>
      {me.tasks.length > 0 && <ul className="divide-y divide-line">{me.tasks.map((t) => <TaskRow key={t.id} t={t} />)}</ul>}
    </Card>
  );
}

function TaskRow({ t }: { t: Task }) {
  const update = useUpdateTask();
  const [mode, setMode] = useState<"done" | "skipped" | null>(null);
  const [report, setReport] = useState("");
  const finish = (status: Task["status"]) => update.mutate({ id: t.id, status, report: report.trim() || undefined }, {
    onSuccess: () => { toast.success(status === "done" ? "Nice work. Task done." : status === "skipped" ? "Task skipped" : "Task reopened"); setMode(null); setReport(""); },
    onError: (e) => toast.error(e.message),
  });
  const closed = t.status !== "pending";
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ring-2", t.status === "done" ? "bg-kenya-green text-white ring-kenya-green" : t.status === "skipped" ? "bg-slate-200 text-slate-500 ring-slate-200" : "ring-slate-300")}>
          {t.status === "done" && <Check className="size-3.5" strokeWidth={3} />}{t.status === "skipped" && <SkipForward className="size-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold text-navy-900", closed && "text-slate-500 line-through")}>{t.title}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-slate-500">
            {t.station && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{t.station}</span>}
            {t.target_captures ? <span>Target: {t.target_captures} captures</span> : null}
          </p>
          {t.notes && <p className="mt-1 text-sm text-slate-600">{t.notes}</p>}
          {t.report && <p className="mt-1 text-xs text-slate-500">Your note: {t.report}</p>}
        </div>
        {!closed && !mode && (
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => setMode("skipped")} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-line hover:bg-slate-50">Skip</button>
            <button onClick={() => setMode("done")} className="rounded-lg bg-kenya-green px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">Done</button>
          </div>
        )}
        {closed && <button onClick={() => finish("pending")} className="shrink-0 text-xs font-semibold text-ocean hover:underline">Reopen</button>}
      </div>
      {mode && (
        <div className="mt-3 flex flex-col gap-2 pl-9 sm:flex-row">
          <input value={report} onChange={(e) => setReport(e.target.value)} maxLength={500} autoFocus
            placeholder={mode === "done" ? "How did it go? (optional)" : "Why couldn't it be done?"}
            className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 text-base focus:border-ocean focus:outline-none sm:text-sm" />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button size="sm" loading={update.isPending} disabled={mode === "skipped" && !report.trim()} onClick={() => finish(mode)}>{mode === "done" ? "Mark done" : "Skip task"}</Button>
          </div>
        </div>
      )}
    </li>
  );
}
