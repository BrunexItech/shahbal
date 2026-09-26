"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type Task = {
  id: string; user_id: string; day: string; title: string; ward_id: string; station_id: string | null; station: string | null;
  target_captures: number | null; notes: string | null; status: "pending" | "done" | "skipped"; done_at: string | null; report: string | null;
};
export type AgentDay = { id: string; name: string; ward_id: string; ward: string; has_photo: boolean; captured: number; tasks: Task[] };
export type DayPlan = { day: string; today: string; agents: AgentDay[] };

export const useDayPlan = (day?: string) =>
  useQuery({
    queryKey: ["assignments", day ?? "today"],
    queryFn: () => api<DayPlan>("/assignments", { query: { day } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["assignments"] });
}

export type NewTask = { user_id: string; day: string; title: string; station_id?: string; target_captures?: number; notes?: string; repeat_days: number };
export function useCreateTask() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: NewTask) => api<{ created: number }>("/assignments", { body }), onSuccess: refresh });
}
export function useUpdateTask() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: Task["status"]; report?: string }) => api(`/assignments/${id}`, { method: "PATCH", body }),
    onSuccess: refresh,
  });
}
export function useDeleteTask() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api(`/assignments/${id}`, { method: "DELETE" }), onSuccess: refresh });
}
