"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Breakdown, DashboardSummary } from "@/lib/types";

/** The Command Centre polls; 20s keeps it live without hammering the API. */
export const useDashboard = (enabled = true) =>
  useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api<DashboardSummary>("/dashboard/summary"),
    refetchInterval: 20_000,
    enabled,
  });

/** Captures by constituency → ward → polling station (Targets page). */
export const useBreakdown = () =>
  useQuery({
    queryKey: ["dashboard", "breakdown"],
    queryFn: () => api<Breakdown>("/dashboard/breakdown"),
    refetchInterval: 30_000,
  });
