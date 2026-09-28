"use client";

import { Check, Copy, Download, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Constituency } from "@/lib/types";

const SUPPORT: [string, string][] = [["supporter", "Supporters"], ["leaning", "Leaning"], ["undecided", "Undecided"], ["unknown", "Not asked yet"], ["opposed", "Opposed"]];
type Result = { filename: string; file: string; password: string; rows: number; area: string };

function save(r: Result) {
  const bytes = Uint8Array.from(atob(r.file), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * HQ only: one ward's or constituency's contacts as an encrypted file. Asks "Confirm it's you" first,
 * needs a purpose, and shows the file's password once; the platform never keeps it.
 */
export function ContactsExport({ tree, onClose }: { tree: Constituency[]; onClose: () => void }) {
  const [area, setArea] = useState("");
  const [support, setSupport] = useState<string[]>(["supporter", "leaning"]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api<Result>("/voters/contacts-export", {
        body: {
          ward_id: area.startsWith("w:") ? area.slice(2) : undefined,
          constituency_id: area.startsWith("c:") ? area.slice(2) : undefined,
          support, verified_only: verifiedOnly, purpose: purpose.trim(),
        },
      });
      save(r);
      setDone(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The download didn't start");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal open onClose={onClose} title="Contacts downloaded" subtitle={`${done.rows.toLocaleString()} people · ${done.area}`}
        footer={<Button onClick={onClose}>I&apos;ve saved the password</Button>}>
        <div className="space-y-4">
          <div className="rounded-2xl bg-navy-950 p-5 text-center text-white">
            <p className="flex items-center justify-center gap-1.5 text-xs font-bold tracking-wider text-gold uppercase"><KeyRound className="size-4" /> Password for the file</p>
            <p className="mt-2 font-mono text-2xl font-bold tracking-wider select-all">{done.password}</p>
            <Button size="sm" variant="secondary" className="mt-3" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => navigator.clipboard?.writeText(done.password).then(() => { setCopied(true); toast.success("Password copied"); })}>
              {copied ? "Copied" : "Copy password"}
            </Button>
          </div>
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-navy-900 ring-1 ring-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span><b>It&apos;s shown only now.</b> The platform doesn&apos;t keep it. Keep the password separate from the file, and never send both in the same message.</span>
          </p>
          <div className="text-sm text-slate-600">
            <p className="font-semibold text-navy-900">Opening the file ({done.filename})</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Windows: right-click → open with <b>7-Zip</b> or WinRAR (free), enter the password.</li>
              <li>Mac: open with <b>Keka</b> or The Unarchiver.</li>
              <li>Phone: most file manager apps ask for the password.</li>
            </ul>
            <p className="mt-2">Inside is a CSV that opens in Excel or Google Sheets. Delete it when you&apos;re done.</p>
          </div>
          <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => save(done)}>Download the file again</Button>
        </div>
      </Modal>
    );
  }

  const ok = !!area && support.length > 0 && purpose.trim().length >= 10;
  return (
    <Modal open onClose={onClose} title="Download contacts" subtitle="Names and phone numbers for one area, as a password-protected file."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<Lock className="size-4" />} loading={busy} disabled={!ok} onClick={() => void run()}>Download protected file</Button></>}>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-ocean-50 px-3 py-2.5 text-sm text-navy-900 ring-1 ring-ocean/15">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-ocean" />
          <span>This is the most sensitive download in the platform. You&apos;ll confirm it&apos;s you first; the file is encrypted, marked confidential with your name, and recorded in the audit trail. ID numbers and people who opted out are never included.</span>
        </p>
        <Select label="Area" required value={area} placeholder="Choose a constituency or ward" onChange={(e) => setArea(e.target.value)}>
          {tree.map((c) => (
            <optgroup key={c.id} label={c.name}>
              <option value={`c:${c.id}`}>All of {c.name}</option>
              {c.wards.map((w) => <option key={w.id} value={`w:${w.id}`}>{w.name} ward</option>)}
            </optgroup>
          ))}
        </Select>
        <fieldset>
          <legend className="text-sm font-semibold text-navy-900">Who to include</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {SUPPORT.map(([k, l]) => {
              const on = support.includes(k);
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setSupport((s) => (on ? s.filter((x) => x !== k) : [...s, k]))}
                  className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition", on ? "bg-navy-950 text-white ring-navy-950" : "bg-white text-navy-900 ring-line hover:bg-slate-50")}>
                  {l}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-navy-900">
          <input type="checkbox" className="size-4 accent-kenya-green" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified contacts only
        </label>
        <Textarea label="Why is it needed?" required rows={2} maxLength={300} value={purpose} onChange={(e) => setPurpose(e.target.value)}
          placeholder="e.g. Phone bank for the Kisauni town hall on Saturday" hint="Written into the file and the audit trail." />
      </div>
    </Modal>
  );
}
