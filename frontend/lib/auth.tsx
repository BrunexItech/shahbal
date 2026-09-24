"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, ApiError, setUnauthorizedHandler } from "@/lib/api";
import { signInWithPasskey } from "@/lib/passkeys";
import { lastPortal, type Portal, PORTAL_LOGIN, rememberPortal } from "@/lib/portal";
import type { User } from "@/lib/types";

export type Me = User & { mfa_setup_required?: boolean; passkey_count?: number; session_method?: string; elevated_until?: string | null; portal?: Portal };

export type MfaMethod = "passkey" | "totp";
type LoginResult = { done: true } | { done: false; mfaToken: string; methods: MfaMethod[] };

type AuthState = {
  user: Me | null;
  ready: boolean;
  login: (email: string, password: string, portal: Portal) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, code: string, portal: Portal) => Promise<void>;
  /** Passwordless (no token) or second factor (with the token from the password step). */
  loginWithPasskey: (opts: { portal: Portal; mfaToken?: string; autofill?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Non-secret profile snapshot so a field agent with no signal still opens into the app.
 *  The session itself is the httpOnly cookie; this cache grants nothing on its own. */
const USER_KEY = "chq.user";
const userCache = {
  get(): Me | null {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as Me) : null;
    } catch {
      return null;
    }
  },
  set(u: Me | null) {
    try {
      if (u) window.localStorage.setItem(USER_KEY, JSON.stringify(u));
      else window.localStorage.removeItem(USER_KEY);
    } catch {}
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();

  const clearLocal = useCallback(() => {
    userCache.set(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const expire = useCallback(() => {
    clearLocal();
    router.replace(PORTAL_LOGIN[lastPortal()]);
  }, [clearLocal, router]);

  useEffect(() => {
    setUnauthorizedHandler(expire);
  }, [expire]);

  const accept = useCallback((u: Me) => {
    userCache.set(u);
    if (u.portal) rememberPortal(u.portal);
    setUser(u);
  }, []);

  const refresh = useCallback(async () => {
    accept(await api<Me>("/auth/me"));
  }, [accept]);

  // Boot: render from cache immediately, then revalidate with the server.
  useEffect(() => {
    const cached = userCache.get();
    if (cached) {
      setUser(cached);
      setReady(true);
    }
    api<Me>("/auth/me", { silent401: true })
      .then(accept)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) clearLocal(); // no/expired session
        // network failure: keep the cached profile; queries will retry when back online
      })
      .finally(() => setReady(true));
  }, [accept, clearLocal]);

  const login = useCallback(async (email: string, password: string, portal: Portal): Promise<LoginResult> => {
    const res = await api<{ user: Me | null; mfa_required: boolean; mfa_token: string | null; mfa_methods: MfaMethod[] }>("/auth/login", {
      body: { email, password, portal },
      silent401: true,
    });
    if (res.mfa_required && res.mfa_token) return { done: false, mfaToken: res.mfa_token, methods: res.mfa_methods };
    await refresh();
    return { done: true };
  }, [refresh]);

  const verifyMfa = useCallback(async (mfaToken: string, code: string, portal: Portal) => {
    await api("/auth/mfa", { body: { mfa_token: mfaToken, code, portal }, silent401: true });
    await refresh();
  }, [refresh]);

  const loginWithPasskey = useCallback(async (opts: { portal: Portal; mfaToken?: string; autofill?: boolean }) => {
    await signInWithPasskey(opts);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", silent401: true });
    } catch {}
    const portal = lastPortal();
    clearLocal();
    router.replace(PORTAL_LOGIN[portal]);
  }, [clearLocal, router]);

  const value = useMemo(
    () => ({ user, ready, login, verifyMfa, loginWithPasskey, logout, refresh }),
    [user, ready, login, verifyMfa, loginWithPasskey, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** For pages inside the authenticated shell, where a user is guaranteed. */
export function useUser(): Me {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called outside the authenticated shell");
  return user;
}
