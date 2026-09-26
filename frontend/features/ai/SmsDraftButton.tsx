"use client";

import { Bot, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Modal, Segmented, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";

import { draftSms, useAiStatus } from "./api";

/** Optional: suggest three message drafts; the person picks one and edits it as usual. */
export function SmsDraftButton({ channel, area, onUse }: { channel: "sms" | "whatsapp"; area?: string; onUse: (text: string) => void }) {
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [language, setLanguage] = useState<"en" | "sw" | "mixed">("en");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<{ text: string; chars: number; fits: boolean }[]>([]);
  if (!status.data?.enabled) return null;

  async function run() {
    setBusy(true);
    try {
      setDrafts((await draftSms({ purpose, channel, language, area })).drafts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft messages");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-900">
        <Bot className="size-3.5 text-gold" /> Suggest with AI
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Suggest a message" subtitle="Describe what the message is for. You choose a draft and can edit it before sending."
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button><Button loading={busy} disabled={purpose.trim().length < 5} onClick={run}>{drafts.length ? "Try again" : "Suggest drafts"}</Button></>}>
          <div className="space-y-4">
            <Textarea label="What is it for?" rows={3} maxLength={400} value={purpose} onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Invite supporters in Kisauni to the town hall on Saturday at 3pm at Bamburi grounds" />
            <Segmented<"en" | "sw" | "mixed"> label="Language" value={language} onChange={setLanguage}
              options={[{ value: "en", label: "English" }, { value: "sw", label: "Kiswahili" }, { value: "mixed", label: "Mixed" }]} />
            {drafts.map((d, i) => (
              <div key={i} className="rounded-2xl p-4 ring-1 ring-line">
                <p className="text-sm whitespace-pre-line text-navy-900">{d.text}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={cn("text-xs", d.fits ? "text-slate-500" : "font-semibold text-amber-700")}>{d.chars} characters{d.fits ? "" : " (too long for one SMS)"}</span>
                  <Button size="sm" icon={<Check className="size-4" />} onClick={() => { onUse(d.text); setOpen(false); toast.success("Draft added. Edit it as you like."); }}>Use this</Button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
