"use client";

import { ArrowLeft, ArrowRight, BellRing, CalendarCheck, Check, Copy, HeartHandshake, Lock, MapPin, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandMark, Spinner } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { Button, Input, Segmented } from "@/components/ui";
import { usePortalGeo, usePortalStations } from "@/features/geo/api";
import { LocationPicker, type LocationValue } from "@/features/geo/LocationPicker";
import { api, ApiError, apiUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";
import type { Gender } from "@/lib/types";

type Lang = "en" | "sw";
type Form = { full_name: string; phone: string; national_id: string; voter_card_no: string; gender: Gender | ""; birth_year: string; loc: LocationValue; consent: boolean; website: string };
const EMPTY: Form = { full_name: "", phone: "", national_id: "", voter_card_no: "", gender: "", birth_year: "", loc: { constituency_id: "", ward_id: "", station_id: "" }, consent: false, website: "" };

const T = {
  en: {
    tag: "Supporter sign-up", h1a: "Join the movement,", h1b: "Mombasa.", lead: "Two minutes. Be the first to know when the team is in your ward, and get a reminder on voting day.",
    perks: ["Know when we visit your ward", "A reminder on voting day", "Help shape Mombasa's future"],
    steps: ["You", "Where you vote", "Confirm"], next: "Continue", back: "Back", submit: "Count me in",
    notIebc: "This is a campaign sign-up, not IEBC voter registration.",
    you: "About you", youHint: "As written on your national ID.", where: "Where you vote", whereHint: "So we can tell you when we're nearby.",
    confirm: "Almost there", confirmHint: "Check your details, then join.",
    consent: `I agree that ${CAMPAIGN_NAME} may store these details and contact me by SMS, WhatsApp or phone about the campaign. I can opt out at any time by replying STOP.`,
    secure: "Your ID number is encrypted and never shared.",
    done: "Karibu to the team!", doneLead: "You're in. Invite friends and family with your personal link.",
    card: "Supporter", share: "Share on WhatsApp", copy: "Copy my link", copied: "Link copied", again: "Register someone else",
    qr: "Scan to join", invited: "You were invited by a friend. Karibu!",
    shareText: `I've joined Team Shahbal for Mombasa. Join me here:`,
  },
  sw: {
    tag: "Jisajili kama mfuasi", h1a: "Jiunge na harakati,", h1b: "Mombasa.", lead: "Dakika mbili tu. Jua mapema timu ikifika wadi yako, na upate ukumbusho siku ya kupiga kura.",
    perks: ["Jua tukitembelea wadi yako", "Ukumbusho siku ya kura", "Saidia kujenga Mombasa"],
    steps: ["Wewe", "Unapopiga kura", "Thibitisha"], next: "Endelea", back: "Rudi", submit: "Nihesabu ndani",
    notIebc: "Huu ni usajili wa kampeni, si usajili wa wapiga kura wa IEBC.",
    you: "Kuhusu wewe", youHint: "Kama ilivyoandikwa kwenye kitambulisho.", where: "Unapopiga kura", whereHint: "Ili tukujulishe tukiwa karibu.",
    confirm: "Karibu kumaliza", confirmHint: "Kagua maelezo yako, kisha jiunge.",
    consent: `Nakubali ${CAMPAIGN_NAME} ihifadhi maelezo haya na iwasiliane nami kwa SMS, WhatsApp au simu kuhusu kampeni. Naweza kujiondoa wakati wowote kwa kujibu STOP.`,
    secure: "Nambari yako ya kitambulisho imesimbwa na haishirikiwi.",
    done: "Karibu kwenye timu!", doneLead: "Umejiunga. Waalike marafiki na familia kwa kiungo chako.",
    card: "Mfuasi", share: "Shiriki WhatsApp", copy: "Nakili kiungo", copied: "Kiungo kimenakiliwa", again: "Sajili mtu mwingine",
    qr: "Changanua kujiunga", invited: "Umealikwa na rafiki. Karibu!",
    shareText: "Nimejiunga na Team Shahbal kwa ajili ya Mombasa. Jiunge nami hapa:",
  },
} as const;

const PERK_ICONS = [BellRing, CalendarCheck, HeartHandshake];

export default function JoinPage() {
  const geo = usePortalGeo();
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const [f, setF] = useState<Form>(EMPTY);
  const stations = usePortalStations(f.loc.ward_id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string | null } | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  useEffect(() => {
    setOrigin(window.location.origin);
    const r = new URLSearchParams(window.location.search).get("ref");
    if (r && /^[A-Z2-7]{8}$/.test(r)) setRef(r);
    try {
      const saved = window.localStorage.getItem("join.lang");
      if (saved === "sw" || saved === "en") setLang(saved);
    } catch {}
  }, []);
  const pickLang = (l: Lang) => { setLang(l); try { window.localStorage.setItem("join.lang", l); } catch {} };

  const wardName = geo.data?.flatMap((c) => c.wards).find((w) => w.id === f.loc.ward_id)?.name;
  const consName = geo.data?.find((c) => c.id === f.loc.constituency_id)?.name;

  function check(s: number) {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (f.full_name.trim().split(/\s+/).length < 2) e.full_name = lang === "sw" ? "Andika angalau majina mawili" : "Enter at least two names";
      if (!/^(\+?254|0)?[17]\d{8}$/.test(f.phone.replace(/\s/g, ""))) e.phone = lang === "sw" ? "Andika nambari sahihi ya simu" : "Enter a valid Kenyan mobile number";
      if (!/^\d{6,12}$/.test(f.national_id)) e.national_id = lang === "sw" ? "Andika nambari ya kitambulisho (tarakimu tu)" : "Enter your national ID number (digits only)";
    }
    if (s === 1) {
      if (!f.loc.constituency_id) e.constituency_id = lang === "sw" ? "Chagua eneo bunge" : "Select your constituency";
      if (!f.loc.ward_id) e.ward_id = lang === "sw" ? "Chagua wadi yako" : "Select your ward";
    }
    if (s === 2 && !f.consent) e.consent = lang === "sw" ? "Tafadhali kubali kabla ya kutuma" : "Please tick to agree before joining";
    setErrors(e);
    return !Object.values(e).some(Boolean);
  }

  async function submit() {
    if (!check(2)) return;
    setBusy(true);
    try {
      const r = await api<{ message: string; share_code: string | null }>("/portal/signup", {
        silent401: true,
        body: {
          full_name: f.full_name, phone: f.phone, national_id: f.national_id,
          voter_card_no: f.voter_card_no || undefined, gender: f.gender || undefined,
          birth_year: f.birth_year ? +f.birth_year : undefined,
          ward_id: f.loc.ward_id, station_id: f.loc.station_id || undefined,
          consent: true, website: f.website || undefined, ref: ref ?? undefined,
        },
      });
      setDone({ code: r.share_code });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setErrors((x) => ({ ...x, form: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusy(false);
    }
  }

  const link = done?.code ? `${origin}/join?ref=${done.code}` : `${origin}/join`;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="relative overflow-hidden bg-[#06101f] pb-32 text-white">
        <FlagStripe />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(11,127,166,.45),transparent_55%),radial-gradient(ellipse_at_0%_100%,rgba(0,107,63,.35),transparent_55%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.05] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:34px_34px]" />
        <div className="relative mx-auto max-w-3xl px-5 pt-7">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandMark className="size-10" />
              <div><p className="font-display font-bold">{CAMPAIGN_NAME}</p><p className="text-xs text-slate-400">{t.tag} · {CANDIDATE_NAME}</p></div>
            </div>
            <div role="group" aria-label="Language" className="inline-flex rounded-full bg-white/10 p-1 ring-1 ring-white/15">
              {(["en", "sw"] as const).map((l) => (
                <button key={l} onClick={() => pickLang(l)} aria-pressed={lang === l}
                  className={cn("rounded-full px-3 py-1 text-xs font-bold uppercase transition", lang === l ? "bg-gold text-navy-950" : "text-slate-300 hover:text-white")}>
                  {l === "en" ? "English" : "Kiswahili"}
                </button>
              ))}
            </div>
          </div>
          <h1 className="mt-10 text-4xl leading-[1.05] font-extrabold sm:text-6xl">{t.h1a} <span className="bg-gradient-to-r from-gold to-[#f1d57a] bg-clip-text text-transparent">{t.h1b}</span></h1>
          <p className="mt-4 max-w-xl text-base text-slate-300 sm:text-lg">{t.lead}</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {t.perks.map((p, i) => {
              const Icon = PERK_ICONS[i];
              return (
                <li key={p} className="inline-flex items-center gap-2 rounded-full bg-white/[.07] px-3.5 py-2 text-sm font-medium ring-1 ring-white/10 backdrop-blur">
                  <Icon className="size-4 text-gold" /> {p}
                </li>
              );
            })}
          </ul>
          {ref && !done && <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-kenya-green/25 px-3 py-1.5 text-sm font-semibold text-[#9ff0c5] ring-1 ring-kenya-green/40"><HeartHandshake className="size-4" /> {t.invited}</p>}
        </div>
      </header>

      <main className="relative mx-auto -mt-24 max-w-3xl px-4 pb-16">
        <div className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-30px_rgba(6,16,31,.5)] ring-1 ring-line">
          {done ? (
            <Welcome t={t} name={f.full_name} ward={wardName} cons={consName} link={link} code={done.code}
              onAgain={() => { setF(EMPTY); setDone(null); setStep(0); }} />
          ) : (
            <>
              {/* Stepper */}
              <ol className="grid grid-cols-3 border-b border-line">
                {t.steps.map((s, i) => (
                  <li key={s} className={cn("relative flex items-center gap-2 px-3 py-4 text-sm font-semibold sm:px-6", i === step ? "text-navy-900" : i < step ? "text-kenya-green" : "text-slate-400")}>
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-extrabold", i < step ? "bg-kenya-green text-white" : i === step ? "bg-navy-950 text-gold" : "bg-slate-100 text-slate-400")}>
                      {i < step ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="hidden truncate sm:inline">{s}</span>
                    <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-1 transition", i <= step ? (i === 0 ? "bg-kenya-black" : i === 1 ? "bg-kenya-red" : "bg-kenya-green") : "bg-transparent")} />
                  </li>
                ))}
              </ol>

              <form onSubmit={(e) => { e.preventDefault(); if (step < 2) { if (check(step)) setStep(step + 1); } else void submit(); }} noValidate className="space-y-6 p-6 sm:p-8">
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />

                {step === 0 && (
                  <section className="animate-fade-up space-y-4">
                    <div><h2 className="text-xl font-bold text-navy-900">{t.you}</h2><p className="text-sm text-slate-500">{t.youHint}</p></div>
                    <Input label={lang === "sw" ? "Majina kamili" : "Full names"} required value={f.full_name} error={errors.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="name" />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input label={lang === "sw" ? "Nambari ya simu" : "Mobile number"} required type="tel" inputMode="tel" autoComplete="tel" value={f.phone} error={errors.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0712 345 678" />
                      <Input label={lang === "sw" ? "Nambari ya kitambulisho" : "National ID number"} required inputMode="numeric" value={f.national_id} error={errors.national_id}
                        onChange={(e) => set("national_id", e.target.value.replace(/\D/g, ""))} autoComplete="off" />
                      <Segmented<Gender> label={lang === "sw" ? "Jinsia" : "Gender"} value={f.gender} onChange={(v) => set("gender", v)}
                        options={[{ value: "female", label: lang === "sw" ? "Mwanamke" : "Female" }, { value: "male", label: lang === "sw" ? "Mwanaume" : "Male" }]} />
                      <Input label={lang === "sw" ? "Mwaka wa kuzaliwa" : "Year of birth"} inputMode="numeric" maxLength={4} value={f.birth_year} error={errors.birth_year}
                        onChange={(e) => set("birth_year", e.target.value.replace(/\D/g, ""))} placeholder="1994" />
                    </div>
                    <p className="flex items-start gap-2 rounded-2xl bg-ocean-50 px-4 py-3 text-sm text-navy-900 ring-1 ring-ocean/15"><Lock className="mt-0.5 size-4 shrink-0 text-ocean" />{t.secure} {t.notIebc}</p>
                  </section>
                )}

                {step === 1 && (
                  <section className="animate-fade-up space-y-4">
                    <div><h2 className="text-xl font-bold text-navy-900">{t.where}</h2><p className="text-sm text-slate-500">{t.whereHint}</p></div>
                    {geo.isLoading || !geo.data ? (
                      <div className="grid place-items-center py-8">{geo.error ? <p className="text-sm text-kenya-red">Couldn&apos;t load locations. Refresh to try again.</p> : <Spinner size="lg" />}</div>
                    ) : (
                      <LocationPicker tree={geo.data} stations={stations.data} stationsLoading={stations.isFetching} value={f.loc}
                        onChange={(v) => { set("loc", v); setErrors((e) => ({ ...e, ward_id: "", constituency_id: "" })); }} errors={errors} />
                    )}
                    <Input label={lang === "sw" ? "Nambari ya kadi ya mpiga kura" : "Voter card number"} hint={lang === "sw" ? "Si lazima" : "Optional"} value={f.voter_card_no} onChange={(e) => set("voter_card_no", e.target.value)} />
                  </section>
                )}

                {step === 2 && (
                  <section className="animate-fade-up space-y-4">
                    <div><h2 className="text-xl font-bold text-navy-900">{t.confirm}</h2><p className="text-sm text-slate-500">{t.confirmHint}</p></div>
                    <dl className="grid gap-2 rounded-2xl bg-slate-50 p-4 text-sm ring-1 ring-line sm:grid-cols-2">
                      {([[lang === "sw" ? "Jina" : "Name", f.full_name], [lang === "sw" ? "Simu" : "Phone", f.phone], [lang === "sw" ? "Wadi" : "Ward", `${wardName ?? "—"}${consName ? `, ${consName}` : ""}`], ["ID", `••••${f.national_id.slice(-4)}`]] as const).map(([k, v]) => (
                        <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold text-navy-900">{v}</dd></div>
                      ))}
                    </dl>
                    <label className={cn("flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition", f.consent ? "bg-kenya-green-50 ring-kenya-green/25" : errors.consent ? "bg-red-50 ring-kenya-red/30" : "bg-slate-50 ring-line")}>
                      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-kenya-green" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
                      <span className="text-sm text-navy-900">{t.consent}</span>
                    </label>
                    {errors.consent && <p className="text-sm font-medium text-kenya-red">{errors.consent}</p>}
                  </section>
                )}

                {errors.form && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{errors.form}</p>}

                <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
                  {step > 0 ? (
                    <Button type="button" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep(step - 1)}>{t.back}</Button>
                  ) : <span />}
                  <Button type="submit" variant="gold" size="lg" loading={busy} className="min-w-44">
                    {step < 2 ? <>{t.next} <ArrowRight className="size-4" /></> : t.submit}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Welcome({ t, name, ward, cons, link, code, onAgain }: {
  t: (typeof T)[Lang]; name: string; ward?: string; cons?: string; link: string; code: string | null; onAgain: () => void;
}) {
  const share = `https://wa.me/?text=${encodeURIComponent(`${t.shareText} ${link}`)}`;
  return (
    <div className="animate-fade-up p-6 sm:p-8">
      <div className="text-center">
        <h2 className="font-display text-3xl font-extrabold text-navy-900">{t.done}</h2>
        <p className="mt-2 text-slate-600">{t.doneLead}</p>
      </div>

      <div className="mt-6 grid items-center gap-6 sm:grid-cols-[1fr_auto]">
        {/* Digital supporter card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#06101f] via-[#0b1f3a] to-[#004d2d] p-6 text-white shadow-[0_24px_50px_-24px_rgba(6,16,31,.8)]">
          <div aria-hidden className="absolute inset-x-0 top-0 flex h-1.5"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
          <div aria-hidden className="pointer-events-none absolute -right-10 -bottom-16 size-56 rounded-full bg-gold/20 blur-3xl" />
          <div className="relative flex items-start justify-between">
            <BrandMark className="size-10" />
            <span className="rounded-full bg-gold px-3 py-1 text-xs font-extrabold tracking-wider text-navy-950 uppercase">{t.card}</span>
          </div>
          <p className="relative mt-8 font-display text-2xl leading-tight font-extrabold">{name}</p>
          <p className="relative mt-1 flex items-center gap-1.5 text-sm text-slate-300"><MapPin className="size-4 text-gold" />{ward ?? "Mombasa"}{cons ? `, ${cons}` : ""}</p>
          <div className="relative mt-6 flex items-end justify-between">
            <p className="text-xs tracking-[.2em] text-slate-400 uppercase">{CANDIDATE_NAME} · 2027</p>
            {code && <p className="font-mono text-sm font-bold tracking-widest text-gold">{code}</p>}
          </div>
        </div>
        {/* QR for posters / showing a friend */}
        <figure className="mx-auto text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered SVG QR */}
          <img src={apiUrl(`/portal/join-qr.svg${code ? `?ref=${code}` : ""}`)} alt={t.qr} className="size-40 rounded-2xl bg-white p-2 ring-1 ring-line" />
          <figcaption className="mt-2 text-xs font-semibold text-slate-500">{t.qr}</figcaption>
        </figure>
      </div>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <a href={share} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1fa463] px-4 py-3 text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgba(31,164,99,.9)] hover:brightness-110">
          <Share2 className="size-4" /> {t.share}
        </a>
        <button onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success(t.copied))}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-navy-900 hover:bg-slate-200">
          <Copy className="size-4" /> {t.copy}
        </button>
      </div>
      <p className="mt-2 truncate text-center font-mono text-xs text-slate-500">{link}</p>
      <div className="mt-6 text-center"><button onClick={onAgain} className="text-sm font-semibold text-ocean hover:underline">{t.again}</button></div>
    </div>
  );
}
