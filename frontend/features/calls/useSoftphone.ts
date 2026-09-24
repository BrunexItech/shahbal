"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { CallRecorder, type Line, type LineState, SandboxLine, SipLine, type SoftphoneConfig } from "@/lib/softphone";

export type Consent = "pending" | "agreed" | "declined";
export type Party = { voterId?: string; name: string; number: string };
export type FinishedCall = { party: Party; seconds: number; recording: Blob | null; mime: string; consent: Consent; line: "sip" | "sandbox" };

const PRESENCE: Partial<Record<LineState, string>> = { ready: "available", ended: "wrap_up", dialing: "ringing", ringing: "ringing", in_call: "on_call" };

/**
 * Owns the phone line for this page: connection, the active call, its timer,
 * the recording (with the voter's consent), and presence for the supervisors' wall.
 */
export function useSoftphone() {
  const [config, setConfig] = useState<SoftphoneConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [, force] = useState(0);
  const [party, setParty] = useState<Party | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [consent, setConsent] = useState<Consent>("pending");
  const [finished, setFinished] = useState<FinishedCall | null>(null);
  const [now, setNow] = useState(Date.now());
  const line = useRef<Line | null>(null);
  const recorder = useRef<CallRecorder | null>(null);
  const partyRef = useRef<Party | null>(null);
  const consentRef = useRef<Consent>("pending");
  const connectedRef = useRef<number | null>(null);

  // Load config and bring the line up.
  useEffect(() => {
    let cancelled = false;
    api<SoftphoneConfig>("/calls/softphone")
      .then(async (cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        const l: Line = cfg.provider === "sip" ? new SipLine(cfg) : new SandboxLine();
        line.current = l;
        l.onChange(() => force((n) => n + 1));
        await l.connect();
      })
      .catch((e) => setConfigError(e instanceof Error ? e.message : "Phone line unavailable"));
    return () => {
      cancelled = true;
      void line.current?.dispose();
      void api("/live/presence", { body: { status: "away" } }).catch(() => {});
    };
  }, []);

  const state: LineState = line.current?.state ?? (configError ? "error" : "offline");

  // Presence heartbeat (and immediately on every state change).
  useEffect(() => {
    const status = PRESENCE[state];
    if (!status) return;
    const send = () =>
      api("/live/presence", { body: { status, voter_id: state === "ready" ? null : partyRef.current?.voterId ?? null, line: line.current?.kind } }).catch(() => {});
    void send();
    const t = setInterval(send, 20_000);
    return () => clearInterval(t);
  }, [state]);

  // Start recording when the call connects; finish it when the call ends.
  useEffect(() => {
    const l = line.current;
    if (!l) return;
    if (state === "in_call" && !connectedRef.current) {
      connectedRef.current = Date.now();
      setConnectedAt(connectedRef.current);
      try {
        recorder.current = new CallRecorder();
        recorder.current.start([l.localStream, l.remoteStream]);
      } catch {
        recorder.current = null; // browser can't record: the call still goes ahead
      }
    }
    if (state === "ended" && partyRef.current) {
      const p = partyRef.current;
      const seconds = connectedRef.current ? Math.round((Date.now() - connectedRef.current) / 1000) : 0;
      const rec = recorder.current;
      const declined = consentRef.current === "declined";
      void (async () => {
        const blob = rec ? (declined ? (await rec.discard(), null) : await rec.stop()) : null;
        setFinished({ party: p, seconds, recording: blob, mime: rec?.mime ?? "audio/webm", consent: consentRef.current, line: l.kind });
      })();
      partyRef.current = null;
      connectedRef.current = null;
      recorder.current = null;
      setConnectedAt(null);
    }
  }, [state]);

  // Call timer tick.
  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [connectedAt]);

  const dial = useCallback(async (p: Party) => {
    const l = line.current;
    if (!l || !["ready", "ended"].includes(l.state)) return;
    partyRef.current = p;
    consentRef.current = "pending";
    setConsent("pending");
    setFinished(null);
    setParty(p);
    await l.call(p.number);
  }, []);

  const hangup = useCallback(async () => line.current?.hangup(), []);

  const answerConsent = useCallback(async (c: Consent) => {
    consentRef.current = c;
    setConsent(c);
    if (c === "declined") await recorder.current?.discard();
  }, []);

  const clearFinished = useCallback(() => {
    setFinished(null);
    setParty(null);
  }, []);

  return {
    config, configError, state, line: line.current, party, consent, finished,
    recording: !!recorder.current?.active && consent !== "declined",
    elapsed: connectedAt ? Math.max(0, Math.round((now - connectedAt) / 1000)) : 0,
    dial, hangup, answerConsent, clearFinished,
    mute: (on: boolean) => line.current?.setMuted(on),
    hold: (on: boolean) => line.current?.setHeld(on),
    dtmf: (t: string) => line.current?.dtmf(t),
  };
}

export type Softphone = ReturnType<typeof useSoftphone>;

/** Upload the finished recording (never when the voter declined). */
export async function uploadRecording(f: FinishedCall): Promise<string | undefined> {
  if (!f.recording || f.consent === "declined") return undefined;
  const form = new FormData();
  form.append("file", new File([f.recording], "call.webm", { type: f.mime }));
  if (f.party.voterId) form.append("voter_id", f.party.voterId);
  form.append("dialled", f.party.number);
  form.append("duration_seconds", String(f.seconds));
  form.append("line", f.line);
  const r = await api<{ id: string }>("/calls/recordings", { form });
  return r.id;
}
