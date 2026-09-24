"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Channel, Visit, VisitStatus } from "@/lib/types";

export type VisitInput = {
  title: string;
  ward_id: string;
  station_id?: string | null;
  venue: string;
  scheduled_at: string;
  notes?: string;
  announce: boolean;
  announce_hours_before: number;
  channel: Channel;
  message?: string;
};

export const useVisits = (f: { status?: VisitStatus; ward_id?: string } = {}) =>
  useQuery({ queryKey: ["visits", f], queryFn: () => api<Visit[]>("/visits", { query: f }), refetchInterval: 30_000 });

function useVisitMutation<T>(fn: (v: T) => Promise<Visit>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of ["visits", "map", "dashboard", "campaigns"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

export const useCreateVisit = () => useVisitMutation((body: VisitInput) => api<Visit>("/visits", { body }));
export const useCancelVisit = () => useVisitMutation((id: string) => api<Visit>(`/visits/${id}/cancel`, { method: "POST" }));
export const useCheckin = () =>
  useVisitMutation(({ id, latitude, longitude }: { id: string; latitude?: number; longitude?: number }) =>
    api<Visit>(`/visits/${id}/checkin`, { body: { latitude, longitude } }));
export const useCompleteVisit = () =>
  useVisitMutation(({ id, attendance, outcome }: { id: string; attendance?: number; outcome?: string }) =>
    api<Visit>(`/visits/${id}/complete`, { body: { attendance, outcome } }));
