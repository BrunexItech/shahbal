"use client";

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";

import { api } from "@/lib/api";
import type { Portal } from "@/lib/portal";

/** Thin wrapper over the WebAuthn ceremonies; the server owns every security decision. */
export const passkeySupport = async () => ({
  webauthn: browserSupportsWebAuthn(),
  platform: browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable().catch(() => false)),
  autofill: await browserSupportsWebAuthnAutofill().catch(() => false),
});

type Options = { flow_id: string; options: Record<string, unknown> };

/** Friendly text for the ways a ceremony can end without an error on our side. */
export function passkeyErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelled. No passkey was used.";
  if (name === "InvalidStateError") return "This device already has a passkey for your account.";
  if (name === "SecurityError") return "Passkeys need the site to be opened on its proper address (HTTPS).";
  return e instanceof Error ? e.message : "Passkey failed";
}

export async function signInWithPasskey(opts: { portal: Portal; mfaToken?: string; autofill?: boolean }) {
  const o = await api<Options>("/auth/passkeys/login/options", { body: { mfa_token: opts.mfaToken, portal: opts.portal }, silent401: true });
  const credential = await startAuthentication({ optionsJSON: o.options as never, useBrowserAutofill: !!opts.autofill });
  return api("/auth/passkeys/login/verify", { body: { flow_id: o.flow_id, credential, mfa_token: opts.mfaToken, portal: opts.portal }, silent401: true });
}

export async function registerPasskey(kind: "platform" | "security_key", name: string) {
  const o = await api<Options>("/auth/passkeys/register/options", { body: { kind } });
  const credential = await startRegistration({ optionsJSON: o.options as never });
  return api("/auth/passkeys/register/verify", { body: { flow_id: o.flow_id, credential, name } });
}

export async function confirmWithPasskey(o: Options) {
  const credential = await startAuthentication({ optionsJSON: o.options as never });
  return api<void>("/auth/step-up/verify", { body: { method: "passkey", flow_id: o.flow_id, credential }, noStepUp: true });
}

export const cancelPasskeyPrompt = () => WebAuthnAbortService.cancelCeremony();

/** A readable default name for a new passkey, e.g. "Chrome on Android". */
export function defaultPasskeyName(kind: "platform" | "security_key") {
  if (kind === "security_key") return "Security key";
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android phone" : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Windows/.test(ua) ? "Windows Hello" : /Mac/.test(ua) ? "Mac Touch ID" : /Linux/.test(ua) ? "Linux computer" : "This device";
  return os;
}
