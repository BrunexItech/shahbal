"use client";

import { Camera, Check, ImagePlus, Lock, Mail, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { BrandMark, Spinner } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { Button, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";
import { type Portal, PORTAL_LOGIN, rememberPortal } from "@/lib/portal";

type Preview = { first_name: string; email_hint: string; role_label: string; photo_required: boolean; expires_at: string; portal: Portal };

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Portal | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  useEffect(() => {
    api<Preview>(`/invites/${encodeURIComponent(token)}`, { silent401: true })
      .then(setPreview)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "This invitation can't be opened."));
  }, [token]);

  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const rules = [
    { ok: password.length >= 10, text: "At least 10 characters" },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), text: "Letters and numbers" },
    { ok: !!password && (!local || !password.toLowerCase().includes(local)), text: "Doesn't contain your email name" },
  ];
  const ready = !!email && rules.every((r) => r.ok) && password === confirm && (!preview?.photo_required || !!photo);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("email", email.trim());
    form.append("password", password);
    if (photo) form.append("photo", photo);
    try {
      const r = await api<{ portal: Portal }>(`/invites/${encodeURIComponent(token)}/accept`, { form, silent401: true });
      rememberPortal(r.portal);
      setDone(r.portal);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="relative overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-[#00593a] pb-24 text-white">
        <FlagStripe />
        <div className="relative mx-auto flex max-w-lg items-center gap-3 px-6 pt-8">
          <BrandMark className="size-11" />
          <div>
            <p className="font-display text-lg font-bold">{CAMPAIGN_NAME}</p>
            <p className="text-xs text-white/70">{CANDIDATE_NAME} · Mombasa 2027</p>
          </div>
        </div>
        {preview && !done && (
          <div className="relative mx-auto mt-8 max-w-lg px-6">
            <h1 className="text-3xl font-extrabold">Karibu, {preview.first_name}</h1>
            <p className="mt-1 text-white/80">You&apos;ve been invited to join the team as <b className="text-gold">{preview.role_label}</b>.</p>
          </div>
        )}
      </header>

      <main className="relative mx-auto -mt-16 w-full max-w-lg flex-1 px-4 pb-12">
        <div className="animate-fade-up rounded-3xl bg-white p-6 shadow-xl ring-1 ring-line sm:p-8">
          {!preview && !loadError && <div className="grid place-items-center py-16"><Spinner size="lg" /></div>}
          {loadError && (
            <div className="py-8 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-50 text-kenya-red"><X className="size-7" /></span>
              <h2 className="mt-4 text-xl font-bold text-navy-900">This link can&apos;t be used</h2>
              <p className="mt-1 text-slate-600">{loadError}</p>
            </div>
          )}
          {done && (
            <div className="py-6 text-center">
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-kenya-green text-white shadow-lg shadow-kenya-green/30"><Check className="size-8" strokeWidth={3} /></span>
              <h2 className="mt-4 text-2xl font-bold text-navy-900">You&apos;re all set</h2>
              <p className="mt-1 text-slate-600">Your account is active. Sign in with your email and new password.</p>
              <Link href={PORTAL_LOGIN[done]} className="mt-6 block"><Button size="lg" className="w-full">Continue to sign in</Button></Link>
            </div>
          )}
          {preview && !done && (
            <form onSubmit={submit} className="space-y-6">
              <section>
                <h2 className="text-lg font-bold text-navy-900">1 · Confirm your email</h2>
                <p className="mb-3 text-sm text-muted">Type the email this invitation was sent to ({preview.email_hint}).</p>
                <Input label="Email" type="email" required autoComplete="email" leading={<Mail className="size-4" />} value={email} onChange={(e) => setEmail(e.target.value)} />
              </section>

              <section>
                <h2 className="text-lg font-bold text-navy-900">2 · Create your password</h2>
                <div className="mt-3 grid gap-4">
                  <Input label="Password" type="password" required autoComplete="new-password" leading={<Lock className="size-4" />} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Input label="Confirm password" type="password" required autoComplete="new-password" leading={<Lock className="size-4" />} value={confirm}
                    error={confirm && confirm !== password ? "Passwords don't match" : undefined} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                <ul className="mt-3 space-y-1 text-sm">
                  {rules.map((r) => (
                    <li key={r.text} className={cn("flex items-center gap-2", r.ok ? "text-kenya-green" : "text-muted")}>
                      <span className={cn("grid size-4 place-items-center rounded-full", r.ok ? "bg-kenya-green text-white" : "bg-slate-200")}>{r.ok && <Check className="size-3" strokeWidth={3} />}</span>
                      {r.text}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-bold text-navy-900">3 · Your profile photo {!preview.photo_required && <span className="text-sm font-normal text-muted">(optional)</span>}</h2>
                <p className="mb-4 text-sm text-muted">A clear photo of your face, so HQ and voters can recognise you in the field.</p>
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className={cn("grid size-32 shrink-0 place-items-center overflow-hidden rounded-full ring-4", photo ? "ring-kenya-green/30" : "bg-slate-100 ring-slate-100")}>
                    {photoUrl ? <img src={photoUrl} alt="Your photo" className="size-full object-cover" /> : <Camera className="size-10 text-slate-300" />}
                  </div>
                  <div className="flex w-full flex-col gap-2">
                    <Button type="button" icon={<Camera className="size-4" />} onClick={() => camera.current?.click()}>{photo ? "Retake photo" : "Take a photo"}</Button>
                    <Button type="button" variant="secondary" icon={<ImagePlus className="size-4" />} onClick={() => gallery.current?.click()}>Choose from gallery</Button>
                  </div>
                  <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => e.target.files?.[0] && setPhoto(e.target.files[0])} />
                  <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && setPhoto(e.target.files[0])} />
                </div>
                <p className="mt-3 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-px size-4 shrink-0 text-kenya-green" /> Location data is removed from your photo, and it&apos;s stored encrypted. Only campaign HQ and your coordinators can see it.</p>
              </section>

              {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-kenya-red ring-1 ring-red-100">{error}</p>}
              <Button type="submit" size="lg" variant="gold" className="w-full" loading={busy} disabled={!ready}>Activate my account</Button>
              <p className="text-center text-xs text-muted">This link works once and expires {new Date(preview.expires_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}.</p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
