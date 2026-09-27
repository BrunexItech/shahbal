"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { MediaMap } from "./media";

export type SitePage = { key: string; title: string; body: string; media: MediaMap; updated_at: string | null };
export type NewsItem = { id: string; slug: string; title: string; summary: string; published: boolean; published_at: string | null; cover_id: string | null; body?: string; media?: MediaMap };
export type AgendaItem = { id: string; title: string; summary: string; body: string; cover_id: string | null; position: number; published: boolean; media: MediaMap; updated_at: string };
export type PublicEvent = { id: string; title: string; kind: string; venue: string; starts_at: string; ends_at: string | null; ward: string; constituency: string };

export const usePage = (key: string) => useQuery({ queryKey: ["site", "page", key], queryFn: () => api<SitePage>(`/site/pages/${key}`, { silent401: true }) });
export const useNews = () => useQuery({ queryKey: ["site", "news"], queryFn: () => api<NewsItem[]>("/site/news", { silent401: true }) });
export const useStory = (slug: string) => useQuery({ queryKey: ["site", "story", slug], queryFn: () => api<NewsItem>(`/site/news/${slug}`, { silent401: true }), retry: false });
export const usePublicEvents = () => useQuery({ queryKey: ["site", "events"], queryFn: () => api<PublicEvent[]>("/site/events", { silent401: true }) });
export const useAgenda = () => useQuery({ queryKey: ["site", "agenda"], queryFn: () => api<AgendaItem[]>("/site/agenda", { silent401: true }) });
