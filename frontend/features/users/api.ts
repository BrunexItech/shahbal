"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

export type UserInput = {
  full_name: string;
  email: string;
  phone?: string;
  password?: string;
  role: Role;
  constituency_id?: string | null;
  ward_id?: string | null;
  is_active?: boolean;
};

export const useUsers = () => useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/users") });

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email, ...body }: UserInput & { id?: string }) =>
      id ? api<User>(`/users/${id}`, { method: "PATCH", body }) : api<User>("/users", { body: { email, ...body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
