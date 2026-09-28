"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { IssueCategory, IssuePriority, IssueSource, IssueStatus } from "./meta";

export interface Issue {
  id: string; reference: string; category: IssueCategory; summary: string; description: string;
  ward_id: string; ward: string; constituency: string; area: string | null; latitude: number | null; longitude: number | null;
  source: IssueSource; status: IssueStatus; priority: IssuePriority; assigned_to_id: string | null; assigned_to: string | null;
  reporter_name: string | null; reporter_phone: string | null; contact_ok: boolean; reported_by: string | null; photos: number;
  created_at: string; updated_at: string | null; resolved_at: string | null;
}
export interface IssueDetail extends Issue {
  updates: { id: string; kind: string; status: IssueStatus | null; note: string | null; public: boolean; author: string | null; created_at: string; sms_status?: "sent" | "delivered" | "failed" | null }[];
  sms_live?: boolean;
  photo_list: { id: string; url: string; width: number; height: number; by_resident: boolean; created_at: string }[];
  can_manage: boolean;
}
export interface IssueStats {
  total: number; open: number; new: number; resolved: number; recent: number; urgent: number; days: number;
  median_hours_to_resolve: number | null; oldest_open_at: string | null;
  by_category: { category: IssueCategory; label: string; total: number; open: number; resolved: number }[];
  by_ward: { ward_id: string; ward: string; constituency: string; total: number; open: number; resolved: number; top: IssueCategory | null }[];
  by_source: Partial<Record<IssueSource, number>>;
  weekly: { week: string; reported: number; resolved: number }[];
}
export type IssueFilters = { status?: string; category?: string; ward_id?: string; source?: string; mine?: boolean; q?: string; page?: number };
export type IssuePin = { id: string; reference: string; category: IssueCategory; status: IssueStatus; priority: IssuePriority; summary: string;
  lat: number; lng: number; ward_id: string; created_at: string };

export const useIssues = (f: IssueFilters) =>
  useQuery({
    queryKey: ["issues", "list", f],
    queryFn: () => api<{ items: Issue[]; total: number }>("/issues", { query: { ...f, mine: f.mine || undefined, size: 30 } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

export const useIssue = (id: string | null) =>
  useQuery({ queryKey: ["issues", "one", id], queryFn: () => api<IssueDetail>(`/issues/${id}`), enabled: !!id });

export const useIssueStats = (enabled = true) =>
  useQuery({ queryKey: ["issues", "stats"], queryFn: () => api<IssueStats>("/issues/stats"), enabled, refetchInterval: 60_000 });

export const useIssuePins = (enabled = true) =>
  useQuery({ queryKey: ["issues", "map"], queryFn: () => api<IssuePin[]>("/issues/map"), enabled, refetchInterval: 60_000 });

export const useAssignees = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: ["issues", "assignees", id], queryFn: () => api<{ id: string; full_name: string; role: string }[]>(`/issues/${id}/assignees`), enabled: !!id && enabled });

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["issues"] });
}

export type NewIssue = {
  category: IssueCategory; ward_id: string; area?: string; description: string; latitude?: number; longitude?: number;
  reporter_name?: string; reporter_phone?: string; contact_ok: boolean; consent: true; priority?: IssuePriority; voter_id?: string; client_ref?: string;
};

export function useCreateIssue() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: NewIssue) => api<IssueDetail>("/issues", { body }), onSuccess: refresh });
}

export type IssuePatch = { status?: IssueStatus; priority?: IssuePriority; category?: IssueCategory; assigned_to_id?: string; unassign?: boolean; note?: string; public?: boolean };

/** A coordinator texts the resident directly; the case comes back with the SMS outcome in its history. */
export function useSmsResident(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (message: string) => api<IssueDetail>(`/issues/${id}/sms`, { body: { message } }), onSuccess: refresh });
}

export function useUpdateIssue(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: IssuePatch) => api<IssueDetail>(`/issues/${id}`, { method: "PATCH", body }), onSuccess: refresh });
}

export function useIssuePhoto(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api(`/issues/${id}/photos`, { form });
    },
    onSuccess: refresh,
  });
}
