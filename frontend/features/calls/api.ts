"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
