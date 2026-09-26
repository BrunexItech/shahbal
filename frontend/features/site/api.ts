"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type SitePage = { key: string; title: string; body: string; updated_at: string | null };
export type NewsItem = { id: string; slug: string; title: string; summary: string; published: boolean; published_at: string | null; body?: string };
export type PublicEvent = { id: string; title: string; kind: string; venue: string; starts_at: string; ends_at: string | null; ward: string; constituency: string };

export const usePage = (key: string) => useQuery({ queryKey: ["site", "page", key], queryFn: () => api<SitePage>(`/site/pages/${key}`, { silent401: true }) });
export const useNews = () => useQuery({ queryKey: ["site", "news"], queryFn: () => api<NewsItem[]>("/site/news", { silent401: true }) });
export const useStory = (slug: string) => useQuery({ queryKey: ["site", "story", slug], queryFn: () => api<NewsItem>(`/site/news/${slug}`, { silent401: true }), retry: false });
export const usePublicEvents = () => useQuery({ queryKey: ["site", "events"], queryFn: () => api<PublicEvent[]>("/site/events", { silent401: true }) });
