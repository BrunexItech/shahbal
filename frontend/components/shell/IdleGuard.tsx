"use client";

import { Hourglass } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { lastPortal, PORTAL_LOGIN } from "@/lib/portal";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
const REPORT_EVERY = 60_000; // tell the server "someone is here" at most once a minute
const WARN_FOR = 60; // seconds of warning before signing out

/**
 * Signs the user out after a period with no taps, clicks or key presses (live data
 * doesn't count). One minute before, a clear "Still there?" prompt with a countdown.
 * The server enforces the same limit, so a phone that slept through it is signed out
 * on its next request as well.
 */
export function IdleGuard() {
  const { user, logout } = useAuth();
  const minutes = user?.idle_minutes ?? 30;
  const lastInput = useRef(Date.now());
  const lastReport = useRef(0);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const onInput = () => {
      lastInput.current = Date.now();
      if (Date.now() - lastReport.current > REPORT_EVERY) {
        lastReport.current = Date.now();
        void api("/auth/activity", { method: "POST", silent401: false }).catch(() => {});
      }
    };
    for (const e of EVENTS) window.addEventListener(e, onInput, { passive: true });
    return () => { for (const e of EVENTS) window.removeEventListener(e, onInput); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const idle = (Date.now() - lastInput.current) / 1000;
      const remaining = Math.ceil(minutes * 60 - idle);
      if (remaining <= 0) {
        clearInterval(t);
        const portal = lastPortal();
        void logout().finally(() => { window.location.href = `${PORTAL_LOGIN[portal]}?reason=idle`; });
      } else setLeft(remaining <= WARN_FOR ? remaining : null);
    }, 1000);
    return () => clearInterval(t);
  }, [minutes, logout]);

  if (left == null) return null;
  const stay = () => {
    lastInput.current = Date.now();
    lastReport.current = Date.now();
    void api("/auth/activity", { method: "POST" }).catch(() => {});
    setLeft(null);
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-950/60 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-sm animate-fade-up overflow-hidden rounded-3xl bg-white text-center shadow-2xl">
        <div aria-hidden className="flex h-1.5"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
        <div className="p-6">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-gold-50 text-[#7a5f0c] ring-8 ring-gold-50/60"><Hourglass className="size-7" /></span>
          <h2 id="idle-title" className="mt-4 font-display text-xl font-bold text-navy-900">Still there?</h2>
          <p className="mt-1 text-sm text-slate-600">For security you&apos;ll be signed out in</p>
          <p className="mt-2 font-mono text-5xl font-bold text-navy-900 tabular-nums">{left}s</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <button onClick={() => void logout()} className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-navy-900 hover:bg-slate-200">Sign out</button>
            <button onClick={stay} autoFocus className="rounded-2xl bg-kenya-green px-4 py-3 text-sm font-bold text-white hover:brightness-110">I&apos;m here</button>
          </div>
        </div>
      </div>
    </div>
  );
}
