"use client";

import { useQuery } from "@tanstack/react-query";

import { ApiError, fetchBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

/** Loads a staff photo once per session (authenticated, never public), then reuses it. */
export function usePhoto(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["photo", userId],
    queryFn: async () => {
      try {
        return URL.createObjectURL(await fetchBlob(`/users/${userId}/photo`));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null; // no photo / not visible
        throw e;
      }
    },
    enabled: !!userId && enabled,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

export function Avatar({ userId, name, size = 40, hasPhoto, className, ring = true }: {
  userId?: string | null;
  name: string;
  size?: number;
  /** Pass false when you know there's no photo, to skip the request. */
  hasPhoto?: boolean;
  className?: string;
  ring?: boolean;
}) {
  const { data: url } = usePhoto(userId, hasPhoto !== false);
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-navy-800 to-navy-950 font-bold text-gold",
      ring && "ring-2 ring-white shadow-sm", className)} style={{ width: size, height: size, fontSize: Math.max(12, size * 0.34) }}>
      {url ? <img src={url} alt={name} className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
