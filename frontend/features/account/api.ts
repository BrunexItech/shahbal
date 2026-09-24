"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { SessionInfo } from "@/lib/types";

export const useSessions = () => useQuery({ queryKey: ["account", "sessions"], queryFn: () => api<SessionInfo[]>("/auth/sessions") });

export const startTotp = () => api<{ secret: string; otpauth_uri: string; qr_svg: string }>("/auth/totp/setup", { method: "POST" });
export const enableTotp = (code: string) => api<void>("/auth/totp/enable", { body: { code } });
export const disableTotp = (code: string) => api<void>("/auth/totp/disable", { body: { code } });
export const changePassword = (current_password: string, new_password: string) => api<void>("/auth/password", { body: { current_password, new_password } });

export function useRevokeOthers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/sessions/revoke-others", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account", "sessions"] }),
  });
}
