"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Audience, Campaign, CampaignMessage, CampaignStatus, Channel, Page, Preview } from "@/lib/types";

export type CampaignInput = { name: string; channel: Channel; body: string; audience: Partial<Audience>; scheduled_at?: string | null };

export const useCampaigns = (status?: CampaignStatus) =>
  useQuery({ queryKey: ["campaigns", status ?? "all"], queryFn: () => api<Campaign[]>("/messaging/campaigns", { query: { status } }), refetchInterval: 15_000 });

export const useCampaign = (id: string) =>
  useQuery({
    queryKey: ["campaigns", "one", id],
    queryFn: () => api<Campaign>(`/messaging/campaigns/${id}`),
    // Poll quickly while a send is in flight, then settle.
    refetchInterval: (q) => (q.state.data?.status === "sending" || q.state.data?.status === "scheduled" ? 4_000 : 30_000),
  });

/** Follows the campaign: polls while it is still going out, then settles. */
export const useCampaignMessages = (id: string, page: number, status?: CampaignStatus) =>
  useQuery({
    queryKey: ["campaigns", "messages", id, page, status],
    queryFn: () => api<Page<CampaignMessage>>(`/messaging/campaigns/${id}/messages`, { query: { page, size: 25 } }),
    placeholderData: keepPreviousData,
    refetchInterval: status === "sending" || status === "scheduled" ? 4_000 : false,
  });

export const previewCampaign = (body: Pick<CampaignInput, "channel" | "body" | "audience">) => api<Preview>("/messaging/preview", { body });

function useCampaignMutation<T>(fn: (v: T) => Promise<Campaign>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (c) => {
      qc.setQueryData(["campaigns", "one", c.id], c);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export const useCreateCampaign = () => useCampaignMutation((body: CampaignInput) => api<Campaign>("/messaging/campaigns", { body }));
export const useReviewCampaign = () =>
  useCampaignMutation(({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
    api<Campaign>(`/messaging/campaigns/${id}/review`, { body: { approve, note } }));
export const useCancelCampaign = () => useCampaignMutation((id: string) => api<Campaign>(`/messaging/campaigns/${id}/cancel`, { method: "POST" }));
