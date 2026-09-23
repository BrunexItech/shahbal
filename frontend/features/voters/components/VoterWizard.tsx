"use client";

import { AlertTriangle, LocateFixed, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DotLoader, Spinner } from "@/components/loaders";
import { Button, Card, Input, Segmented, SUPPORT, Textarea } from "@/components/ui";
import { useGeoTree, useStations } from "@/features/geo/api";
import { LocationPicker, type LocationValue } from "@/features/geo/LocationPicker";
import { checkDuplicate, useCreateVoter, type VoterInput } from "@/features/voters/api";
import { Stepper } from "@/features/voters/components/Stepper";
import { SuccessPanel } from "@/features/voters/components/SuccessPanel";
import { ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Gender, Support, Voter } from "@/lib/types";

const STEPS = ["Personal", "ID & Contact", "Location", "Review"];
const DRAFT_KEY = "chq.capture-draft";

type Form = {
  full_name: string;
  gender: Gender | "";
  birth_year: string;
  national_id: string;
  voter_card_no: string;
  phone: string;
  loc: LocationValue;
  support: Support;
  notes: string;
  consent: boolean;
  gps?: { lat: number; lng: number };
};

const EMPTY: Form = {
  full_name: "", gender: "", birth_year: "", national_id: "", voter_card_no: "", phone: "",
  loc: { constituency_id: "", ward_id: "", station_id: "" }, support: "unknown", notes: "", consent: false,
};

type Errors = Partial<Record<string, string>>;

// Client-side checks mirror the API so agents get instant feedback; the API stays authoritative.
function validate(step: number, f: Form): Errors {
  const e: Errors = {};
  const maxYear = new Date().getFullYear() - 18;
  if (step === 0) {
    if (f.full_name.trim().split(/\s+/).length < 2) e.full_name = "Enter at least two names";
    if (f.birth_year && (+f.birth_year < 1900 || +f.birth_year > maxYear)) e.birth_year = `Must be 1900–${maxYear} (18+)`;
  }
  if (step === 1) {
    if (!/^\d{6,12}$/.test(f.national_id)) e.national_id = "6–12 digits";
    if (!/^(\+?254|0)?[17]\d{8}$/.test(f.phone.replace(/\s/g, ""))) e.phone = "Enter a valid Kenyan mobile number";
  }
  if (step === 2) {
    if (!f.loc.constituency_id) e.constituency_id = "Required";
    if (!f.loc.ward_id) e.ward_id = "Required";
  }
  if (step === 3 && !f.consent) e.consent = "Consent is required";
  return e;
}

function loadDraft(): Form | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw), consent: false } : null;
  } catch {
    return null;
  }
}

