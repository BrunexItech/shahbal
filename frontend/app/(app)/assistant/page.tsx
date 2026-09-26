"use client";

import { Bot, FileText, Printer, Send, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { askCampaign, type Turn, useAiStatus, weeklyBriefing } from "@/features/ai/api";
import { Markdown } from "@/features/ai/Markdown";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";

const STARTERS = [
  "Which wards are furthest behind their target, and why?",
  "What are residents complaining about most this month?",
  "Are we ahead or behind the weekly plan?",
  "Which wards haven't been visited recently?",
  "Wadi zipi zinahitaji ziara zaidi wiki hii?",
];

export default function AssistantPage() {
  const user = useUser();
  const status = useAiStatus();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<{ text: string; asOf: string } | null>(null);
  const [briefing, setBriefing] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", content: text }]);
    setQ("");
    setBusy(true);
    try {
      const r = await askCampaign(text, history);
      setTurns((t) => [...t, { role: "assistant", content: r.answer }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The assistant couldn't answer");
      setTurns((t) => t.slice(0, -1));
      setQ(text);
    } finally {
      setBusy(false);
    }
  }

  async function makeBriefing() {
    setBriefing(true);
    try {
      const r = await weeklyBriefing();
      setBrief({ text: r.briefing, asOf: r.as_of });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write the briefing");
    } finally {
      setBriefing(false);
    }
  }

  if (status.data && !status.data.enabled) {
    return (
      <>
        <PageHeader eyebrow="Command" title="Ask the campaign" subtitle="Plain-language answers from the campaign's live figures." />
        <Card><EmptyState icon={<Bot className="size-6" />} title="The AI assistant isn't switched on"
          body={user.role === "super_admin" ? "Add an OpenAI key as OPENAI_API_KEY in backend/.env and restart the backend. Everything else works without it." : "Ask HQ to switch it on. Everything else works without it."} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Command" title="Ask the campaign"
        subtitle="Ask about targets, wards, visits and what residents are raising. Answers come only from the campaign's own figures for your area."
        actions={<Button variant="secondary" icon={<FileText className="size-4" />} loading={briefing} onClick={makeBriefing}>Weekly briefing</Button>} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {!turns.length && (
              <div className="py-6 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-navy-950 text-gold"><Bot className="size-7" /></span>
                <p className="mt-3 font-display text-xl font-bold text-navy-900">What would you like to know?</p>
                <p className="mt-1 text-sm text-slate-500">English or Kiswahili. Try one of these:</p>
                <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => void ask(s)} className="rounded-full bg-slate-50 px-3.5 py-2 text-left text-sm text-navy-900 ring-1 ring-line hover:bg-slate-100">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cn("flex gap-3", t.role === "user" && "flex-row-reverse")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", t.role === "user" ? "bg-slate-100 text-slate-600" : "bg-navy-950 text-gold")}>
                  {t.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
                </span>
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed", t.role === "user" ? "bg-navy-950 text-white" : "bg-slate-50 text-slate-700 ring-1 ring-line")}>
                  {t.role === "user" ? t.content : <Markdown text={t.content} />}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 pl-11 text-sm text-slate-500"><Spinner size="sm" /> Looking at the figures…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex items-end gap-2 border-t border-line p-3 sm:p-4">
            <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={1} maxLength={800} aria-label="Your question"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }}
              placeholder="Ask about wards, targets, visits or issues…"
              className="max-h-40 min-h-11 flex-1 resize-y rounded-xl border border-line px-3.5 py-2.5 text-base focus:border-ocean focus:outline-none focus:ring-4 focus:ring-ocean/10" />
            <Button type="submit" loading={busy} disabled={q.trim().length < 3} icon={<Send className="size-4" />}>Ask</Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm font-bold text-navy-900"><ShieldCheck className="size-4 text-kenya-green" /> How it works</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-600">
              <li>It only sees totals for your area: targets, captures, visits, issues and the plan.</li>
              <li>Never names, phone numbers or ID numbers.</li>
              <li>It explains and suggests; it never sends or changes anything.</li>
              <li>Double-check anything important on the Command Centre.</li>
            </ul>
          </Card>
          {brief && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div><p className="font-bold text-navy-900">Weekly briefing</p><p className="text-xs text-slate-500">{brief.asOf}</p></div>
                <button onClick={() => printBriefing(brief.text, brief.asOf)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-navy-900" aria-label="Print briefing"><Printer className="size-4" /></button>
              </div>
              <Markdown text={brief.text} className="p-5 text-sm leading-relaxed text-slate-700" />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function printBriefing(text: string, asOf: string) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const doc = w.document;
  doc.title = "Team Shahbal weekly briefing";
  const style = doc.createElement("style");
  style.textContent = "body{font:15px/1.55 system-ui,sans-serif;color:#0b1f3a;max-width:680px;margin:40px auto;padding:0 20px}h1{font-size:22px;margin:0}h2{font-size:17px;margin:22px 0 6px}li{margin:3px 0}.m{color:#64748b;font-size:13px}";
  doc.head.append(style);
  const h1 = doc.createElement("h1"); h1.textContent = "Weekly briefing";
  const m = doc.createElement("p"); m.className = "m"; m.textContent = `Team Shahbal · ${asOf}`;
  doc.body.append(h1, m);
  let ul: HTMLUListElement | null = null;
  for (const line of text.split("\n")) {
    const b = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (b) { ul ??= doc.body.appendChild(doc.createElement("ul")); const li = doc.createElement("li"); li.textContent = b[1].replace(/\*\*/g, ""); ul.append(li); continue; }
    ul = null;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { const el = doc.createElement("h2"); el.textContent = h[1]; doc.body.append(el); }
    else if (line.trim()) { const p = doc.createElement("p"); p.textContent = line.replace(/\*\*/g, ""); doc.body.append(p); }
  }
  w.print();
}
