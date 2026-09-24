"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Gender, Page, Source, Support, Voter, VoterStatus } from "@/lib/types";

export type VoterFilters = {
  q?: string;
  status?: VoterStatus | "";
  support?: Support | "";
  source?: Source | "";
  ward_id?: string;
  constituency_id?: string;
  page?: number;
  size?: number;
};

export type VoterInput = {
  full_name: string;
  phone: string;
  national_id: string;
  voter_card_no?: string;
  gender?: Gender;
  birth_year?: number;
  ward_id: string;
  station_id?: string;
  support?: Support;
  notes?: string;
  consent: boolean;
  capture_lat?: number;
  capture_lng?: number;
  client_ref?: string;
};

export const voterKeys = {
  list: (f: VoterFilters) => ["voters", "list", f] as const,
  one: (id: string) => ["voters", "one", id] as const,
};

export const useVoters = (f: VoterFilters) =>
  useQuery({
    queryKey: voterKeys.list(f),
    queryFn: () => api<Page<Voter>>("/voters", { query: f }),
    placeholderData: keepPreviousData,
  });

export const useVoter = (id: string) => useQuery({ queryKey: voterKeys.one(id), queryFn: () => api<Voter>(`/voters/${id}`) });

export const checkDuplicate = (national_id: string) =>
  api<{ exists: boolean; reference?: string; full_name?: string; ward_name?: string }>("/voters/check-duplicate", {
    query: { national_id },
  });

function useVoterMutation<TVars>(fn: (v: TVars) => Promise<Voter>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (voter) => {
      qc.setQueryData(voterKeys.one(voter.id), voter);
      qc.invalidateQueries({ queryKey: ["voters", "list"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export const useCreateVoter = () => useVoterMutation((body: VoterInput) => api<Voter>("/voters", { body }));
export const useUpdateVoter = () =>
  useVoterMutation(({ id, ...body }: Partial<Omit<VoterInput, "national_id" | "consent">> & { id: string; opted_out?: boolean; do_not_call?: boolean }) =>
    api<Voter>(`/voters/${id}`, { method: "PATCH", body }),
  );
export const useVerify = () => useVoterMutation((id: string) => api<Voter>(`/voters/${id}/verify`, { method: "POST" }));
export const useReopen = () => useVoterMutation((id: string) => api<Voter>(`/voters/${id}/reopen`, { method: "POST" }));
export const useReject = () =>
  useVoterMutation(({ id, reason }: { id: string; reason: string }) => api<Voter>(`/voters/${id}/reject`, { body: { reason } }));

export const revealNationalId = (id: string) => api<{ national_id: string }>(`/voters/${id}/reveal-id`, { method: "POST" });
