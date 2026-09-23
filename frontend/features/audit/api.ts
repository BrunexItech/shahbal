"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { AuditEntry, Page } from "@/lib/types";

export const useAudit = (f: { action?: string; entity_id?: string; page: number }) =>
  useQuery({
    queryKey: ["audit", f],
    queryFn: () => api<Page<AuditEntry>>("/audit", { query: { ...f, size: 50 } }),
    placeholderData: keepPreviousData,
  });
