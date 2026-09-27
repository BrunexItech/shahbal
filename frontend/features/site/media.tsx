"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Images, Link2, Play, Trash2 } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Input, Modal, useConfirm } from "@/components/ui";
import { Markdown } from "@/features/ai/Markdown";
import { api, apiUrl } from "@/lib/api";
import { cn } from "@/lib/cn";

export type Media = { id: string; kind: "image" | "video"; content_type: string; width: number | null; height: number | null; caption: string | null; size: number; has_thumb: boolean };
export type MediaMap = Record<string, Media>;

export const mediaUrl = (id: string, thumb = false) => apiUrl(`/site/media/${id}`, thumb ? { thumb: 1 } : undefined);

const MEDIA_LINE = /^\[\[(media|youtube):([A-Za-z0-9_-]{11}|[0-9a-f-]{36})\]\]$/;
const YT = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/;

export function youtubeId(url: string): string | null {
  const t = url.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(t) ? t : YT.exec(t)?.[1] ?? null;
}

export const useMediaLibrary = () => useQuery({ queryKey: ["site-admin", "media"], queryFn: () => api<Media[]>("/site-admin/media") });

/** Page or story text with photos, videos and YouTube clips placed on their own lines. */
export function RichBody({ text, media, className }: { text: string; media?: MediaMap; className?: string }) {
  const blocks: ({ md: string } | { kind: string; id: string })[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.join("").trim()) blocks.push({ md: buf.join("\n") }); buf = []; };
  for (const line of text.split("\n")) {
    const m = MEDIA_LINE.exec(line.trim());
    if (m) { flush(); blocks.push({ kind: m[1], id: m[2] }); } else buf.push(line);
  }
  flush();
  return (
    <div className={className}>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {"md" in b ? <Markdown text={b.md} /> : <MediaBlock kind={b.kind} id={b.id} item={media?.[b.id]} />}
        </Fragment>
      ))}
    </div>
  );
}

function MediaBlock({ kind, id, item }: { kind: string; id: string; item?: Media }) {
  if (kind === "youtube") {
    return (
      <div className="my-5 aspect-video overflow-hidden rounded-xl bg-slate-900">
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title="Video" className="size-full" loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  if (!item) return null; // removed from the library
  return (
    <figure className="my-5">
      {item.kind === "video"
        ? <video src={mediaUrl(id)} controls preload="metadata" playsInline className="w-full rounded-xl bg-slate-900" />
        : <img src={mediaUrl(id)} alt={item.caption ?? ""} width={item.width ?? undefined} height={item.height ?? undefined} loading="lazy" className="h-auto w-full rounded-xl" />}
      {item.caption && <figcaption className="mt-2 text-sm text-slate-500">{item.caption}</figcaption>}
    </figure>
  );
}

/** Upload one photo or video. Shared by the toolbar and the cover picker. */
export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, caption }: { file: File; caption?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (caption) form.append("caption", caption);
      return api<Media>("/site-admin/media", { form });
    },
    onSuccess: (m) => { qc.setQueryData<Media[]>(["site-admin", "media"], (l) => [m, ...(l ?? [])]); },
    onError: (e) => toast.error(e.message),
  });
}