export function VoterWizard() {
  const user = useUser();
  const { data: tree, isLoading: treeLoading } = useGeoTree();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [dup, setDup] = useState<{ checking: boolean; hit?: { reference?: string; full_name?: string; ward_name?: string } }>({ checking: false });
  const [created, setCreated] = useState<Voter | null>(null);
  const [locating, setLocating] = useState(false);
  const restored = useRef(false);
  const create = useCreateVoter();
  const stations = useStations(form.loc.ward_id || undefined, undefined, !!form.loc.ward_id);

  // Agents pinned to one ward: preselect and lock it.
  const lockedWardId = user.role === "field_agent" || user.role === "ward_coordinator" ? user.ward_id : null;
  useEffect(() => {
    if (!tree || !lockedWardId) return;
    const c = tree.find((c) => c.wards.some((w) => w.id === lockedWardId));
    if (c) setForm((f) => ({ ...f, loc: { ...f.loc, constituency_id: c.id, ward_id: lockedWardId } }));
  }, [tree, lockedWardId]);

  // Restore an unsent draft once (poor signal in the field shouldn't cost a record).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const d = loadDraft();
    if (d && (d.full_name || d.national_id)) {
      setForm(d);
      toast.info("Restored your unsent draft");
    }
  }, []);
  useEffect(() => {
    if (created) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, consent: false }));
    } catch {}
  }, [form, created]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function runDuplicateCheck(id: string) {
    if (!/^\d{6,12}$/.test(id)) return setDup({ checking: false });
    setDup({ checking: true });
    try {
      const r = await checkDuplicate(id);
      setDup({ checking: false, hit: r.exists ? r : undefined });
    } catch {
      setDup({ checking: false });
    }
  }

  function next() {
    const e = validate(step, form);
    if (step === 1 && dup.hit) e.national_id = "Already registered";
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => s + 1);
  }

  function captureGps() {
    if (!navigator.geolocation) return toast.error("Location isn't available on this device");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set("gps", { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) });
        setLocating(false);
      },
      () => {
        toast.error("Couldn't get your location");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }

  async function submit() {
    const e = validate(3, form);
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: VoterInput = {
      full_name: form.full_name,
      phone: form.phone,
      national_id: form.national_id,
      voter_card_no: form.voter_card_no || undefined,
      gender: form.gender || undefined,
      birth_year: form.birth_year ? +form.birth_year : undefined,
      ward_id: form.loc.ward_id,
      station_id: form.loc.station_id || undefined,
      support: form.support,
      notes: form.notes || undefined,
      consent: true,
      capture_lat: form.gps?.lat,
      capture_lng: form.gps?.lng,
    };
    try {
      const v = await create.mutateAsync(body);
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {}
      setCreated(v);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        setStep(err.fields.full_name || err.fields.birth_year ? 0 : err.fields.phone || err.fields.national_id ? 1 : 2);
      }
      toast.error(err instanceof Error ? err.message : "Could not save");
    }
  }

  function reset() {
    setCreated(null);
    setStep(0);
    setDup({ checking: false });
    setForm((f) => ({ ...EMPTY, loc: lockedWardId ? { ...f.loc, station_id: "" } : EMPTY.loc }));
  }

  const review = useMemo(() => {
    const c = tree?.find((c) => c.id === form.loc.constituency_id);
    const w = c?.wards.find((w) => w.id === form.loc.ward_id);
    const s = stations.data?.find((s) => s.id === form.loc.station_id);
    return [
      ["Full names", form.full_name],
      ["Gender", form.gender || "—"],
      ["Year of birth", form.birth_year || "—"],
      ["National ID", form.national_id ? `••••${form.national_id.slice(-4)}` : "—"],
      ["Voter card no.", form.voter_card_no || "—"],
      ["Phone", form.phone],
      ["Constituency", c?.name ?? "—"],
      ["Ward", w?.name ?? "—"],
      ["Polling station", s ? `${s.name} (${s.code})` : "—"],
      ["Support level", SUPPORT[form.support][1]],
      ["GPS", form.gps ? `${form.gps.lat}, ${form.gps.lng}` : "Not captured"],
    ];
  }, [form, tree, stations.data]);

  if (created) {
    return (
      <Card className="mx-auto max-w-2xl">
        <SuccessPanel
          title="Voter captured"
          actions={
            <>
              <Button size="lg" onClick={reset}>Capture another voter</Button>
              <Link href={`/voters/${created.id}`} className="w-full"><Button size="lg" variant="secondary" className="w-full">View record</Button></Link>
            </>
          }
        >
          <p>{created.full_name} has been saved and is queued for verification.</p>
          <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-line">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Reference</p>
            <p className="font-display text-2xl font-bold tracking-wide text-navy-900">{created.reference}</p>
          </div>
        </SuccessPanel>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <div className="border-b border-line bg-gradient-to-b from-slate-50 to-white px-6 py-5">
        <Stepper steps={STEPS} current={step} />
      </div>

      <div key={step} className="animate-fade-up px-6 py-6">
        {step === 0 && (
          <div className="space-y-5">
            <StepTitle title="Personal details" hint="As written on their national ID." />
            <Input label="Full names" required autoFocus value={form.full_name} error={errors.full_name}
              onChange={(e) => set("full_name", e.target.value)} placeholder="e.g. Amina Wanjiku Hassan" autoComplete="off" />
            <div className="grid gap-5 sm:grid-cols-2">
              <Segmented<Gender> label="Gender" value={form.gender} onChange={(v) => set("gender", v)}
                options={[{ value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
              <Input label="Year of birth" inputMode="numeric" maxLength={4} value={form.birth_year} error={errors.birth_year}
                onChange={(e) => set("birth_year", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1994" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <StepTitle title="ID & contact" hint="The national ID is encrypted and only the last 4 digits are shown to the team." />
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Input label="National ID number" required inputMode="numeric" autoFocus value={form.national_id} error={errors.national_id}
                  onChange={(e) => { set("national_id", e.target.value.replace(/\D/g, "")); setDup({ checking: false }); }}
                  onBlur={(e) => runDuplicateCheck(e.target.value)} placeholder="e.g. 12345678" autoComplete="off" />
                <div className="mt-2 min-h-5 text-xs">
                  {dup.checking && <span className="inline-flex items-center gap-2 text-muted"><DotLoader /> Checking for duplicates</span>}
                  {!dup.checking && dup.hit && (
                    <span className="inline-flex items-start gap-1.5 font-medium text-kenya-red">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      Already registered as {dup.hit.full_name} ({dup.hit.reference}) in {dup.hit.ward_name}
                    </span>
                  )}
                  {!dup.checking && !dup.hit && /^\d{6,12}$/.test(form.national_id) && (
                    <span className="inline-flex items-center gap-1.5 font-medium text-kenya-green"><ShieldCheck className="size-3.5" /> No existing record</span>
                  )}
                </div>
              </div>
              <Input label="Voter card number" value={form.voter_card_no} onChange={(e) => set("voter_card_no", e.target.value)}
                hint="Optional" placeholder="If available" autoComplete="off" />
            </div>
            <Input label="Mobile number" required type="tel" inputMode="tel" value={form.phone} error={errors.phone}
              onChange={(e) => set("phone", e.target.value)} placeholder="0712 345 678"
              leading={<span className="text-xs font-semibold text-slate-500">🇰🇪</span>} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <StepTitle title="Voting location" hint="Where this voter is registered to vote." />
            {treeLoading || !tree ? (
              <div className="grid place-items-center py-10"><Spinner size="lg" /></div>
            ) : (
              <LocationPicker tree={tree} stations={stations.data} stationsLoading={stations.isFetching}
                value={form.loc} onChange={(v) => { set("loc", v); setErrors({}); }} errors={errors} lockedWardId={lockedWardId} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ocean-50 px-4 py-3 ring-1 ring-ocean/15">
              <div className="text-sm">
                <p className="font-semibold text-navy-900">Stamp capture location</p>
                <p className="text-xs text-muted">{form.gps ? `${form.gps.lat}, ${form.gps.lng}` : "Helps map field coverage. Optional."}</p>
              </div>
              <Button type="button" variant="secondary" size="sm" loading={locating} onClick={captureGps} icon={<LocateFixed className="size-4" />}>
                {form.gps ? "Refresh" : "Use my location"}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <StepTitle title="Review & submit" hint="Confirm the details with the voter before saving." />
            <dl className="divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line">
              {review.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5 text-sm sm:grid-cols-[180px_1fr]">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-medium text-navy-900 capitalize">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="mb-2 text-[13px] font-semibold text-navy-900">Support level</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SUPPORT) as Support[]).map((s) => (
                  <button key={s} type="button" onClick={() => set("support", s)}
                    className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition",
                      form.support === s ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-slate-600 ring-line hover:ring-slate-300")}>
                    {SUPPORT[s][1]}
                  </button>
                ))}
              </div>
            </div>
            <Textarea label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Issues raised, follow-up needed… (internal)" rows={3} />
            <label className={cn("flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition",
              form.consent ? "bg-kenya-green-50 ring-kenya-green/25" : errors.consent ? "bg-red-50 ring-kenya-red/30" : "bg-slate-50 ring-line")}>
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-kenya-green" checked={form.consent}
                onChange={(e) => set("consent", e.target.checked)} />
              <span className="text-sm text-navy-900">
                I confirm the information is correct and that the voter <b>agreed</b> to share it with the campaign and to receive
                campaign messages. They can opt out at any time.
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-slate-50/60 px-6 py-4">
        <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || create.isPending}>Back</Button>
        {step < 3 ? (
          <Button onClick={next} variant="navy" className="min-w-32" disabled={step === 1 && dup.checking}>Continue</Button>
        ) : (
          <Button onClick={submit} variant="gold" className="min-w-40" loading={create.isPending}>Submit for verification</Button>
        )}
      </div>
    </Card>
  );
}

function StepTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-navy-900">{title}</h2>
      <p className="text-sm text-muted">{hint}</p>
    </div>
  );
}
