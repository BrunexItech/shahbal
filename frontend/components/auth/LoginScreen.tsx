"use client";

import { Fingerprint, KeyRound, Lock, Mail, Radar, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLoader, BrandMark } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { Button, Input } from "@/components/ui";
import { type MfaMethod, useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";
import { cancelPasskeyPrompt, passkeyErrorMessage, passkeySupport } from "@/lib/passkeys";
import { type Portal, rememberPortal } from "@/lib/portal";

/** Only same-site paths: never let ?next= bounce a user to another host (open redirect). */
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  const n = new URLSearchParams(window.location.search).get("next") ?? "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard";
}

const COPY: Record<Portal, { eyebrow: string; title: string; sub: string; note: string }> = {
  command: {
    eyebrow: "Command Centre",
    title: "HQ sign-in",
    sub: "Restricted to HQ, constituency and ward leadership.",
    note: "Field agents and call centre staff: use the field team sign-in.",
  },
  field: {
    eyebrow: "Field Team",
    title: "Karibu, team",
    sub: "Sign in to capture supporters, run visits and make calls.",
    note: "",
  },
};

/**
 * One secure sign-in engine (password, second factor, passkey, passkey autofill),
 * two separate doors. The server enforces which roles each portal admits.
 */
export function LoginScreen({ portal }: { portal: Portal }) {
  const { login, verifyMfa, loginWithPasskey, user, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // Arrived here after an idle sign-out: say so, so nobody thinks something broke.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("reason") === "idle")
      setError("You were signed out after a period of inactivity. Sign in again to continue.");
  }, []);
  const [busy, setBusy] = useState<"password" | "passkey" | "code" | null>(null);
  const [mfa, setMfa] = useState<{ token: string; methods: MfaMethod[] } | null>(null);
  const [code, setCode] = useState("");
  const [support, setSupport] = useState({ webauthn: false, platform: false, autofill: false });
  const copy = COPY[portal];
  const hq = portal === "command";

  useEffect(() => rememberPortal(portal), [portal]);
  useEffect(() => {
    if (ready && user) router.replace(safeNext());
  }, [ready, user, router]);
  useEffect(() => void passkeySupport().then(setSupport), []);

  // Passkey autofill: the browser offers this site's passkeys right in the email field.
  useEffect(() => {
    if (!ready || user || mfa || !support.autofill) return;
    loginWithPasskey({ portal, autofill: true })
      .then(() => router.replace(safeNext()))
      .catch((e) => {
        // Autofill runs quietly in the background: browser/device limitations (no passkey
        // here, unsupported mode) are not the user's problem. Only a real answer from our
        // server, after they picked a passkey, is worth showing.
        if (e instanceof ApiError) setError(passkeyErrorMessage(e));
      });
    return () => cancelPasskeyPrompt();
  }, [ready, user, mfa, support.autofill, loginWithPasskey, router, portal]);

  if (!ready || user) return <BrandLoader message={user ? "Opening your workspace" : "Checking your session"} />;

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
    cancelPasskeyPrompt();
    try {
      const r = await login(email.trim(), password, portal);
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
      await verifyMfa(mfa.token, code, portal);
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
      await loginWithPasskey({ portal, mfaToken: mfa?.token });
      router.replace(safeNext());
    } catch (err) {
      fail(err);
    }
  }

  const errorBox = error && (
    <p className={cn("mt-4 rounded-xl px-3.5 py-2.5 text-sm font-medium ring-1", hq ? "bg-red-500/10 text-red-300 ring-red-500/30" : "bg-red-50 text-kenya-red ring-red-100")}>{error}</p>
  );
  const inputSkin = hq ? "[&_input]:border-white/10 [&_input]:bg-white/[.04] [&_input]:text-white [&_input]:placeholder:text-slate-500 [&_label]:text-slate-300" : "";

  const form = mfa ? (
    <>
      <h2 className={cn("text-2xl font-bold", hq ? "text-white" : "text-navy-900")}>Confirm it&apos;s you</h2>
      <p className={cn("mt-1 text-sm", hq ? "text-slate-400" : "text-muted")}>Your account is protected with two-step verification.</p>
      {mfa.methods.includes("passkey") && (
        <Button size="lg" variant={hq ? "gold" : "primary"} className="mt-8 w-full" loading={busy === "passkey"} icon={<Fingerprint className="size-5" />} onClick={signInPasskey}>
          <span className="min-[400px]:hidden">Fingerprint, face or key</span>
          <span className="hidden min-[400px]:inline">Use fingerprint, face or security key</span>
        </Button>
      )}
      {mfa.methods.includes("totp") && (
        <form onSubmit={submitCode} className={cn(mfa.methods.includes("passkey") ? "mt-6" : "mt-8", inputSkin)}>
          <Input label={mfa.methods.includes("passkey") ? "Or enter an authenticator code" : "Authentication code"} required
            autoFocus={!mfa.methods.includes("passkey")} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            leading={<KeyRound className="size-4" />} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123 456" className="[&_input]:tracking-[.4em]" />
          <Button type="submit" variant={hq ? "gold" : "primary"} size="lg" loading={busy === "code"} disabled={code.length !== 6} className="mt-4 w-full">
            Verify & continue
          </Button>
        </form>
      )}
      {errorBox}
      <button type="button" onClick={() => { setMfa(null); setCode(""); setError(""); }}
        className={cn("mt-4 w-full text-center text-sm font-medium", hq ? "text-slate-400 hover:text-white" : "text-muted hover:text-navy-900")}>
        ← Use a different account
      </button>
    </>
  ) : (
    <>
      <p className={cn("text-xs font-semibold tracking-[.2em] uppercase", hq ? "text-gold" : "text-kenya-green")}>{copy.eyebrow}</p>
      <h2 className={cn("mt-2 text-3xl font-bold", hq ? "text-white" : "text-navy-900")}>{copy.title}</h2>
      <p className={cn("mt-1 text-sm", hq ? "text-slate-400" : "text-muted")}>{copy.sub}</p>
      {support.webauthn && (
        <>
          <Button type="button" size="lg" variant={hq ? "gold" : "primary"} className="mt-8 w-full" loading={busy === "passkey"}
            icon={<Fingerprint className="size-5" />} onClick={signInPasskey}>
            <span className="min-[380px]:hidden">Fingerprint or face</span>
            <span className="hidden min-[380px]:inline">Sign in with fingerprint or face</span>
          </Button>
          <div className={cn("my-6 flex items-center gap-3 text-xs", hq ? "text-slate-500" : "text-muted")}>
            <span className={cn("h-px flex-1", hq ? "bg-white/10" : "bg-line")} /> or use your password <span className={cn("h-px flex-1", hq ? "bg-white/10" : "bg-line")} />
          </div>
        </>
      )}
      <form onSubmit={submitPassword} className={cn(support.webauthn ? "" : "mt-8", inputSkin)}>
        <div className="space-y-4">
          <Input label="Email" type="email" autoComplete="username webauthn" required leading={<Mail className="size-4" />}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@campaign.co.ke" />
          <Input label="Password" type="password" autoComplete="current-password" required leading={<Lock className="size-4" />}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {errorBox}
        <Button type="submit" variant={hq ? "secondary" : "navy"} size="lg" loading={busy === "password"} className="mt-6 w-full">Sign in</Button>
      </form>
    </>
  );

  if (hq) {
    return (
      <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#050d1a] px-4 py-10">
        {/* Command-centre backdrop: aurora glow + fine grid. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(11,127,166,.35),transparent_45%),radial-gradient(ellipse_at_100%_100%,rgba(201,162,39,.2),transparent_40%),radial-gradient(ellipse_at_0%_100%,rgba(0,107,63,.25),transparent_40%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative w-full max-w-md animate-fade-up">
          <div className="mb-6 flex items-center justify-center gap-3">
            <BrandMark className="size-12" />
            <div>
              <p className="font-display text-lg font-bold text-white">{CAMPAIGN_NAME}</p>
              <p className="text-xs text-slate-400">{CANDIDATE_NAME} · Mombasa 2027</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[.03] shadow-2xl backdrop-blur-xl">
            <FlagStripe />
            <div className="p-8">{form}</div>
            <div className="flex items-center gap-2 border-t border-white/10 bg-black/20 px-8 py-4 text-xs text-slate-400">
              <ShieldCheck className="size-4 text-gold" /> Every sign-in is recorded. Unauthorised access is an offence.
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">
            {copy.note}{" "}
            <Link href="/field/login" className="font-semibold text-slate-300 hover:text-white">Field sign-in →</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="relative overflow-hidden bg-gradient-to-br from-kenya-green via-[#00593a] to-navy-900 pb-24 text-white">
        <FlagStripe />
        <div className="pointer-events-none absolute -top-10 -right-10 size-64 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-md items-center gap-3 px-6 pt-8">
          <BrandMark className="size-11" />
          <div>
            <p className="font-display text-lg font-bold">{CAMPAIGN_NAME}</p>
            <p className="text-xs text-white/70">{CANDIDATE_NAME} · Field Team</p>
          </div>
        </div>
        <ul className="relative mx-auto mt-7 grid max-w-md grid-cols-3 gap-2 px-6 sm:gap-3">
          {[{ i: Smartphone, t: "Works offline" }, { i: Fingerprint, t: "Fingerprint sign-in" }, { i: Radar, t: "Live with HQ" }].map(({ i: Icon, t }) => (
            <li key={t} className="flex min-w-0 flex-col items-center gap-2 rounded-2xl bg-white/[.08] px-2 py-3 text-center ring-1 ring-white/15 backdrop-blur">
              <span className="grid size-9 place-items-center rounded-full bg-white/15 ring-1 ring-white/20"><Icon className="size-[18px] text-gold" /></span>
              <span className="text-xs leading-tight font-semibold text-white/90">{t}</span>
            </li>
          ))}
        </ul>
      </header>
      <main className="relative mx-auto -mt-16 w-full max-w-md flex-1 px-4 pb-10">
        <div className="animate-fade-up rounded-3xl bg-white p-7 shadow-xl ring-1 ring-line">{form}</div>
      </main>
    </div>
  );
}
