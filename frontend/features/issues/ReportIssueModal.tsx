"use client";

import { ImagePlus, LocateFixed, MapPin, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { useGeoTree } from "@/features/geo/api";
import { api, ApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { can } from "@/lib/roles";

import { useCreateIssue } from "./api";
import { CATEGORIES, type IssueCategory, type IssuePriority, PRIORITY } from "./meta";

/**
 * The team logs a problem a resident raised in person or on a call. Same case as a
 * website report: it goes to the ward team, and the resident can get SMS updates.
 */
export function ReportIssueModal({ onClose, defaults }: { onClose: () => void; defaults?: { ward_id?: string; reporter_name?: string; reporter_phone?: string; voter_id?: string } }) {
  const user = useUser();
  const tree = useGeoTree();
  const create = useCreateIssue();
  const wards = useMemo(() => tree.data?.flatMap((c) => c.wards.map((w) => ({ ...w, constituency: c.name }))) ?? [], [tree.data]);
  const [category, setCategory] = useState<IssueCategory | "">("");
  const [wardId, setWardId] = useState(defaults?.ward_id ?? user.ward_id ?? "");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState(defaults?.reporter_name ?? "");
  const [phone, setPhone] = useState(defaults?.reporter_phone ?? "");
  const [updates, setUpdates] = useState(true);
  const [consent, setConsent] = useState(false);
  const [priority, setPriority] = useState<IssuePriority>("normal");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPin({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); setLocating(false); },
      () => { setLocating(false); toast.error("Couldn't get your location"); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit() {
    const e: Record<string, string> = {};
    if (!category) e.category = "Choose what the problem is about";
    if (!wardId) e.ward_id = "Choose the ward";
    if (description.trim().length < 10) e.description = "Describe it in a sentence or two";
    if (updates && !phone.trim()) e.reporter_phone = "Add their number, or untick SMS updates";
    if (!consent) e.consent = "Confirm the resident agreed";
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setBusy(true);
    try {
      const issue = await create.mutateAsync({
        category: category as IssueCategory, ward_id: wardId, area: area || undefined, description, latitude: pin?.lat, longitude: pin?.lng,
        reporter_name: name || undefined, reporter_phone: phone || undefined, contact_ok: updates && !!phone.trim(), consent: true,
        priority: can.manageStations(user.role) ? priority : undefined, voter_id: defaults?.voter_id,
        client_ref: `iss-${crypto.randomUUID()}`,
      });
      for (const p of photos) {
        const form = new FormData();
        form.append("file", p);
        try { await api(`/issues/${issue.id}/photos`, { form }); } catch { toast.error("A photo didn't upload; add it from the case."); }
      }
      toast.success(`Logged as ${issue.reference}`, { description: "It's with the ward team now." });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err instanceof Error ? err.message : "Couldn't log the case");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Report a community issue" subtitle="Something a resident raised: water, roads, security, jobs…"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Log the issue</Button></>}>
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold text-navy-900">What is it about? <span className="text-kenya-red">*</span></p>
          <div role="radiogroup" className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={category === c.id} onClick={() => { setCategory(c.id); setErrors((x) => ({ ...x, category: "" })); }}
                className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-xs font-semibold ring-1 transition",
                  category === c.id ? "bg-navy-950 text-white ring-navy-950" : "text-navy-900 ring-line hover:bg-slate-50")}>
                <c.icon className={cn("size-5", category === c.id ? "text-gold" : "text-ocean")} />
                <span className="leading-tight">{c.en}</span>
              </button>
            ))}
          </div>
          {errors.category && <p className="mt-1 text-sm text-kenya-red">{errors.category}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Ward" required value={wardId} placeholder="Select ward" error={errors.ward_id} onChange={(e) => setWardId(e.target.value)}>
            {tree.data?.map((c) => <optgroup key={c.id} label={c.name}>{c.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>)}
          </Select>
          <Input label="Estate, street or landmark" value={area} maxLength={120} onChange={(e) => setArea(e.target.value)} />
        </div>
        {wards.length === 0 && tree.isLoading && <p className="text-xs text-slate-500">Loading wards…</p>}
        <Textarea label="What's the problem?" required rows={4} maxLength={2000} value={description} error={errors.description}
          onChange={(e) => setDescription(e.target.value)} placeholder="In the resident's words: what, since when, who it affects." />
        <div className="flex flex-wrap items-center gap-2">
          {pin ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-kenya-green-50 px-3 py-1.5 text-sm font-semibold text-kenya-green ring-1 ring-kenya-green/20">
              <MapPin className="size-4" /> Location added
              <button type="button" onClick={() => setPin(null)} aria-label="Remove location"><X className="size-4 text-slate-500" /></button>
            </span>
          ) : <Button type="button" size="sm" variant="secondary" loading={locating} icon={<LocateFixed className="size-4" />} onClick={locate}>Add my location (I&apos;m at the spot)</Button>}
          {photos.length < 6 && <Button type="button" size="sm" variant="secondary" icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>Add photo{photos.length ? ` (${photos.length})` : ""}</Button>}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhotos((p) => [...p, f]); e.target.value = ""; }} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Resident's name" hint="Optional" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Resident's phone" hint="Optional" type="tel" inputMode="tel" value={phone} error={errors.reporter_phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {can.manageStations(user.role) && (
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
            {(Object.keys(PRIORITY) as IssuePriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm text-navy-900">
          <input type="checkbox" className="size-4 accent-kenya-green" checked={updates} onChange={(e) => setUpdates(e.target.checked)} /> Send the resident SMS updates
        </label>
        <label className={cn("flex gap-3 rounded-2xl p-3.5 ring-1", consent ? "bg-kenya-green-50 ring-kenya-green/25" : errors.consent ? "bg-red-50 ring-kenya-red/30" : "bg-slate-50 ring-line")}>
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-kenya-green" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors((x) => ({ ...x, consent: "" })); }} />
          <span className="text-sm text-navy-900">The resident agreed that we record this to follow it up{phone ? ", and to be contacted about it" : ""}.</span>
        </label>
      </div>
    </Modal>
  );
}
