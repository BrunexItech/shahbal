"use client";

import { Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Input, Modal } from "@/components/ui";
import { api, setStepUpHandler } from "@/lib/api";
import { cancelPasskeyPrompt, confirmWithPasskey, passkeyErrorMessage } from "@/lib/passkeys";

type Options = { methods: ("passkey" | "totp" | "password")[]; flow_id: string | null; options: Record<string, unknown> | null };

/**
 * Answers the API's 428 "please confirm it's you": shows one prompt (shared by
 * any requests that hit it together), then lets them retry.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<Promise<boolean> | null>(null);
  const resolve = useRef<(ok: boolean) => void>(() => {});

  const finish = useCallback((ok: boolean) => {
    resolve.current(ok);
    pending.current = null;
    setOpen(false);
    setCode("");
    setPassword("");
    setError("");
    setOpts(null);
  }, []);

  const loadOptions = useCallback(async () => {
    setError("");
    try {
      setOpts(await api<Options>("/auth/step-up/options", { method: "POST", noStepUp: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the check");
    }
  }, []);

  useEffect(() => {
    setStepUpHandler(() => {
      pending.current ??= new Promise<boolean>((res) => {
        resolve.current = res;
        setOpen(true);
        void loadOptions();
      });
      return pending.current;
    });
  }, [loadOptions]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      finish(true);
    } catch (e) {
      setError(passkeyErrorMessage(e));
      if (opts?.methods.includes("passkey")) void loadOptions(); // a used challenge can't be reused
    } finally {
      setBusy(false);
    }
  }

  const methods = opts?.methods ?? [];
  return (
    <>
      {children}
      <Modal open={open} onClose={() => { cancelPasskeyPrompt(); finish(false); }} size="sm" title="Confirm it's you"
        subtitle="This action involves sensitive data, so we need a quick re-check. It stays unlocked for 5 minutes.">
        <div className="space-y-4">
          {!opts && !error && <p className="text-sm text-muted">Preparing…</p>}
          {methods.includes("passkey") && opts?.flow_id && (
            <Button size="lg" className="w-full" loading={busy} icon={<Fingerprint className="size-5" />}
              onClick={() => run(() => confirmWithPasskey({ flow_id: opts.flow_id!, options: opts.options! }))}>
              Use fingerprint, face or security key
            </Button>
          )}
          {methods.includes("totp") && (
            <div className="flex items-end gap-2">
              <Input label={methods.includes("passkey") ? "Or authenticator code" : "Authenticator code"} inputMode="numeric"
                autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                leading={<KeyRound className="size-4" />} className="flex-1" />
              <Button variant="navy" loading={busy} disabled={code.length !== 6}
                onClick={() => run(() => api("/auth/step-up/verify", { body: { method: "totp", code }, noStepUp: true }))}>Confirm</Button>
            </div>
          )}
          {methods.includes("password") && (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api("/auth/step-up/verify", { body: { method: "password", password }, noStepUp: true })); }}>
              <Input label="Your password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} className="flex-1" />
              <Button type="submit" variant="navy" loading={busy} disabled={!password}>Confirm</Button>
            </form>
          )}
          {methods.includes("password") && (
            <p className="flex gap-2 rounded-xl bg-ocean-50 px-3 py-2 text-xs text-navy-900 ring-1 ring-ocean/15">
              <ShieldCheck className="mt-px size-4 shrink-0 text-ocean" /> Add a passkey in My Account to confirm with your fingerprint instead.
            </p>
          )}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-kenya-red ring-1 ring-red-100">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
