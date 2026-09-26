"use client";

import { Check, HandHeart } from "lucide-react";
import { useMemo, useState } from "react";

import { PublicShell } from "@/components/public/PublicShell";
import { Button, Card, Input, Select, Textarea } from "@/components/ui";
import { usePortalGeo } from "@/features/geo/api";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME } from "@/lib/config";

const SKILLS: [string, string][] = [
  ["canvassing", "Door to door"], ["events", "Events & rallies"], ["polling_agent", "Polling agent on election day"], ["call_centre", "Phone calls"],
  ["social_media", "Social media"], ["driving", "Driving"], ["logistics", "Logistics & materials"], ["it", "IT & data"],
];

export default function VolunteerPage() {
  const geo = usePortalGeo();
  const [f, setF] = useState({ full_name: "", phone: "", email: "", constituency_id: "", ward_id: "", availability: "", message: "", consent: false, website: "" });
  const [skills, setSkills] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };
  const wards = useMemo(() => geo.data?.find((c) => c.id === f.constituency_id)?.wards ?? [], [geo.data, f.constituency_id]);

  async function submit() {
    const e: Record<string, string> = {};
    if (f.full_name.trim().split(/\s+/).length < 2) e.full_name = "Enter at least two names";
    if (!/^(\+?254|0)?[17]\d{8}$/.test(f.phone.replace(/\s/g, ""))) e.phone = "Enter a valid Kenyan mobile number";
    if (!f.ward_id) e.ward_id = "Choose your ward";
    if (!f.consent) e.consent = "Please agree so the team can contact you";
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/site/volunteers", { silent401: true, body: {
        full_name: f.full_name, phone: f.phone.replace(/\s/g, ""), email: f.email || undefined, ward_id: f.ward_id, skills,
        availability: f.availability || undefined, message: f.message || undefined, consent: true, website: f.website || undefined } });
      setDone(r.message);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setErrors((x) => ({ ...x, form: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell eyebrow="Volunteer" title="Give a few hours for Mombasa" lead="Walk your street, help at a rally, make calls, or stand as a polling agent on election day. Every hour counts.">
      <Card className="p-6 sm:p-8">
        {done ? (
          <div className="py-10 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-kenya-green text-white"><Check className="size-7" strokeWidth={3} /></span>
            <p className="mt-4 font-display text-2xl font-extrabold text-navy-900">{done}</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-6">
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Full names" required value={f.full_name} error={errors.full_name} autoComplete="name" onChange={(e) => set("full_name", e.target.value)} />
              <Input label="Mobile number" required type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={f.phone} error={errors.phone} onChange={(e) => set("phone", e.target.value)} />
              <Input label="Email" hint="Optional" type="email" autoComplete="email" value={f.email} error={errors.email} onChange={(e) => set("email", e.target.value)} />
              <Select label="How often can you help?" value={f.availability} placeholder="Choose" onChange={(e) => set("availability", e.target.value)}>
                <option value="weekends">Weekends</option><option value="evenings">Evenings</option><option value="weekdays">Weekdays</option><option value="any">Whenever I&apos;m needed</option>
              </Select>
              <Select label="Constituency" required value={f.constituency_id} placeholder="Choose" onChange={(e) => { set("constituency_id", e.target.value); set("ward_id", ""); }}>
                {geo.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select label="Ward" required value={f.ward_id} placeholder="Choose" disabled={!f.constituency_id} error={errors.ward_id} onChange={(e) => set("ward_id", e.target.value)}>
                {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
            <div>
              <p className="text-sm font-semibold text-navy-900">What would you like to do?</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SKILLS.map(([id, label]) => {
                  const on = skills.includes(id);
                  return (
                    <button key={id} type="button" aria-pressed={on} onClick={() => setSkills((s) => (on ? s.filter((x) => x !== id) : [...s, id]))}
                      className={cn("flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-sm font-semibold ring-1 transition", on ? "bg-kenya-green/10 text-navy-900 ring-kenya-green" : "text-slate-700 ring-line hover:bg-slate-50")}>
                      <span className={cn("grid size-5 place-items-center rounded-md ring-1", on ? "bg-kenya-green text-white ring-kenya-green" : "ring-slate-300")}>{on && <Check className="size-3.5" strokeWidth={3} />}</span>{label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Textarea label="Anything else?" hint="Optional" rows={3} maxLength={600} value={f.message} onChange={(e) => set("message", e.target.value)} />
            <label className={cn("flex cursor-pointer gap-3 rounded-2xl p-4 ring-1", f.consent ? "bg-kenya-green-50 ring-kenya-green/25" : errors.consent ? "bg-red-50 ring-kenya-red/30" : "bg-slate-50 ring-line")}>
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-kenya-green" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
              <span className="text-sm text-navy-900">I agree that {CAMPAIGN_NAME} may keep these details and contact me about volunteering. I can ask for them to be deleted at any time.</span>
            </label>
            {errors.consent && <p className="-mt-3 text-sm font-medium text-kenya-red">{errors.consent}</p>}
            {errors.form && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{errors.form}</p>}
            <Button type="submit" variant="gold" size="lg" loading={busy} icon={<HandHeart className="size-5" />} className="w-full sm:w-auto">I want to volunteer</Button>
          </form>
        )}
      </Card>
    </PublicShell>
  );
}
