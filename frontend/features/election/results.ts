"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type Candidate = { id: string; name: string; party: string | null; ours: boolean; color: string; position: number };
export type Area = { id: string; name: string; constituency?: string; streams: number; reported: number; votes: Record<string, number> };
export type Tally = {
  candidates: Candidate[]; totals: Record<string, number>; rejected: number; valid: number; streams_total: number; streams_reported: number;
  verified_only: boolean; forms: { submitted: number; verified: number; disputed: number }; constituencies: Area[]; wards: Area[];
};
export type ResultFormRow = {
  id: string; station_id: string; station: string; code: string; streams: number; stream_no: number; ward: string; votes: Record<string, number>;
  rejected: number; status: "submitted" | "verified" | "disputed"; note: string | null; submitted_by: string | null; reviewed_by: string | null;
  updated_at: string | null; photo_url: string;
};

export const useCandidates = () => useQuery({ queryKey: ["results", "candidates"], queryFn: () => api<Candidate[]>("/election/candidates") });
export const useTally = (verifiedOnly: boolean, enabled = true) =>
  useQuery({ queryKey: ["results", "tally", verifiedOnly], queryFn: () => api<Tally>("/election/results/tally", { query: { verified_only: verifiedOnly || undefined } }), enabled, refetchInterval: 20_000 });
export const useResultForms = (f: { ward_id?: string; status?: string } = {}) =>
  useQuery({ queryKey: ["results", "forms", f], queryFn: () => api<ResultFormRow[]>("/election/results", { query: f }), refetchInterval: 20_000 });

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["results"] });
}
export function useSaveCandidates() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (candidates: Omit<Candidate, "id" | "position">[]) => api<Candidate[]>("/election/candidates", { method: "PUT", body: { candidates } }), onSuccess: refresh });
}
export function useSubmitResult() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (form: FormData) => api<{ id: string; status: string }>("/election/results", { form }), onSuccess: refresh });
}
export function useReviewResult() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string; status: string; note?: string }) => api(`/election/results/${id}/review`, { body }), onSuccess: refresh });
}
