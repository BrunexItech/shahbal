"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";

import { api } from "@/lib/api";
import type { Activity, MapOverview } from "@/lib/types";

export const useMapOverview = () => useQuery({ queryKey: ["map", "overview"], queryFn: () => api<MapOverview>("/map/overview"), refetchInterval: 30_000 });

export const useBoundaries = () =>
  useQuery({ queryKey: ["map", "boundaries"], queryFn: () => api<FeatureCollection>("/map/boundaries"), staleTime: Infinity });

export const useActivity = (enabled: boolean) =>
  useQuery({ queryKey: ["map", "activity"], queryFn: () => api<Activity[]>("/map/activity"), refetchInterval: 10_000, enabled });

export const useConstituencyOutlines = () =>
  useQuery({ queryKey: ["map", "constituencies"], queryFn: () => api<FeatureCollection>("/map/boundaries/constituencies"), staleTime: Infinity });
