"use client";

import { ArrowRight, Check, Copy, ImagePlus, LocateFixed, Lock, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { usePortalGeo } from "@/features/geo/api";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME } from "@/lib/config";

import { CATEGORIES, CATEGORY, type IssueCategory, type IssueStatus, STATUS, STATUS_FLOW } from "./meta";

type Lang = "en" | "sw";

const T = {
  en: {
    what: "What needs attention?", whatHint: "Pick the closest match.",
    where: "Where is it?", whereHint: "So the right ward team picks it up.",
    constituency: "Constituency", ward: "Ward", area: "Estate, street or landmark", areaPh: "e.g. behind Majengo market",
    pin: "Add my exact location", pinned: "Location added", pinRemove: "Remove",
    tell: "Tell us more", tellHint: "What is happening, since when, and who it affects.", descPh: "Describe the problem in your own words…",
    photos: "Photos", photosHint: "Optional, up to 3. Location data is removed.", addPhoto: "Add photo",
    you: "Stay in touch", youHint: "Optional. Leave blank to report anonymously.", name: "Your name", phone: "Mobile number",
    updates: "Send me SMS updates about this report",
    consent: `I agree that ${CAMPAIGN_NAME} may store this report to follow it up with the right people. My number is only used for updates about it.`,
    submit: "Send report", sending: "Sending…",
    doneH: "Asante. We've got it.", doneLead: "Your report is with the ward team. Keep this reference:",
    doneTrack: "Check progress any time with the reference and the phone number you gave.", doneAnon: "You reported anonymously, so we can't send you updates.",
    another: "Report something else", copy: "Copy", copied: "Reference copied",
    trackH: "Track a report", trackLead: "Enter the reference you received and the phone number you used.", ref: "Reference", find: "Find my report",
    notFound: "No report matches that reference and phone number.", reported: "Reported",
    errCat: "Choose what the problem is about", errWard: "Choose the ward", errDesc: "Tell us a little more (at least 10 characters)",
    errPhone: "Enter a valid Kenyan mobile number", errUpdates: "Add your number to get updates", errConsent: "Please tick to agree",
  },
  sw: {
    what: "Nini kinahitaji kushughulikiwa?", whatHint: "Chagua kinachokaribia zaidi.",
    where: "Ni wapi?", whereHint: "Ili timu ya wadi husika ishughulikie.",
    constituency: "Eneo bunge", ward: "Wadi", area: "Mtaa, barabara au alama", areaPh: "mf. nyuma ya soko la Majengo",
    pin: "Ongeza mahali nilipo", pinned: "Mahali pameongezwa", pinRemove: "Ondoa",
    tell: "Tueleze zaidi", tellHint: "Nini kinaendelea, tangu lini, na kinaathiri nani.", descPh: "Eleza tatizo kwa maneno yako…",
    photos: "Picha", photosHint: "Si lazima, hadi 3. Taarifa za mahali zinaondolewa.", addPhoto: "Ongeza picha",
    you: "Tuendelee kuwasiliana", youHint: "Si lazima. Acha wazi kuripoti bila jina.", name: "Jina lako", phone: "Nambari ya simu",
    updates: "Nitumie SMS kuhusu maendeleo ya ripoti hii",
    consent: `Nakubali ${CAMPAIGN_NAME} ihifadhi ripoti hii ili ifuatiliwe na wahusika. Nambari yangu itatumika tu kwa taarifa kuhusu ripoti hii.`,
    submit: "Tuma ripoti", sending: "Inatuma…",
    doneH: "Asante. Tumepokea.", doneLead: "Ripoti yako iko kwa timu ya wadi. Hifadhi nambari hii:",
    doneTrack: "Fuatilia wakati wowote kwa nambari hii na nambari ya simu uliyotoa.", doneAnon: "Umeripoti bila jina, kwa hivyo hatutaweza kukutumia taarifa.",
    another: "Ripoti jambo lingine", copy: "Nakili", copied: "Nambari imenakiliwa",
    trackH: "Fuatilia ripoti", trackLead: "Andika nambari ya ripoti na nambari ya simu uliyotumia.", ref: "Nambari ya ripoti", find: "Tafuta ripoti yangu",
    notFound: "Hakuna ripoti inayolingana na nambari hizo.", reported: "Iliripotiwa",
    errCat: "Chagua tatizo linahusu nini", errWard: "Chagua wadi", errDesc: "Tueleze zaidi kidogo (angalau herufi 10)",
    errPhone: "Andika nambari sahihi ya simu", errUpdates: "Ongeza nambari yako kupata taarifa", errConsent: "Tafadhali kubali",
  },
} as const;

