"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { Entry } from "./meta";

export const useCalendar = (start: Date, end: Date) =>
  useQuery({
    queryKey: ["calendar", start.toISOString(), end.toISOString()],
    queryFn: () => api<Entry[]>("/calendar", { query: { start: start.toISOString(), end: end.toISOString() } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

export const useGaps = (days = 14) =>
  useQuery({
    queryKey: ["calendar", "gaps", days],
    queryFn: () => api<{ ward_id: string; ward: string; constituency: string; last_visit_at: string | null; percent: number | null }[]>(
      "/calendar/gaps", { query: { days } }),
    staleTime: 60_000,
  });

export type EventInput = {
  title: string; kind: string; starts_at: string; ends_at?: string; all_day: boolean; constituency_id?: string; ward_id?: string;
  location?: string; notes?: string; hq_only: boolean; repeat_weeks: number;
};

function useRefresh() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["calendar"] }); qc.invalidateQueries({ queryKey: ["visits"] }); };
}

export function useCreateEvent() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: EventInput) => api<Entry[]>("/calendar", { body }), onSuccess: refresh });
}

export function useUpdateEvent() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; title?: string; notes?: string }) => api<void>(`/calendar/${id}`, { method: "PATCH", body }),
    onSuccess: refresh,
  });
}

export function useDeleteEvent() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, series }: { id: string; series: boolean }) => api<{ deleted: number }>(`/calendar/${id}`, { method: "DELETE", query: { series } }),
    onSuccess: refresh,
  });
}
