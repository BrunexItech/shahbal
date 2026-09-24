"use client";

import { Delete, Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, ShieldCheck, Signal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Softphone } from "@/features/calls/useSoftphone";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME } from "@/lib/config";
import { initials } from "@/lib/format";
import { levelMeter, playDtmf } from "@/lib/softphone";

const KEYS: [string, string][] = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Two live level bars ("You" / "Voter") driven by the call's audio streams. */
function Meters({ phone }: { phone: Softphone }) {
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const l = phone.line;
  useEffect(() => {
    if (phone.state !== "in_call" || !l) return;
    const you = levelMeter(l.localStream);
    const them = levelMeter(l.remoteStream);
    let raf = 0;
    const tick = () => {
      setLevels([you?.() ?? 0, them?.() ?? 0]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phone.state, l]);
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["You", "Voter"] as const).map((who, i) => (
        <div key={who}>
          <p className="mb-1 text-[10px] tracking-wider text-slate-400 uppercase">{who}</p>
          <div className="flex h-6 items-end gap-[3px]">
            {Array.from({ length: 14 }).map((_, b) => (
              <span key={b} className={cn("w-full rounded-sm transition-[height] duration-75", levels[i] * 14 > b ? (b > 10 ? "bg-gold" : "bg-[#34c77b]") : "bg-white/10")}
                style={{ height: `${30 + b * 5}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SoftphonePanel({ phone, canManualDial }: { phone: Softphone; canManualDial: boolean }) {
  const [number, setNumber] = useState("");
  const [keypad, setKeypad] = useState(false);
  const inCall = ["dialing", "ringing", "in_call"].includes(phone.state);
  const l = phone.line;
  const inputRef = useRef<HTMLInputElement>(null);

  const status =
    phone.state === "error" || phone.configError ? { text: phone.line?.error ?? phone.configError ?? "Line error", cls: "bg-red-500/15 text-red-300" }
    : phone.state === "connecting" || phone.state === "offline" ? { text: "Connecting line…", cls: "bg-white/10 text-slate-300" }
    : { text: phone.config?.provider === "sip" ? "SIP line ready" : "Training line (sandbox)", cls: "bg-[#34c77b]/15 text-[#7ee2b0]" };

  const press = (k: string) => {
    if (inCall) {
      void phone.dtmf(k);
    } else {
      playDtmf(k);
      setNumber((n) => (n + k).slice(0, 16));
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-2xl ring-1 ring-white/10">
      <div className="relative px-5 pt-5 pb-4">
        <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-ocean/25 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold"><Signal className="size-4 text-gold" /> Softphone</p>
          <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", status.cls)}>{status.text}</span>
        </div>
      </div>

      {/* Screen */}
      <div className="px-5">
        {inCall || phone.state === "ended" ? (
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-gold to-[#8a6d12] text-lg font-extrabold text-navy-950">
              {initials(phone.party?.name ?? "?")}
            </span>
            <p className="mt-2 font-display text-lg font-bold">{phone.party?.name}</p>
            <p className="text-xs text-slate-400">{phone.party?.number}</p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
              {phone.state === "dialing" ? "Dialling…" : phone.state === "ringing" ? "Ringing…" : phone.state === "ended" ? "Call ended" : mmss(phone.elapsed)}
            </p>
            {phone.recording && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-red-300 uppercase">
                <span className="size-2 animate-pulse rounded-full bg-red-500" /> Recording
              </span>
            )}
            {phone.state === "in_call" && <div className="mt-4"><Meters phone={phone} /></div>}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3">
            {canManualDial ? (
              <div className="flex items-center gap-2">
                <input ref={inputRef} value={number} onChange={(e) => setNumber(e.target.value.replace(/[^\d+*#]/g, "").slice(0, 16))}
                  placeholder="Enter a number" inputMode="tel" aria-label="Number to dial"
                  className="w-full bg-transparent font-mono text-xl tracking-wider text-white placeholder:text-slate-600 focus:outline-none" />
                {number && <button onClick={() => setNumber((n) => n.slice(0, -1))} className="text-slate-400 hover:text-white" aria-label="Delete digit"><Delete className="size-5" /></button>}
              </div>
            ) : (
              <p className="py-1 text-center text-sm text-slate-400">Ready. Start calling from the queue.</p>
            )}
          </div>
        )}
      </div>

      {/* Consent script */}
      {phone.state === "in_call" && phone.consent === "pending" && (
        <div className="mx-5 mt-3 animate-fade-up rounded-2xl border border-gold/30 bg-gold/10 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-bold text-gold"><ShieldCheck className="size-4" /> Say this first</p>
          <p className="mt-1 leading-relaxed text-slate-200">
            &ldquo;Habari, I&apos;m calling from {CAMPAIGN_NAME}. This call is recorded so we can serve Mombasa better. Is that okay with you?&rdquo;
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => void phone.answerConsent("agreed")} className="rounded-lg bg-[#34c77b]/20 py-1.5 font-semibold text-[#7ee2b0] hover:bg-[#34c77b]/30">Voter agreed</button>
            <button onClick={() => void phone.answerConsent("declined")} className="rounded-lg bg-white/10 py-1.5 font-semibold text-slate-200 hover:bg-white/15">Declined: stop recording</button>
          </div>
        </div>
      )}
      {phone.consent === "declined" && inCall && (
        <p className="mx-5 mt-3 rounded-xl bg-white/5 px-3 py-2 text-center text-[11px] text-slate-300">Recording stopped and discarded at the voter&apos;s request.</p>
      )}

      {/* Keypad */}
      {(!inCall && canManualDial) || (inCall && keypad) ? (
        <div className="grid grid-cols-3 gap-2.5 px-5 pt-4">
          {KEYS.map(([k, sub]) => (
            <button key={k} onClick={() => press(k)}
              className="flex h-14 flex-col items-center justify-center rounded-2xl bg-white/[.05] ring-1 ring-white/[.06] transition hover:bg-white/10 active:scale-95">
              <span className="font-display text-xl font-semibold leading-none">{k}</span>
              {sub && <span className="mt-0.5 text-[8px] tracking-[.18em] text-slate-500">{sub}</span>}
            </button>
          ))}
        </div>
      ) : null}

      {/* Controls */}
      <div className="p-5">
        {inCall ? (
          <div className="grid grid-cols-4 gap-2.5">
            <Ctl on={!!l?.muted} onClick={() => phone.mute(!l?.muted)} label={l?.muted ? "Unmute" : "Mute"} icon={l?.muted ? MicOff : Mic} disabled={phone.state !== "in_call"} />
            <Ctl on={!!l?.held} onClick={() => void phone.hold(!l?.held)} label={l?.held ? "Resume" : "Hold"} icon={l?.held ? Play : Pause} disabled={phone.state !== "in_call"} />
            <Ctl on={keypad} onClick={() => setKeypad((k) => !k)} label="Keypad" icon={Grid3x3} />
            <button onClick={() => void phone.hangup()} className="flex flex-col items-center gap-1 rounded-2xl bg-kenya-red py-2.5 text-[10px] font-semibold shadow-lg shadow-kenya-red/30 hover:brightness-110 active:scale-95" aria-label="Hang up">
              <PhoneOff className="size-5" /> End
            </button>
          </div>
        ) : canManualDial ? (
          <button disabled={!number || phone.state !== "ready" && phone.state !== "ended"}
            onClick={() => void phone.dial({ name: "Manual call", number })}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1fa463] font-semibold shadow-lg shadow-[#1fa463]/30 transition hover:brightness-110 active:scale-[.98] disabled:opacity-40">
            <Phone className="size-5" /> Call
          </button>
        ) : null}
        <p className="mt-3 text-center text-[10px] text-slate-500">
          Calls are recorded after the disclosure, encrypted, and kept {phone.config?.recording_retention_days ?? 90} days.
        </p>
      </div>
    </div>
  );
}

function Ctl({ on, onClick, label, icon: Icon, disabled }: { on: boolean; onClick: () => void; label: string; icon: typeof Mic; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[10px] font-semibold ring-1 transition active:scale-95 disabled:opacity-40",
        on ? "bg-white text-navy-950 ring-white" : "bg-white/[.06] text-slate-200 ring-white/[.08] hover:bg-white/10")}>
      <Icon className="size-5" /> {label}
    </button>
  );
}
