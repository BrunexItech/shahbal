"use client";

import { KeyRound, LaptopMinimal, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SkeletonRows, Spinner } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, Input, PageHeader } from "@/components/ui";
import { changePassword, disableTotp, enableTotp, startTotp, useRevokeOthers, useSessions } from "@/features/account/api";
import { PasskeysCard } from "@/features/account/PasskeysCard";
import { useAuth, useUser } from "@/lib/auth";
import { dateTime, timeAgo } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";

export default function AccountPage() {
  const user = useUser();
  return (
    <>
      <PageHeader eyebrow="Account" title="My account & security" subtitle={`${user.full_name} · ${ROLE_LABEL[user.role]} · ${user.email}`} />
      {user.mfa_setup_required && (
        <div className="mb-6 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <p><b>Two-step verification is required for your role.</b> Add a passkey (fingerprint or face) or an authenticator app below to unlock the rest of the system.</p>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <PasskeysCard />
        <TwoFactorCard />
        <PasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}

function TwoFactorCard() {
  const user = useUser();
  const { refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const enabled = !!user.totp_enabled;
  return (
    <Card>
      <CardHeader title="Authenticator app" subtitle="A 6-digit code from Google Authenticator, Microsoft Authenticator or Authy: a backup for when a passkey isn't available."
        action={<Badge tone={enabled ? "green" : "amber"} dot>{enabled ? "On" : "Off"}</Badge>} />
      <div className="space-y-4 p-5">
        {enabled && !disabling && (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-navy-900"><ShieldCheck className="size-5 text-kenya-green" /> Your account is protected.</p>
            <Button size="sm" variant="ghost" onClick={() => setDisabling(true)}>Turn off</Button>
          </div>
        )}
        {enabled && disabling && (
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Current code to confirm" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="w-48" />
            <Button variant="danger-soft" loading={busy} disabled={code.length !== 6}
              onClick={() => run(async () => { await disableTotp(code); await refresh(); setDisabling(false); setCode(""); }, "Two-step verification turned off")}>
              Turn off
            </Button>
            <Button variant="ghost" onClick={() => { setDisabling(false); setCode(""); }}>Cancel</Button>
          </div>
        )}
        {!enabled && !setup && (
          <Button icon={<Smartphone className="size-4" />} loading={busy} onClick={() => run(async () => setSetup(await startTotp()))}>
            Set up authenticator app
          </Button>
        )}
        {!enabled && setup && (
          <div className="grid animate-fade-up gap-5 sm:grid-cols-[auto_1fr]">
            {/* Server-generated SVG rendered as an image, never injected as HTML. */}
            <img alt="Scan with your authenticator app" className="size-44 rounded-2xl bg-white p-2 ring-1 ring-line"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qr_svg)}`} />
            <div className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-4 text-slate-700">
                <li>Open your authenticator app and scan this code.</li>
                <li>Enter the 6-digit code it shows to confirm.</li>
              </ol>
              <p className="text-xs text-muted">Can&apos;t scan? Enter this key manually: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] break-all text-navy-900">{setup.secret}</code></p>
              <div className="flex items-end gap-2">
                <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="w-40" />
                <Button loading={busy} disabled={code.length !== 6}
                  onClick={() => run(async () => { await enableTotp(code); await refresh(); setSetup(null); setCode(""); }, "Two-step verification is on")}>
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;
  const weak = next.length > 0 && (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await changePassword(cur, next);
      toast.success("Password changed. Other devices have been signed out.");
      setCur(""); setNext(""); setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Password" subtitle="At least 10 characters with letters and numbers. Changing it signs out your other devices." />
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        <Input label="Current password" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} className="sm:col-span-2" leading={<KeyRound className="size-4" />} />
        <Input label="New password" type="password" autoComplete="new-password" required value={next} error={weak ? "10+ characters, letters and numbers" : undefined} onChange={(e) => setNext(e.target.value)} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} error={mismatch ? "Doesn't match" : undefined} onChange={(e) => setConfirm(e.target.value)} />
        <div className="sm:col-span-2">
          <Button type="submit" variant="navy" loading={busy} disabled={!cur || !next || weak || mismatch || next !== confirm}>Update password</Button>
        </div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { data, isLoading } = useSessions();
  const revoke = useRevokeOthers();
  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Where you're signed in" subtitle="Sessions end automatically after 12 hours."
        action={<Button size="sm" variant="secondary" loading={revoke.isPending} disabled={(data?.length ?? 0) < 2}
          onClick={() => revoke.mutate(undefined, { onSuccess: () => toast.success("Signed out of all other devices") })}>Sign out everywhere else</Button>} />
      {isLoading ? <SkeletonRows rows={2} cols={3} /> : (
        <ul className="divide-y divide-line">
          {data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
              <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
                {/Mobile|Android|iPhone/i.test(s.user_agent ?? "") ? <Smartphone className="size-5" /> : <LaptopMinimal className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy-900">{describeAgent(s.user_agent)} {s.current && <Badge tone="green" className="ml-1">This device</Badge>}</p>
                <p className="text-xs text-muted">{s.ip ?? "Unknown IP"} · signed in {dateTime(s.created_at)} · active {s.last_seen_at ? timeAgo(s.last_seen_at) : "—"}</p>
              </div>
            </li>
          )) ?? <li className="p-5"><Spinner /></li>}
        </ul>
      )}
    </Card>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}
