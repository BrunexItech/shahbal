"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, ApiError, setUnauthorizedHandler, tokenStore } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthState = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

/** The last known profile, so a field agent with no signal still opens straight into the app. */
const USER_KEY = "chq.user";
const userCache = {
  get(): User | null {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  },
  set(u: User | null) {
    try {
      if (u) window.localStorage.setItem(USER_KEY, JSON.stringify(u));
      else window.localStorage.removeItem(USER_KEY);
    } catch {}
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();

  const logout = useCallback(() => {
    tokenStore.clear();
    userCache.set(null);
    setUser(null);
    qc.clear();
    router.replace("/login");
  }, [qc, router]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // Boot once: render from cache immediately, then revalidate. Only a real 401
  // (handled by the api layer) signs the user out; a network failure keeps the session.
  useEffect(() => {
    if (!tokenStore.get()) return setReady(true);
    const cached = userCache.get();
    if (cached) {
      setUser(cached);
      setReady(true);
    }
    api<User>("/auth/me")
      .then((u) => {
        setUser(u);
        userCache.set(u);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return; // api layer already logged out
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/login", {
      body: { email, password },
      auth: false,
    });
    tokenStore.set(res.access_token);
    userCache.set(res.user);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** For pages inside the authenticated shell, where a user is guaranteed. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called outside the authenticated shell");
  return user;
}
