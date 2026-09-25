"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { AgentStat, CallLog, CallOutcome, CallQueue, Claim, QueueCounts, Support } from "@/lib/types";

export const useQueueCounts = () => useQuery({ queryKey: ["calls", "queues"], queryFn: () => api<QueueCounts>("/calls/queues"), refetchInterval: 20_000 });
export const useAgentStats = () => useQuery({ queryKey: ["calls", "stats"], queryFn: () => api<AgentStat[]>("/calls/stats/today"), refetchInterval: 30_000 });
export const useVoterCalls = (voterId: string) => useQuery({ queryKey: ["calls", "voter", voterId], queryFn: () => api<CallLog[]>(`/calls/voter/${voterId}`) });

/** 204 (queue empty) comes back as undefined. */
export const claimNext = (queue: CallQueue, ward_id?: string) => api<Claim | undefined>("/calls/next", { body: { queue, ward_id } });
export const releaseClaim = () => api<void>("/calls/release", { method: "POST" });

export type CallInput = {
  voter_id: string;
  queue: CallQueue;
  outcome: CallOutcome;
  support?: Support;
  verify?: boolean;
  notes?: string;
  issue?: string;
  duration_seconds?: number;
  follow_up_at?: string;
  recording_id?: string;
  recording_declined?: boolean;
};

export function useLogCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CallInput) => api<CallLog>("/calls", { body }),
    onSuccess: (_, v) => {
      for (const k of [["calls"], ["dashboard"], ["voters", "one", v.voter_id], ["voters", "list"]]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

export type DirectoryRow = {
  id: string; reference: string; full_name: string; phone: string; support: Support; status: string;
  ward: string; constituency: string; station: string | null; calls: number; last_call_at: string | null;
  last_outcome: CallOutcome | null; last_agent: string | null; busy_with: string | null;
};
export type DirectoryFilters = { constituency_id?: string; ward_id?: string; station_id?: string; q?: string; called?: string; page?: number };

/** People to call, by place, with their call record. */
export const useCallDirectory = (f: DirectoryFilters) =>
  useQuery({
    queryKey: ["calls", "directory", f],
    queryFn: () => api<{ total: number; page: number; size: number; items: DirectoryRow[] }>("/calls/directory", { query: { ...f, size: 50 } }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });

/** Reserve one specific person to call (409 if a colleague is already on the line). */
export const claimVoter = (voterId: string) => api<Claim>(`/calls/claim/${voterId}`, { method: "POST" });
