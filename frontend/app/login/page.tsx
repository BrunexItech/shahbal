"use client";

import { Fingerprint, KeyRound, Lock, Mail, MapPinned, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLoader, BrandMark } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { Button, Input } from "@/components/ui";
import { type MfaMethod, useAuth } from "@/lib/auth";
import { cancelPasskeyPrompt, passkeyErrorMessage, passkeySupport } from "@/lib/passkeys";
import { CAMPAIGN_NAME, CAMPAIGN_TAGLINE } from "@/lib/config";

/** Only same-site paths: never let ?next= bounce a user to another host (open redirect). */
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  const n = new URLSearchParams(window.location.search).get("next") ?? "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard";
}

export default function LoginPage() {
  const { login, verifyMfa, loginWithPasskey, user, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"password" | "passkey" | "code" | null>(null);
  const [mfa, setMfa] = useState<{ token: string; methods: MfaMethod[] } | null>(null);
  const [code, setCode] = useState("");
  const [support, setSupport] = useState({ webauthn: false, platform: false, autofill: false });

  useEffect(() => {
    if (ready && user) router.replace(safeNext());
  }, [ready, user, router]);

  useEffect(() => {
    void passkeySupport().then(setSupport);
  }, []);

  // Passkey autofill: the browser offers this site's passkeys right in the email field.
  useEffect(() => {
    if (!ready || user || mfa || !support.autofill) return;
    loginWithPasskey({ autofill: true })
      .then(() => router.replace(safeNext()))
      .catch((e) => {
        const msg = passkeyErrorMessage(e);
        if (!/Cancelled/.test(msg)) setError(msg);
      });
    return () => cancelPasskeyPrompt();
  }, [ready, user, mfa, support.autofill, loginWithPasskey, router]);

  if (!ready || user) return <BrandLoader message={user ? "Opening the war room" : "Checking your session"} />;

  const fail = (err: unknown) => {
    const msg = passkeyErrorMessage(err);
    if (mfa && /expired|start again/i.test(msg)) {
      setMfa(null);
      setCode("");
    }
    setError(msg);
    setBusy(null);
  };

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy("password");
    cancelPasskeyPrompt(); // stop the autofill ceremony while the password path runs
    try {
      const r = await login(email.trim(), password);
      if (!r.done) {
        setMfa({ token: r.mfaToken, methods: r.methods });
        setPassword("");
        setBusy(null);
        return;
      }
      router.replace(safeNext());
    } catch (err) {
      fail(err);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!mfa) return;
    setError("");
    setBusy("code");
    try {
      await verifyMfa(mfa.token, code);
      router.replace(safeNext());
    } catch (err) {
      fail(err);
    }
  }

  async function signInPasskey() {
    setError("");
    setBusy("passkey");
    cancelPasskeyPrompt();
    try {
      await loginWithPasskey({ mfaToken: mfa?.token });
      router.replace(safeNext());
    } catch (err) {
      fail(err);
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
          <div className="w-full max-w-sm animate-fade-up">
            <BrandMark className="mb-6 size-12 lg:hidden" />
            {mfa ? (
              <>
                <h2 className="text-2xl font-bold text-navy-900">Confirm it&apos;s you</h2>
                <p className="mt-1 text-sm text-muted">Your account is protected with two-step verification.</p>
                {mfa.methods.includes("passkey") && (
                  <Button size="lg" className="mt-8 w-full" loading={busy === "passkey"} icon={<Fingerprint className="size-5" />} onClick={signInPasskey}>
                    Use fingerprint, face or security key
                  </Button>
                )}
                {mfa.methods.includes("totp") && (
                  <form onSubmit={submitCode} className={mfa.methods.includes("passkey") ? "mt-6" : "mt-8"}>
                    <Input label={mfa.methods.includes("passkey") ? "Or enter an authenticator code" : "Authentication code"} required
                      autoFocus={!mfa.methods.includes("passkey")} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                      leading={<KeyRound className="size-4" />} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="123 456" className="[&_input]:tracking-[.4em]" />
                    <Button type="submit" variant="gold" size="lg" loading={busy === "code"} disabled={code.length !== 6} className="mt-4 w-full">
                      Verify & continue
                    </Button>
                  </form>
                )}
                {error && <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-kenya-red ring-1 ring-red-100">{error}</p>}
                <button type="button" onClick={() => { setMfa(null); setCode(""); setError(""); }}
                  className="mt-4 w-full text-center text-sm font-medium text-muted hover:text-navy-900">
                  ← Use a different account
                </button>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-navy-900">Welcome back</h2>
                <p className="mt-1 text-sm text-muted">Sign in to continue to the war room.</p>
                {support.webauthn && (
                  <>
                    <Button type="button" size="lg" variant="navy" className="mt-8 w-full" loading={busy === "passkey"}
                      icon={<Fingerprint className="size-5" />} onClick={signInPasskey}>
                      Sign in with fingerprint or face
                    </Button>
                    <div className="my-6 flex items-center gap-3 text-xs text-muted">
                      <span className="h-px flex-1 bg-line" /> or use your password <span className="h-px flex-1 bg-line" />
                    </div>
                  </>
                )}
                <form onSubmit={submitPassword} className={support.webauthn ? "" : "mt-8"}>
                  <div className="space-y-4">
                    <Input label="Email" type="email" autoComplete="username webauthn" required leading={<Mail className="size-4" />}
                      value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@campaign.co.ke" />
                    <Input label="Password" type="password" autoComplete="current-password" required leading={<Lock className="size-4" />}
                      value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  {error && <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-kenya-red ring-1 ring-red-100">{error}</p>}
                  <Button type="submit" variant="gold" size="lg" loading={busy === "password"} className="mt-6 w-full">Sign in</Button>
                </form>
              </>
            )}

            <div className="mt-8 rounded-2xl bg-slate-50 p-4 text-center text-sm text-muted ring-1 ring-line">
              Are you a voter?{" "}
              <Link href="/join" className="font-semibold text-kenya-green hover:underline">Join the movement →</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
