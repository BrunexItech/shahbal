"use client";

import { Play } from "lucide-react";

import { cn } from "@/lib/cn";

import type { Video } from "./api";
import { mediaUrl } from "./media";

export const VIDEO_TOPICS: [string, string][] = [
  ["rallies", "Rallies"], ["town_halls", "Town halls"], ["interviews", "Interviews"], ["agenda", "Our agenda"], ["community", "In the community"], ["other", "Other"],
];
export const topicLabel = (id: string) => VIDEO_TOPICS.find(([k]) => k === id)?.[1] ?? "Video";

export const clock = (s: number | null) => (s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });

type Source = Pick<Video, "youtube_id" | "media_id" | "has_poster" | "duration">;

/** The preview picture: our own (made on upload) or YouTube's. */
export function VideoPoster({ v, className, big, small }: { v: Source; className?: string; big?: boolean; small?: boolean }) {
  const src = v.youtube_id ? `https://i.ytimg.com/vi/${v.youtube_id}/${big ? "hqdefault" : "mqdefault"}.jpg`
    : v.media_id && v.has_poster ? mediaUrl(v.media_id, true) : null;
  return (
    <span className={cn("relative block overflow-hidden bg-gradient-to-br from-[#0b1f3a] to-[#004d2d]", className)}>
      {src && <img src={src} alt="" loading="lazy" className="size-full object-cover" />}
      <span className="absolute inset-0 grid place-items-center">
        <span className={cn("grid place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur transition group-hover:scale-110 group-hover:bg-kenya-red", small ? "size-8" : "size-12")}>
          <Play className={cn("ml-0.5 fill-current", small ? "size-3.5" : "size-5")} />
        </span>
      </span>
      {clock(v.duration) && !small && <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">{clock(v.duration)}</span>}
    </span>
  );
}

/** Plays one video: our own file, or YouTube (privacy-enhanced). Keyed by the caller so switching starts fresh. */
export function VideoPlayer({ v, autoPlay }: { v: Source & { content_type?: string | null }; autoPlay?: boolean }) {
  if (v.youtube_id) {
    return (
      <iframe src={`https://www.youtube-nocookie.com/embed/${v.youtube_id}?rel=0${autoPlay ? "&autoplay=1" : ""}`} title="Video" className="aspect-video w-full bg-black"
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
    );
  }
  return (
    <video src={v.media_id ? mediaUrl(v.media_id) : undefined} poster={v.media_id && v.has_poster ? mediaUrl(v.media_id, true) : undefined}
      controls playsInline preload="metadata" autoPlay={autoPlay} className="aspect-video w-full bg-black" />
  );
}

export function VideoCard({ v, onPlay, active }: { v: Video; onPlay: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onPlay} aria-label={`Play ${v.title}`}
      className={cn("group flex w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md",
        active ? "ring-2 ring-kenya-green" : "ring-line")}>
      <VideoPoster v={v} className="aspect-video w-full" />
      <span className="flex flex-1 flex-col p-4">
        <span className="text-xs font-bold tracking-wider text-kenya-green uppercase">{topicLabel(v.topic)}</span>
        <span className="mt-1 line-clamp-2 font-semibold text-navy-900">{v.title}</span>
        <span className="mt-auto pt-2 text-xs text-slate-500">{active ? "Now playing" : shortDate(v.published_at)}</span>
      </span>
    </button>
  );
}
