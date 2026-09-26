"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

/** Whether AI help is switched on (an OpenAI key is set). Every AI button hides when it isn't. */
export const useAiStatus = () =>
  useQuery({ queryKey: ["ai", "status"], queryFn: () => api<{ enabled: boolean }>("/ai/status"), staleTime: 10 * 60_000 });

export type Turn = { role: "user" | "assistant"; content: string };
export const askCampaign = (question: string, history: Turn[]) => api<{ answer: string; as_of: string }>("/ai/ask", { body: { question, history } });
export const weeklyBriefing = () => api<{ briefing: string; as_of: string }>("/ai/briefing", { method: "POST" });
export const draftSms = (body: { purpose: string; channel: "sms" | "whatsapp"; language: "en" | "sw" | "mixed"; area?: string }) =>
  api<{ drafts: { text: string; chars: number; fits: boolean }[]; limit: number }>("/ai/draft-sms", { body });
export const issueAssist = (id: string) =>
  api<{ topic: string | null; urgent: boolean; why: string; duplicates: string[]; reply: string }>(`/ai/issues/${id}/assist`, { method: "POST" });
export const talkingPoints = (ward_id: string, event?: string) => api<{ points: string }>("/ai/talking-points", { body: { ward_id, event } });
