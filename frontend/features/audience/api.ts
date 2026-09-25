"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Audience, Support } from "@/lib/types";

type Counts = { people: number; reachable: number; supporters: number };
export type AudienceStation = Counts & { id: string; name: string; code: string };
export type AudienceWard = Counts & { id: string; name: string; code: string; stations: AudienceStation[] };
export type AudienceConstituency = Counts & { id: string; name: string; code: string; wards: AudienceWard[] };
export type AudienceTree = Counts & { constituencies: AudienceConstituency[] };
export type AudiencePerson = {
  id: string; reference: string; full_name: string; phone: string; support: Support; source: string;
  ward: string; constituency: string; station: string | null;
};
export type AudiencePeople = { total: number; by_support: Partial<Record<Support, number>>; people: AudiencePerson[] };

export const useAudienceTree = () =>
  useQuery({ queryKey: ["audience", "tree"], queryFn: () => api<AudienceTree>("/audience/tree"), staleTime: 60_000 });

export const useAudiencePeople = (audience: Partial<Audience>, q: string) =>
  useQuery({
    queryKey: ["audience", "people", audience, q],
    queryFn: () => api<AudiencePeople>("/audience/people", { method: "POST", body: { audience, q: q || null, limit: 60 } }),
    placeholderData: keepPreviousData,
  });
