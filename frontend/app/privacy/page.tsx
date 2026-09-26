"use client";

import { Eye, KeyRound, PencilLine, ShieldCheck, Trash2, VolumeX } from "lucide-react";
import { useState } from "react";

import { PublicShell } from "@/components/public/PublicShell";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CAMPAIGN_NAME } from "@/lib/config";

type Holdings = {
  records: { reference: string; name: string; phone: string; national_id: string; birth_year: number | null; gender: string | null; ward: string;
    polling_centre: string | null; voter_card: string | null; status: string; source: string; consented_at: string | null; registered_at: string; no_contact: boolean }[];
  reports: { reference: string; topic: string; summary: string; status: string; name_given: string | null; sms_updates: boolean; reported_at: string }[];
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) : "—");

export default function PrivacyPage() {
  return (
    <PublicShell eyebrow="Privacy" title="Your data, your rights" lead={`How ${CAMPAIGN_NAME} handles your information, and how to see, correct or erase it.`}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="p-6 sm:p-8 text-sm leading-relaxed text-slate-700">
          <Section title="What we collect">When you join, we keep your name, mobile number, national ID number (encrypted, and only the last four digits are ever shown), year of birth, gender if you give it, ward, polling centre and voter card number if you give it. When you report an issue, we keep what you wrote, the place, any photos, and your name and number only if you choose to give them.</Section>
          <Section title="Why">To tell you when the team is in your ward, remind you on voting day, follow up on the issues you raise, and understand what matters across Mombasa. We never sell your data, and we never use it to profile you by tribe, religion or background.</Section>
          <Section title="Who can see it">Only campaign staff who need it for your area, each with their own login and a record of everything they open. Photos and ID numbers are stored encrypted.</Section>
          <Section title="How long we keep it">Until the end of the 2027 election cycle, unless you ask us to erase it sooner. Call recordings are deleted automatically after 90 days.</Section>
          <Section title="Your rights">Under Kenya&apos;s Data Protection Act, 2019, you can see the information we hold, have it corrected, have it erased, and stop us contacting you. Use the form on this page; it only needs your phone. You can also complain to the Office of the Data Protection Commissioner (ODPC).</Section>
        </Card>
        <MyData />
      </div>
    </PublicShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-5 last:mb-0"><h2 className="mb-1 font-display text-lg font-bold text-navy-900">{title}</h2><p>{children}</p></section>;
}

function MyData() {
  const [phone, setPhone] = useState("");
  const [rid, setRid] = useState("");
  const [code, setCode] = useState("");
  const [data, setData] = useState<(Holdings & { token: string }) | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [details, setDetails] = useState("");
  const [done, setDone] = useState("");

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); } };
  const act = (action: "stop" | "correct" | "erase") => run(async () => {
    const r = await api<{ message: string }>(`/portal/my-data/${rid}/act`, { silent401: true, body: { token: data!.token, action, details: action === "correct" ? details : undefined } });
    setDone(r.message);
  });

  return (
    <Card className="self-start overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line bg-[#06101f] px-5 py-4 text-white">
        <ShieldCheck className="size-6 text-gold" />
        <div><p className="font-bold">See or manage your data</p><p className="text-xs text-slate-400">We&apos;ll send a code to your phone to confirm it&apos;s you.</p></div>
      </div>
      <div className="space-y-4 p-5">
        {done ? <p className="rounded-xl bg-kenya-green-50 p-4 text-sm font-semibold text-kenya-green ring-1 ring-kenya-green/20">{done}</p>
        : !rid ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api<{ message: string; request_id: string }>("/portal/my-data/start", { silent401: true, body: { phone: phone.replace(/\s/g, "") } }); setRid(r.request_id); setMsg(r.message); }); }} className="space-y-3">
            <Input label="Your mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button type="submit" loading={busy} disabled={phone.replace(/\D/g, "").length < 9} icon={<KeyRound className="size-4" />}>Send me a code</Button>
          </form>
        ) : !data ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => setData(await api(`/portal/my-data/verify`, { silent401: true, body: { request_id: rid, code } }))); }} className="space-y-3">
            <p className="text-sm text-slate-600">{msg}</p>
            <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <div className="flex gap-2"><Button type="submit" loading={busy} disabled={code.length !== 6}>Show my data</Button><Button type="button" variant="ghost" onClick={() => { setRid(""); setCode(""); }}>Start again</Button></div>
          </form>
        ) : (
          <div className="space-y-4">
            {!data.records.length && !data.reports.length && <p className="text-sm text-slate-600">We don&apos;t hold anything for this number.</p>}
            {data.records.map((r) => (
              <div key={r.reference} className="rounded-2xl p-4 text-sm ring-1 ring-line">
                <p className="flex items-center justify-between font-semibold text-navy-900">{r.name} <Badge>{r.reference}</Badge></p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                  <dt>Phone</dt><dd className="text-navy-900">{r.phone}</dd><dt>ID number</dt><dd className="text-navy-900">{r.national_id}</dd>
                  <dt>Year of birth</dt><dd className="text-navy-900">{r.birth_year ?? "—"}</dd><dt>Ward</dt><dd className="text-navy-900">{r.ward}</dd>
                  <dt>Polling centre</dt><dd className="text-navy-900">{r.polling_centre ?? "—"}</dd><dt>Consent given</dt><dd className="text-navy-900">{day(r.consented_at)}</dd>
                  <dt>Contact</dt><dd className="text-navy-900">{r.no_contact ? "Stopped" : "Allowed"}</dd>
                </dl>
              </div>
            ))}
            {data.reports.map((r) => <p key={r.reference} className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-line"><b className="text-navy-900">{r.reference}</b> · {r.summary} · {r.status.replace("_", " ")}</p>)}
            {(data.records.length > 0 || data.reports.length > 0) && (
              correcting ? (
                <div className="space-y-2">
                  <Textarea label="What should be corrected?" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
                  <div className="flex gap-2"><Button size="sm" loading={busy} disabled={details.trim().length < 3} onClick={() => act("correct")}>Send correction</Button><Button size="sm" variant="ghost" onClick={() => setCorrecting(false)}>Back</Button></div>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button variant="secondary" size="sm" icon={<VolumeX className="size-4" />} loading={busy} onClick={() => act("stop")}>Stop contacting me</Button>
                  <Button variant="secondary" size="sm" icon={<PencilLine className="size-4" />} onClick={() => setCorrecting(true)}>Correct something</Button>
                  <Button variant="secondary" size="sm" icon={<Trash2 className="size-4" />} loading={busy} onClick={() => act("erase")}>Erase my data</Button>
                </div>
              )
            )}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><Eye className="size-3.5" /> This view closes in 30 minutes.</p>
          </div>
        )}
        {err && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{err}</p>}
      </div>
    </Card>
  );
}
