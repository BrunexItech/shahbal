"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { InviteInfo, Role, User } from "@/lib/types";

export type UserInput = {
  full_name: string;
  email: string;
  phone?: string;
  role: Role;
  constituency_id?: string | null;
  ward_id?: string | null;
  is_active?: boolean;
};

export const useUsers = () => useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/users"), refetchInterval: 30_000 });

function useUserMutation<TVars, TOut>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
}

/** Creating a person issues their invitation; they set their own password. */
export const useInviteUser = () =>
  useUserMutation(({ email, ...body }: UserInput) => api<{ user: User; invite: InviteInfo }>("/users", { body: { email, ...body } }));

export const useUpdateUser = () =>
  useUserMutation(({ id, email: _email, ...body }: UserInput & { id: string }) => api<User>(`/users/${id}`, { method: "PATCH", body }));

/** Resend an invite, or reset access for an active account (old password stops working). */
export const useReinvite = () => useUserMutation((id: string) => api<InviteInfo>(`/users/${id}/invite`, { method: "POST" }));
export const useRevokeInvite = () => useUserMutation((id: string) => api<void>(`/users/${id}/invite`, { method: "DELETE" }));
export const useForceSignOut = () => useUserMutation((id: string) => api<void>(`/users/${id}/revoke-sessions`, { method: "POST" }));