const PHONE = /^(\+?254|0)?[17]\d{8}$/;
type Form = { category: IssueCategory | ""; constituency_id: string; ward_id: string; area: string; description: string; name: string; phone: string;
  updates: boolean; consent: boolean; website: string; lat: number | null; lng: number | null };
const EMPTY: Form = { category: "", constituency_id: "", ward_id: "", area: "", description: "", name: "", phone: "", updates: true, consent: false, website: "", lat: null, lng: null };

export function ReportIssue({ lang, onJoin }: { lang: Lang; onJoin: () => void }) {
  const t = T[lang];
  const geo = usePortalGeo();
  const [f, setF] = useState<Form>(EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [done, setDone] = useState<{ reference: string; anon: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  // On phones the confirmation sits below the hero: bring the reference into view.
  useEffect(() => { if (done) doneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [done]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };
  const wards = useMemo(() => geo.data?.find((c) => c.id === f.constituency_id)?.wards ?? [], [geo.data, f.constituency_id]);
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setF((x) => ({ ...x, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })); setLocating(false); },
      () => { setLocating(false); toast.error(lang === "sw" ? "Imeshindwa kupata mahali" : "Couldn't get your location"); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!f.category) e.category = t.errCat;
    if (!f.ward_id) e.ward_id = t.errWard;
    if (f.description.trim().length < 10) e.description = t.errDesc;
    const phone = f.phone.replace(/\s/g, "");
    if (phone && !PHONE.test(phone)) e.phone = t.errPhone;
    if (f.updates && !phone) e.phone = t.errUpdates;
    if (!f.consent) e.consent = t.errConsent;
    setErrors(e);
    return !Object.values(e).some(Boolean);
  }

  async function submit() {
    if (!validate()) return;
    setBusy(true);
    try {
      const phone = f.phone.replace(/\s/g, "");
      const r = await api<{ reference: string; upload_token: string }>("/portal/issues", {
        silent401: true,
        body: {
          category: f.category, ward_id: f.ward_id, area: f.area || undefined, description: f.description,
          latitude: f.lat ?? undefined, longitude: f.lng ?? undefined, reporter_name: f.name || undefined,
          reporter_phone: phone || undefined, contact_ok: !!phone && f.updates, consent: true, website: f.website || undefined,
        },
      });
      for (const p of photos) {
        const form = new FormData();
        form.append("file", p);
        try {
          await api(`/portal/issues/${r.reference}/photos`, { form, query: { token: r.upload_token }, silent401: true });
        } catch { /* the report itself is in; a failed photo shouldn't undo it */ }
      }
      setDone({ reference: r.reference, anon: !phone });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setErrors((x) => ({ ...x, form: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div ref={doneRef} className="animate-fade-up scroll-mt-4 p-6 text-center sm:p-10">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-kenya-green text-white shadow-[0_12px_30px_-10px_rgba(0,107,63,.8)]"><Check className="size-8" strokeWidth={3} /></span>
        <h2 className="mt-5 font-display text-3xl font-extrabold text-navy-900">{t.doneH}</h2>
        <p className="mt-2 text-slate-600">{t.doneLead}</p>
        <div className="mx-auto mt-4 inline-flex items-center gap-3 rounded-2xl bg-navy-950 px-5 py-3">
          <span className="font-mono text-2xl font-bold tracking-widest text-gold">{done.reference}</span>
          <button onClick={() => navigator.clipboard?.writeText(done.reference).then(() => toast.success(t.copied))}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" aria-label={t.copy}><Copy className="size-4" /></button>
        </div>
        <p className="mx-auto mt-4 max-w-md text-sm text-slate-500">{done.anon ? t.doneAnon : t.doneTrack}</p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button variant="secondary" onClick={() => { setF(EMPTY); setPhotos([]); setDone(null); }}>{t.another}</Button>
          <Button variant="gold" onClick={onJoin}>{lang === "sw" ? "Jiunge na timu pia" : "Join the team too"} <ArrowRight className="size-4" /></Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-8 p-6 sm:p-8">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />

      <section>
        <h2 className="text-xl font-bold text-navy-900">{t.what}</h2>
        <p className="text-sm text-slate-500">{t.whatHint}</p>
        <div role="radiogroup" aria-label={t.what} className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATEGORIES.map((c) => {
            const on = f.category === c.id;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => set("category", c.id)}
                className={cn("flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-3 text-center text-sm font-semibold ring-1 transition active:scale-[.98]",
                  on ? "bg-navy-950 text-white ring-navy-950 shadow-[0_12px_28px_-14px_rgba(6,16,31,.9)]" : "bg-white text-navy-900 ring-line hover:bg-slate-50")}>
                <c.icon className={cn("size-6", on ? "text-gold" : "text-ocean")} />
                <span className="leading-tight">{c[lang]}</span>
              </button>
            );
          })}
        </div>
        {errors.category && <p className="mt-2 text-sm font-medium text-kenya-red">{errors.category}</p>}
      </section>

      <section className="space-y-4">
        <div><h2 className="text-xl font-bold text-navy-900">{t.where}</h2><p className="text-sm text-slate-500">{t.whereHint}</p></div>
        {!geo.data ? <div className="grid place-items-center py-6"><Spinner /></div> : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t.constituency} required value={f.constituency_id} placeholder="—"
              onChange={(e) => { setF((x) => ({ ...x, constituency_id: e.target.value, ward_id: "" })); setErrors((x) => ({ ...x, ward_id: "" })); }}>
              {geo.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label={t.ward} required value={f.ward_id} placeholder="—" disabled={!f.constituency_id} error={errors.ward_id} onChange={(e) => set("ward_id", e.target.value)}>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
        )}
        <Input label={t.area} value={f.area} maxLength={120} placeholder={t.areaPh} onChange={(e) => set("area", e.target.value)} />
        {f.lat != null ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-kenya-green-50 px-3 py-1.5 text-sm font-semibold text-kenya-green ring-1 ring-kenya-green/20">
            <MapPin className="size-4" /> {t.pinned}
            <button type="button" onClick={() => setF((x) => ({ ...x, lat: null, lng: null }))} className="ml-1 text-slate-500 hover:text-navy-900" aria-label={t.pinRemove}><X className="size-4" /></button>
          </p>
        ) : (
          <Button type="button" variant="secondary" size="sm" loading={locating} icon={<LocateFixed className="size-4" />} onClick={locate}>{t.pin}</Button>
        )}
      </section>

      <section className="space-y-4">
        <div><h2 className="text-xl font-bold text-navy-900">{t.tell}</h2><p className="text-sm text-slate-500">{t.tellHint}</p></div>
        <Textarea label={t.tell} rows={5} maxLength={2000} required value={f.description} placeholder={t.descPh} error={errors.description}
          onChange={(e) => set("description", e.target.value)} />
        <div>
          <p className="text-sm font-semibold text-navy-900">{t.photos}</p>
          <p className="text-xs text-slate-500">{t.photosHint}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {previews.map((u, i) => (
              <span key={u} className="relative size-20 overflow-hidden rounded-xl ring-1 ring-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={u} alt="" className="size-full object-cover" />
                <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label="Remove photo"
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-navy-950/80 text-white"><X className="size-3.5" /></button>
              </span>
            ))}
            {photos.length < 3 && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="grid size-20 place-items-center rounded-xl border-2 border-dashed border-line text-slate-400 hover:border-ocean hover:text-ocean" aria-label={t.addPhoto}>
                <span className="flex flex-col items-center gap-1 text-xs font-semibold"><ImagePlus className="size-5" />{t.addPhoto}</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={(e) => { const file = e.target.files?.[0]; if (file) setPhotos((p) => [...p, file].slice(0, 3)); e.target.value = ""; }} />
        </div>
      </section>

      <section className="space-y-4">
        <div><h2 className="text-xl font-bold text-navy-900">{t.you}</h2><p className="text-sm text-slate-500">{t.youHint}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t.name} value={f.name} maxLength={120} autoComplete="name" onChange={(e) => set("name", e.target.value)} />
          <Input label={t.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={f.phone} error={errors.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-navy-900">
          <input type="checkbox" className="size-5 accent-kenya-green" checked={f.updates} onChange={(e) => set("updates", e.target.checked)} /> {t.updates}
        </label>
        <label className={cn("flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition", f.consent ? "bg-kenya-green-50 ring-kenya-green/25" : errors.consent ? "bg-red-50 ring-kenya-red/30" : "bg-slate-50 ring-line")}>
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-kenya-green" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
          <span className="text-sm text-navy-900">{t.consent}</span>
        </label>
        {errors.consent && <p className="text-sm font-medium text-kenya-red">{errors.consent}</p>}
      </section>

      {errors.form && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{errors.form}</p>}
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-slate-500"><Lock className="size-4 shrink-0 text-ocean" />{lang === "sw" ? "Picha na maelezo yako yanahifadhiwa kwa usalama." : "Your photos and details are stored securely."}</p>
        <Button type="submit" variant="gold" size="lg" loading={busy} className="min-w-44">{busy ? t.sending : t.submit}</Button>
      </div>
    </form>
  );
}

type Tracked = { reference: string; category: IssueCategory; summary: string; ward: string; status: IssueStatus; created_at: string; resolved_at: string | null;
  updates: { status: IssueStatus | null; note: string | null; created_at: string }[] };

export function TrackIssue({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [ref, setRef] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<Tracked | null>(null);
  const when = (d: string) => new Date(d).toLocaleDateString(lang === "sw" ? "sw-KE" : "en-KE", { day: "numeric", month: "short", year: "numeric" });

  async function find() {
    setBusy(true);
    setError("");
    try {
      setData(await api<Tracked>("/portal/issues/track", { silent401: true, body: { reference: ref.trim(), phone: phone.replace(/\s/g, "") } }));
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError && e.status === 404 ? t.notFound : e instanceof Error ? e.message : t.notFound);
    } finally {
      setBusy(false);
    }
  }

  const at = data ? Math.max(0, STATUS_FLOW.indexOf(data.status)) : 0;
  return (
    <div className="space-y-6 p-6 sm:p-8">
      <div><h2 className="text-xl font-bold text-navy-900">{t.trackH}</h2><p className="text-sm text-slate-500">{t.trackLead}</p></div>
      <form onSubmit={(e) => { e.preventDefault(); void find(); }} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Input label={t.ref} required placeholder="ISS-01284" value={ref} autoCapitalize="characters" onChange={(e) => setRef(e.target.value.toUpperCase())} />
        <Input label={t.phone} required type="tel" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" loading={busy} icon={<Search className="size-4" />} disabled={!ref.trim() || !phone.trim()}>{t.find}</Button>
      </form>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{error}</p>}
      {data && (
        <div className="animate-fade-up overflow-hidden rounded-2xl ring-1 ring-line">
          <div className="flex items-start gap-3 bg-slate-50 p-4">
            {(() => { const C = CATEGORY[data.category]; return <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-950 text-gold"><C.icon className="size-5" /></span>; })()}
            <div className="min-w-0">
              <p className="font-mono text-xs font-bold text-slate-500">{data.reference} · {data.ward}</p>
              <p className="font-semibold text-navy-900">{data.summary}</p>
              <p className="text-xs text-slate-500">{t.reported} {when(data.created_at)}</p>
            </div>
          </div>
          {data.status === "closed" ? (
            <p className="px-4 py-3 text-sm text-slate-600">{STATUS.closed[lang]}</p>
          ) : (
            <ol className="grid grid-cols-4 gap-1 px-4 pt-4">
              {STATUS_FLOW.map((s, i) => (
                <li key={s} className="text-center">
                  <span className={cn("block h-1.5 rounded-full", i <= at ? "" : "bg-slate-200")} style={i <= at ? { background: STATUS[data.status].color } : undefined} />
                  <span className={cn("mt-1.5 block text-xs font-semibold", i === at ? "text-navy-900" : "text-slate-400")}>{STATUS[s][lang]}</span>
                </li>
              ))}
            </ol>
          )}
          <ul className="space-y-3 p-4">
            {data.updates.slice().reverse().map((u, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: u.status ? STATUS[u.status].color : "#94a3b8" }} />
                <span><span className="font-semibold text-navy-900">{u.status ? STATUS[u.status][lang] : lang === "sw" ? "Taarifa" : "Update"}</span>
                  {u.note && <span className="text-slate-600"> · {u.note}</span>}
                  <span className="block text-xs text-slate-400">{when(u.created_at)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
