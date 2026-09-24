"use client";

import { KeyRound, Lock, Mail, MapPinned, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLoader, BrandMark } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CAMPAIGN_NAME, CAMPAIGN_TAGLINE } from "@/lib/config";

/** Only same-site paths: never let ?next= bounce a user to another host (open redirect). */
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  const n = new URLSearchParams(window.location.search).get("next") ?? "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard";
}

export default function LoginPage() {
  const { login, verifyMfa, user, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (ready && user) router.replace(safeNext());
  }, [ready, user, router]);

  if (!ready || user) return <BrandLoader message={user ? "Opening the war room" : "Checking your session"} />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, code);
      } else {
        const r = await login(email.trim(), password);
        if (!r.done) {
          setMfaToken(r.mfaToken);
          setPassword("");
          setBusy(false);
          return;
        }
      }
      router.replace(safeNext());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      if (mfaToken && /expired|start again/i.test(msg)) {
        setMfaToken(null);
        setCode("");
      }
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-navy-950 lg:flex lg:flex-col">
        <FlagStripe />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(11,127,166,.35),transparent_50%),radial-gradient(ellipse_at_90%_90%,rgba(201,162,39,.18),transparent_45%)]" />
        <svg className="pointer-events-none absolute right-0 bottom-0 w-full opacity-[.07]" viewBox="0 0 800 200" preserveAspectRatio="none" aria-hidden>
          <path d="M0 120 Q100 80 200 120 T400 120 T600 120 T800 120 V200 H0Z" fill="#fff" />
          <path d="M0 150 Q100 110 200 150 T400 150 T600 150 T800 150 V200 H0Z" fill="#fff" />
        </svg>
        <div className="relative flex flex-1 flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <BrandMark className="size-12" />
            <div>
              <p className="font-display text-lg font-bold text-white">{CAMPAIGN_NAME}</p>
              <p className="text-sm text-slate-400">{CAMPAIGN_TAGLINE}</p>
            </div>
          </div>
          <div className="max-w-lg">
            <p className="text-xs font-semibold tracking-[.2em] text-gold uppercase">Command centre</p>
            <h1 className="mt-3 text-4xl leading-tight font-extrabold text-white xl:text-5xl">
              Every ward. Every station. <span className="text-gold">Every voice.</span>
            </h1>
            <p className="mt-4 text-slate-400">
              Capture supporters in the field, track targets ward by ward, and see the whole campaign move in real time.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-4">
              {[
                { icon: MapPinned, k: "6", v: "Constituencies" },
                { icon: Users, k: "30", v: "Wards" },
                { icon: ShieldCheck, k: "AES", v: "Encrypted IDs" },
              ].map(({ icon: Icon, k, v }) => (
                <div key={v} className="rounded-2xl border border-white/10 bg-white/[.04] p-4 backdrop-blur">
                  <Icon className="size-5 text-gold" />
                  <p className="mt-3 font-display text-2xl font-bold text-white">{k}</p>
                  <p className="text-xs text-slate-400">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500">Authorised campaign staff only. All activity is audited.</p>
        </div>
      </section>

      {/* Form */}
      <section className="flex flex-col bg-white">
        <FlagStripe className="lg:hidden" />
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <form onSubmit={submit} className="w-full max-w-sm animate-fade-up">
            <BrandMark className="mb-6 size-12 lg:hidden" />
            {mfaToken ? (
              <>
                <h2 className="text-2xl font-bold text-navy-900">Two-step verification</h2>
                <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
                <div className="mt-8">
                  <Input label="Authentication code" required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    leading={<KeyRound className="size-4" />} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123 456" className="[&_input]:tracking-[.4em]" />
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-navy-900">Welcome back</h2>
                <p className="mt-1 text-sm text-muted">Sign in to continue to the war room.</p>
                <div className="mt-8 space-y-4">
                  <Input label="Email" type="email" autoComplete="email" required leading={<Mail className="size-4" />}
                    value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@campaign.co.ke" />
                  <Input label="Password" type="password" autoComplete="current-password" required leading={<Lock className="size-4" />}
                    value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
              </>
            )}

            {error && <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-kenya-red ring-1 ring-red-100">{error}</p>}

            <Button type="submit" variant="gold" size="lg" loading={busy} disabled={!!mfaToken && code.length !== 6} className="mt-6 w-full">
              {mfaToken ? "Verify & continue" : "Sign in"}
            </Button>
            {mfaToken && (
              <button type="button" onClick={() => { setMfaToken(null); setCode(""); setError(""); }}
                className="mt-3 w-full text-center text-sm font-medium text-muted hover:text-navy-900">
                ← Use a different account
              </button>
            )}

            <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-center text-sm text-muted ring-1 ring-line">
              Are you a voter?{" "}
              <Link href="/join" className="font-semibold text-kenya-green hover:underline">Join the movement →</Link>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
