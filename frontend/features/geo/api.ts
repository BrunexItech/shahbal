"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Constituency, Station, Ward } from "@/lib/types";

export const geoKeys = {
  tree: ["geo", "tree"] as const,
  stations: (wardId?: string, q?: string) => ["geo", "stations", wardId ?? "all", q ?? ""] as const,
  portal: ["portal", "geo"] as const,
  portalStations: (wardId: string) => ["portal", "stations", wardId] as const,
};

/** Geography changes rarely; cache it for the session. */
const STATIC = { staleTime: 30 * 60_000 };

/** Device cache so the capture pickers still work with no signal. Public geography only, no PII. */
function cached<T>(key: string, fetcher: () => Promise<T>) {
  return async () => {
    try {
      const data = await fetcher();
      try {
        window.localStorage.setItem(`chq.geo.${key}`, JSON.stringify(data));
      } catch {}
      return data;
    } catch (e) {
      try {
        const raw = window.localStorage.getItem(`chq.geo.${key}`);
        if (raw) return JSON.parse(raw) as T;
      } catch {}
      throw e;
    }
  };
}

export const useGeoTree = () =>
  useQuery({ queryKey: geoKeys.tree, queryFn: cached("tree", () => api<Constituency[]>("/geo/tree")), ...STATIC });

export const useStations = (wardId?: string, q?: string, enabled = true) =>
  useQuery({
    queryKey: geoKeys.stations(wardId, q),
    queryFn: q ? () => api<Station[]>("/geo/stations", { query: { ward_id: wardId, q } })
      : cached(`stations.${wardId ?? "all"}`, () => api<Station[]>("/geo/stations", { query: { ward_id: wardId } })),
    enabled,
    staleTime: 5 * 60_000,
  });

export const usePortalGeo = () =>
  useQuery({ queryKey: geoKeys.portal, queryFn: () => api<Constituency[]>("/portal/geo", { silent401: true }), ...STATIC });

export const usePortalStations = (wardId: string) =>
  useQuery({
    queryKey: geoKeys.portalStations(wardId),
    queryFn: () => api<Station[]>("/portal/stations", { query: { ward_id: wardId }, silent401: true }),
    enabled: !!wardId,
    ...STATIC,
  });

export function useUpdateWard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; target?: number; registered_voters?: number | null }) =>
      api<Ward>(`/geo/wards/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["geo"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export type StationInput = Omit<Station, "id">;

export function useSaveStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<StationInput> & { id?: string }) =>
      id ? api<Station>(`/geo/stations/${id}`, { method: "PATCH", body }) : api<Station>("/geo/stations", { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["geo", "stations"] }),
  });
}

export function useImportStations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ created: number; updated: number; errors: string[] }>("/geo/stations/import", { form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["geo", "stations"] }),
  });
}

/** Flatten helpers used by pickers and tables. */
export function wardIndex(tree: Constituency[] | undefined) {
  const map = new Map<string, Ward & { constituency: string }>();
  tree?.forEach((c) => c.wards.forEach((w) => map.set(w.id, { ...w, constituency: c.name })));
  return map;
}
