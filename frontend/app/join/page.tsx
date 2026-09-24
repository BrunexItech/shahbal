"use client";

import { Info, Lock } from "lucide-react";
import { useState } from "react";

import { BrandMark, Spinner } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { Button, Card, Input, Segmented } from "@/components/ui";
import { usePortalGeo, usePortalStations } from "@/features/geo/api";
import { LocationPicker, type LocationValue } from "@/features/geo/LocationPicker";
import { SuccessPanel } from "@/features/voters/components/SuccessPanel";
import { api, ApiError } from "@/lib/api";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";
import type { Gender } from "@/lib/types";

type Form = { full_name: string; phone: string; national_id: string; voter_card_no: string; gender: Gender | ""; birth_year: string; loc: LocationValue; consent: boolean; website: string };

const EMPTY: Form = { full_name: "", phone: "", national_id: "", voter_card_no: "", gender: "", birth_year: "", loc: { constituency_id: "", ward_id: "", station_id: "" }, consent: false, website: "" };

export default function JoinPage() {
  const geo = usePortalGeo();
  const [f, setF] = useState<Form>(EMPTY);
  const stations = usePortalStations(f.loc.ward_id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  function validate() {
    const e: Record<string, string> = {};
    if (f.full_name.trim().split(/\s+/).length < 2) e.full_name = "Enter at least two names";
    if (!/^(\+?254|0)?[17]\d{8}$/.test(f.phone.replace(/\s/g, ""))) e.phone = "Enter a valid Kenyan mobile number";
    if (!/^\d{6,12}$/.test(f.national_id)) e.national_id = "Enter your national ID number (digits only)";
    if (!f.loc.ward_id) e.ward_id = "Select your ward";
    if (!f.loc.constituency_id) e.constituency_id = "Select your constituency";
    if (!f.consent) e.consent = "Please tick to agree before submitting";
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/portal/signup", {
        silent401: true,
        body: {
          full_name: f.full_name, phone: f.phone, national_id: f.national_id,
          voter_card_no: f.voter_card_no || undefined, gender: f.gender || undefined,
          birth_year: f.birth_year ? +f.birth_year : undefined,
          ward_id: f.loc.ward_id, station_id: f.loc.station_id || undefined,
          consent: true, website: f.website || undefined,
        },
      });
      setDone(r.message);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setErrors((x) => ({ ...x, form: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Hero */}
      <header className="relative overflow-hidden bg-navy-950 pb-28 text-white">
        <FlagStripe />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_0%,rgba(11,127,166,.4),transparent_55%),radial-gradient(ellipse_at_0%_100%,rgba(201,162,39,.2),transparent_50%)]" />
        <div className="relative mx-auto max-w-2xl px-5 pt-8">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <div><p className="font-display font-bold">{CAMPAIGN_NAME}</p><p className="text-xs text-slate-400">Supporter sign-up · {CANDIDATE_NAME} for Mombasa</p></div>
          </div>
          <h1 className="mt-10 text-4xl leading-tight font-extrabold sm:text-5xl">Join the movement, <span className="text-gold">Mombasa.</span></h1>
          <p className="mt-3 max-w-lg text-slate-300">Leave your details and we&apos;ll keep you updated when the team is visiting your ward. We&apos;ll also remind you on voting day.</p>
        </div>
      </header>

      <main className="relative mx-auto -mt-20 max-w-2xl px-4 pb-16">
        <Card className="overflow-hidden">
          {done ? (
            <SuccessPanel title="Asante sana!" actions={<Button variant="secondary" size="lg" onClick={() => { setF(EMPTY); setDone(null); }}>Register someone else</Button>}>
              <p>{done}</p>
            </SuccessPanel>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-6 p-6 sm:p-8">
              <div className="flex gap-3 rounded-2xl bg-ocean-50 p-4 text-sm text-navy-900 ring-1 ring-ocean/15">
                <Info className="mt-0.5 size-4 shrink-0 text-ocean" />
                <p>
                  <b>This is a campaign sign-up, not IEBC voter registration.</b> To register as a voter or check your registration,
                  use IEBC&apos;s official channels.
                </p>
              </div>

              {/* Honeypot: invisible to people, irresistible to bots. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)}
                className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />

              <section className="space-y-4">
                <h2 className="text-lg font-bold text-navy-900">About you</h2>
                <Input label="Full names" required value={f.full_name} error={errors.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="name" placeholder="As on your ID" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Mobile number" required type="tel" inputMode="tel" autoComplete="tel" value={f.phone} error={errors.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0712 345 678" />
                  <Input label="National ID number" required inputMode="numeric" value={f.national_id} error={errors.national_id}
                    onChange={(e) => set("national_id", e.target.value.replace(/\D/g, ""))} autoComplete="off" />
                  <Segmented<Gender> label="Gender" value={f.gender} onChange={(v) => set("gender", v)} options={[{ value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
                  <Input label="Year of birth" inputMode="numeric" maxLength={4} value={f.birth_year} error={errors.birth_year}
                    onChange={(e) => set("birth_year", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1994" />
                </div>
                <Input label="Voter card number" hint="Optional" value={f.voter_card_no} onChange={(e) => set("voter_card_no", e.target.value)} />
              </section>

              <section className="space-y-4">
                <h2 className="text-lg font-bold text-navy-900">Where you vote</h2>
                {geo.isLoading || !geo.data ? (
                  <div className="grid place-items-center py-8">{geo.error ? <p className="text-sm text-kenya-red">Couldn&apos;t load locations. Refresh to try again.</p> : <Spinner size="lg" />}</div>
                ) : (
                  <LocationPicker tree={geo.data} stations={stations.data} stationsLoading={stations.isFetching} value={f.loc}
                    onChange={(v) => { set("loc", v); setErrors((e) => ({ ...e, ward_id: "", constituency_id: "" })); }} errors={errors} />
                )}
              </section>

              <label className={`flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition ${f.consent ? "bg-kenya-green-50 ring-kenya-green/25" : errors.consent ? "bg-red-50 ring-kenya-red/30" : "bg-slate-50 ring-line"}`}>
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-kenya-green" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
                <span className="text-sm text-navy-900">
                  I agree that {CAMPAIGN_NAME} may store these details and contact me by SMS, WhatsApp or phone about the campaign.
                  I can opt out at any time by replying <b>STOP</b>.
                </span>
              </label>

              {errors.form && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{errors.form}</p>}

              <Button type="submit" variant="gold" size="lg" loading={busy} className="w-full">Count me in</Button>
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" /> Your ID number is encrypted and never shared.</p>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}
