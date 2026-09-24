"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { apiUrl } from "@/lib/api";

export type Pulse = {
  captures_today: number;
  verified_today: number;
  voted: number;
  voted_last_hour: number;
  total: number;
  calls_today: number;
  messages_today: number;
  online_field: number;
  online_command: number;
  on_call: number;
};

export type LiveEvent = {
  id: string; at: string; action: string; entity: string; meta: Record<string, unknown> | null; actor: string;
  ward?: string | null; constituency?: string | null;
};
export type LiveCall = { agent_id: string; agent: string; status: "available" | "ringing" | "on_call" | "wrap_up" | "away"; since: string; voter: string | null; voter_reference: string | null; line: string | null };

type LiveState = { connected: boolean; pulse: Pulse | null; events: LiveEvent[]; calls: LiveCall[] | null; lastAt: number | null };

const Ctx = createContext<LiveState>({ connected: false, pulse: null, events: [], calls: null, lastAt: null });

const WATCH: (keyof Pulse)[] = ["captures_today", "verified_today", "voted", "calls_today", "messages_today", "total"];
const REFRESH_EVERY = 8_000;

/**
 * One Server-Sent Events connection per signed-in tab. Small counters arrive every
 * few seconds; when they move, heavy queries are refreshed, at most every 8 s.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>({ connected: false, pulse: null, events: [], calls: null, lastAt: null });
  const prev = useRef<Pulse | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    const open = () => {
      es = new EventSource(apiUrl("/live/stream"), { withCredentials: true });
      es.addEventListener("open", () => setState((s) => ({ ...s, connected: true })));
      es.addEventListener("error", () => setState((s) => ({ ...s, connected: false }))); // EventSource retries by itself
      es.addEventListener("expired", () => {
        es?.close();
        setState((s) => ({ ...s, connected: false }));
      });
      es.addEventListener("pulse", (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { pulse: Pulse; events: LiveEvent[]; calls?: LiveCall[] };
        const changed = !prev.current || WATCH.some((k) => prev.current![k] !== data.pulse[k]);
        prev.current = data.pulse;
        setState((s) => ({
          connected: true,
          pulse: data.pulse,
          events: data.events.length ? [...data.events, ...s.events].slice(0, 60) : s.events,
          calls: data.calls ?? s.calls,
          lastAt: Date.now(),
        }));
        if (changed && Date.now() - lastRefresh.current > REFRESH_EVERY) {
          lastRefresh.current = Date.now();
          for (const key of [["dashboard"], ["map"], ["voters", "list"], ["election"], ["calls"]]) qc.invalidateQueries({ queryKey: key });
        }
      });
    };
    open();
    // Browsers pause background tabs; reconnect promptly when the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !closed && es?.readyState === EventSource.CLOSED) open();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      es?.close();
    };
  }, [qc]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);
