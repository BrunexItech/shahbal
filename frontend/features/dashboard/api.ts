"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";

/** The Command Centre polls; 20s keeps it live without hammering the API. */
export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api<DashboardSummary>("/dashboard/summary"),
    refetchInterval: 20_000,
  });
