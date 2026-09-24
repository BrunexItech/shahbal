"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ElectionSettings, RosterRow, Turnout } from "@/lib/types";

export const useElectionSettings = () => useQuery({ queryKey: ["election", "settings"], queryFn: () => api<ElectionSettings>("/election/settings") });

export const useTurnout = (wardId?: string) =>
  useQuery({ queryKey: ["election", "turnout", wardId ?? "all"], queryFn: () => api<Turnout>("/election/turnout", { query: { ward_id: wardId } }), refetchInterval: 15_000 });

export const useRoster = (f: { ward_id?: string; station_id?: string; q?: string; only_pending?: boolean }, enabled: boolean) =>
  useQuery({ queryKey: ["election", "roster", f], queryFn: () => api<RosterRow[]>("/election/roster", { query: f }), enabled });

export function useSaveElectionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<ElectionSettings, "days_to_go" | "is_election_day">) => api<ElectionSettings>("/election/settings", { method: "PUT", body }),
    onSuccess: (d) => qc.setQueryData(["election", "settings"], d),
  });
}

export function useMarkVoted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, voted }: { id: string; voted: boolean }) => api<{ id: string; voted_at: string | null }>(`/election/voters/${id}/voted`, { body: { voted } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["election"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function usePlanReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<string[]>("/election/reminders", { body: { channel: "sms" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}