/** Buttons above a body editor: add a photo/video, a YouTube clip, or something already uploaded. */
export function MediaToolbar({ onInsert }: { onInsert: (token: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const upload = useUpload();
  const [yt, setYt] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const ytId = yt ? youtubeId(yt) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload.mutate({ file: f }, { onSuccess: (m) => { onInsert(`[[media:${m.id}]]`); toast.success(m.kind === "video" ? "Video added" : "Photo added"); } });
          }} />
        <Button size="sm" variant="secondary" icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>
          {upload.isPending ? "Uploading…" : "Photo or video"}
        </Button>
        <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setYt(yt === null ? "" : null)}>YouTube</Button>
        <Button size="sm" variant="secondary" icon={<Images className="size-4" />} onClick={() => setLibrary(true)}>Media library</Button>
      </div>
      {yt !== null && (
        <div className="flex gap-2">
          <Input aria-label="YouTube link" placeholder="Paste the YouTube link" value={yt} onChange={(e) => setYt(e.target.value)} className="flex-1" />
          <Button size="sm" disabled={!ytId} className="h-11" onClick={() => { onInsert(`[[youtube:${ytId}]]`); setYt(null); }}>Add</Button>
        </div>
      )}
      <p className="text-xs text-slate-500">Photos up to 15 MB, videos up to 95 MB (MP4, WebM or MOV). Longer videos: upload to YouTube and paste the link.</p>
      {library && <MediaLibrary onClose={() => setLibrary(false)} onPick={(m) => { onInsert(`[[media:${m.id}]]`); setLibrary(false); }} />}
    </div>
  );
}

/** Everything uploaded so far: pick one, or delete what's no longer needed. */
export function MediaLibrary({ onClose, onPick, only, selected }: { onClose: () => void; onPick: (m: Media) => void; only?: "image"; selected?: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const lib = useMediaLibrary();
  const file = useRef<HTMLInputElement>(null);
  const upload = useUpload();
  const del = useMutation({
    mutationFn: (id: string) => api(`/site-admin/media/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => { qc.setQueryData<Media[]>(["site-admin", "media"], (l) => l?.filter((m) => m.id !== id)); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const items = (lib.data ?? []).filter((m) => !only || m.kind === only);
  return (
    <Modal open onClose={onClose} size="lg" title={only ? "Choose a cover photo" : "Media library"} subtitle="Photos and videos uploaded for the website."
      footer={<>
        <input ref={file} type="file" hidden accept={only ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload.mutate({ file: f }); }} />
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>Upload</Button>
      </>}>
      {lib.isLoading ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p> : !items.length ? (
        <p className="py-10 text-center text-sm text-slate-500">Nothing uploaded yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m) => (
            <li key={m.id} className={cn("group relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-line", selected === m.id && "ring-2 ring-kenya-green")}>
              <button onClick={() => onPick(m)} className="block aspect-[4/3] w-full" aria-label={`Use ${m.caption ?? (m.kind === "video" ? "this video" : "this photo")}`}>
                {m.kind === "video"
                  ? <span className="grid size-full place-items-center bg-navy-950 text-white"><Play className="size-8" /></span>
                  : <img src={mediaUrl(m.id, true)} alt="" loading="lazy" className="size-full object-cover" />}
              </button>
              {selected === m.id && <span className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-kenya-green text-white"><Check className="size-4" /></span>}
              <button onClick={async () => { if (await confirm({ title: "Delete this file?", body: "It disappears from every page and story that uses it.", confirmLabel: "Delete", danger: true })) del.mutate(m.id); }}
                className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-white/90 text-slate-600 shadow hover:text-kenya-red" aria-label="Delete">
                <Trash2 className="size-4" />
              </button>
              {m.caption && <p className="truncate px-2 py-1.5 text-xs text-slate-600">{m.caption}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Remembers where the writer's cursor was in a textarea (clicking a toolbar button moves focus away),
 *  and puts media lines there, or at the end if they never placed it. */
export function useCaret() {
  const pos = useRef<number | null>(null);
  const track = (e: React.SyntheticEvent<HTMLTextAreaElement>) => { pos.current = e.currentTarget.selectionStart; };
  const insert = (value: string, token: string): string => {
    const at = Math.min(pos.current ?? value.length, value.length);
    const before = value.slice(0, at), after = value.slice(at);
    const head = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${token}\n`;
    pos.current = head.length; // the next insert follows this one
    return head + (after.startsWith("\n") ? after.slice(1) : after);
  };
  return { track, insert, trackProps: { onSelect: track, onKeyUp: track, onClick: track } };
}
