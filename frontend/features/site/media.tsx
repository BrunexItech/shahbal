"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ImageIcon, ImagePlus, Images, Link2, Play, Search, Trash2, Type, X } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Input, Modal, useConfirm } from "@/components/ui";
import { Markdown } from "@/features/ai/Markdown";
import { api, apiUrl } from "@/lib/api";
import { cn } from "@/lib/cn";

export type Media = {
  id: string; kind: "image" | "video"; content_type: string; width: number | null; height: number | null; caption: string | null; has_thumb: boolean;
  label?: string | null; size?: number; created_at?: string; // HQ only
};
export type MediaMap = Record<string, Media>;

export const mediaUrl = (id: string, thumb = false) => apiUrl(`/site/media/${id}`, thumb ? { thumb: 1 } : undefined);

// Stored text keeps each photo/video on its own line as [[media:id]] or [[youtube:id]]. Writers never see these:
// the editor shows them as cards, and the website shows the photo or video itself.
const MEDIA_LINE = /^\[\[(media|youtube):([A-Za-z0-9_-]{11}|[0-9a-f-]{36})\]\]$/;
const YT = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/;

export function youtubeId(url: string): string | null {
  const t = url.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(t) ? t : YT.exec(t)?.[1] ?? null;
}

type Block = { key: string; kind: "text"; text: string } | { key: string; kind: "media" | "youtube"; id: string };
let seq = 0;
const k = () => `b${++seq}`;

export function parseBlocks(body: string): Block[] {
  const out: Block[] = [];
  let buf: string[] = [];
  const flush = () => { const t = buf.join("\n").replace(/^\n+|\n+$/g, ""); if (t) out.push({ key: k(), kind: "text", text: t }); buf = []; };
  for (const line of body.split("\n")) {
    const m = MEDIA_LINE.exec(line.trim());
    if (m) { flush(); out.push({ key: k(), kind: m[1] as "media" | "youtube", id: m[2] }); } else buf.push(line);
  }
  flush();
  return out.length ? out : [{ key: k(), kind: "text", text: "" }];
}

const serialize = (blocks: Block[]) =>
  blocks.map((b) => (b.kind === "text" ? b.text.trim() : `[[${b.kind}:${b.id}]]`)).filter(Boolean).join("\n\n");

export const useMediaLibrary = (q = "") =>
  useQuery({ queryKey: ["site-admin", "media", q], queryFn: () => api<Media[]>("/site-admin/media", { query: { q: q || undefined } }) });

/** Everything uploaded, by id: for previews. */
export function useMediaMap(): MediaMap {
  const lib = useMediaLibrary();
  return Object.fromEntries((lib.data ?? []).map((m) => [m.id, m]));
}

/** Page or story text with its photos, videos and YouTube clips. */
export function RichBody({ text, media, className, compact }: { text: string; media?: MediaMap; className?: string; compact?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className}>
      {blocks.map((b) => (
        <Fragment key={b.key}>
          {b.kind === "text" ? (b.text ? <Markdown text={b.text} /> : null) : <MediaBlock kind={b.kind} id={b.id} item={media?.[b.id]} compact={compact} />}
        </Fragment>
      ))}
    </div>
  );
}

/** Photos and videos at a standard size: never taller than a screenful, however the photo was taken. */
function MediaBlock({ kind, id, item, compact }: { kind: string; id: string; item?: Media; compact?: boolean }) {
  const box = compact ? "max-h-56" : "max-h-[26rem]";
  if (kind === "youtube") {
    return (
      <div className={cn("my-4 aspect-video overflow-hidden rounded-xl bg-slate-900", compact ? "max-w-sm" : "max-w-2xl")}>
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title="Video" className="size-full" loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  if (!item) return null; // deleted from the library
  return (
    <figure className={cn("my-4", compact ? "max-w-sm" : "max-w-2xl")}>
      {item.kind === "video"
        ? <video src={mediaUrl(id)} controls preload="metadata" playsInline className={cn("w-full rounded-xl bg-slate-900", box)} />
        : <img src={mediaUrl(id, compact)} alt={item.caption ?? ""} width={item.width ?? undefined} height={item.height ?? undefined} loading="lazy"
            className={cn("h-auto w-auto max-w-full rounded-xl object-contain", box)} />}
      {item.caption && <figcaption className="mt-1.5 text-sm text-slate-500">{item.caption}</figcaption>}
    </figure>
  );
}

const refreshLibrary = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["site-admin", "media"] });

export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, label }: { file: File; label?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (label) form.append("label", label);
      return api<Media>("/site-admin/media", { form });
    },
    onSuccess: () => refreshLibrary(qc),
    onError: (e) => toast.error(e.message),
  });
}

function useUpdateMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; caption?: string }) => api<Media>(`/site-admin/media/${id}`, { method: "PATCH", body }),
    onSuccess: () => refreshLibrary(qc),
    onError: (e) => toast.error(e.message),
  });
}

const ACCEPT_ALL = "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime";
const ACCEPT_PHOTO = "image/jpeg,image/png,image/webp";

/**
 * The writing area for pages, stories and agenda items: text boxes and media cards in order.
 * Photos and videos can be captioned, named (HQ only), moved and removed; nobody types codes.
 */
export function BlockEditor({ initial, onChange, label = "Text" }: { initial: string; onChange: (body: string) => void; label?: string }) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(initial));
  const [active, setActive] = useState<number | null>(null);
  const [yt, setYt] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const upload = useUpload();
  const media = useMediaMap();
  const confirm = useConfirm();

  const commit = (next: Block[]) => { setBlocks(next); onChange(serialize(next)); };
  const insert = (b: Block) => {
    const i = active === null ? blocks.length : active + 1;
    const next = [...blocks.slice(0, i), b, ...blocks.slice(i)];
    // Leave somewhere to carry on writing after a photo at the end.
    if (i === blocks.length && b.kind !== "text") next.push({ key: k(), kind: "text", text: "" });
    commit(next);
    setActive(i);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
    setActive(j);
  };
  const remove = async (i: number) => {
    const b = blocks[i];
    if (b.kind === "text" && b.text.trim() && !(await confirm({ title: "Remove this paragraph?", body: "The text in it will be deleted.", confirmLabel: "Remove", danger: true }))) return;
    const next = blocks.filter((_, x) => x !== i);
    commit(next.length ? next : [{ key: k(), kind: "text", text: "" }]);
    setActive(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-navy-900">{label}</p>
      <ol className="space-y-2">
        {blocks.map((b, i) => (
          <li key={b.key} onFocusCapture={() => setActive(i)}
            className={cn("group relative rounded-xl ring-1 transition", active === i ? "ring-ocean/50" : "ring-line", b.kind === "text" ? "bg-white" : "bg-slate-50 p-2")}>
            {b.kind === "text" ? (
              <textarea value={b.text} aria-label={`${label}, paragraph ${i + 1}`} maxLength={20000}
                rows={Math.max(3, b.text.split("\n").length + 1)} placeholder="Write here…"
                onChange={(e) => commit(blocks.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)))}
                className="block w-full resize-y rounded-xl bg-transparent py-2.5 pr-3.5 pl-3.5 text-base text-ink placeholder:text-slate-400 focus:outline-none sm:pr-28 sm:text-sm" />
            ) : b.kind === "youtube" ? (
              <div className="flex items-center gap-3 sm:pr-28">
                <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-[#c4302b] text-white"><Play className="size-6" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-navy-900">YouTube video</p>
                  <a href={`https://youtu.be/${b.id}`} target="_blank" rel="noreferrer" className="text-xs text-ocean hover:underline">Open on YouTube</a>
                </div>
              </div>
            ) : (
              <MediaCard id={b.id} item={media[b.id]} />
            )}
            <div className={cn("absolute top-2 right-2 flex gap-0.5 rounded-lg bg-white/95 p-0.5 shadow-sm ring-1 ring-line transition",
              b.kind === "text" && active !== i && "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100")}>
              <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconBtn>
              <IconBtn label="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconBtn>
              <IconBtn label="Remove" danger onClick={() => void remove(i)}><Trash2 className="size-4" /></IconBtn>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2 pt-1">
        <input ref={file} type="file" hidden accept={ACCEPT_ALL} onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload.mutate({ file: f }, { onSuccess: (m) => { insert({ key: k(), kind: "media", id: m.id }); toast.success(m.kind === "video" ? "Video added" : "Photo added"); } });
        }} />
        <Button size="sm" variant="secondary" icon={<Type className="size-4" />} onClick={() => insert({ key: k(), kind: "text", text: "" })}>Paragraph</Button>
        <Button size="sm" variant="secondary" icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>
          {upload.isPending ? "Uploading…" : "Photo or video"}
        </Button>
        <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setYt(yt === null ? "" : null)}>YouTube</Button>
        <Button size="sm" variant="secondary" icon={<Images className="size-4" />} onClick={() => setLibrary(true)}>From library</Button>
      </div>
      {yt !== null && (
        <div className="flex gap-2">
          <Input aria-label="YouTube link" placeholder="Paste the YouTube link" value={yt} onChange={(e) => setYt(e.target.value)} className="flex-1" autoFocus />
          <Button size="sm" className="h-11" disabled={!youtubeId(yt)} onClick={() => { insert({ key: k(), kind: "youtube", id: youtubeId(yt)! }); setYt(null); }}>Add</Button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        New items go below the selected block. In text, start a line with ## for a heading or - for a bullet, and wrap words in **double stars** for bold.
        Photos up to 15 MB; videos up to 95 MB (MP4, WebM or MOV). For longer videos, post them on YouTube and paste the link.
      </p>
      {library && <MediaLibrary onClose={() => setLibrary(false)} onPick={(m) => { insert({ key: k(), kind: "media", id: m.id }); setLibrary(false); }} />}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={cn("grid size-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 disabled:opacity-30", danger ? "hover:text-kenya-red" : "hover:text-navy-900")}>
      {children}
    </button>
  );
}

/** A photo or video inside the editor: preview, HQ's name for it, and the public caption. */
function MediaCard({ id, item }: { id: string; item?: Media }) {
  const update = useUpdateMedia();
  if (!item) return <p className="py-3 pl-2 text-sm text-slate-500 sm:pr-28">This file was deleted from the library. Remove it or pick another.</p>;
  return (
    <div className="flex flex-col gap-2 pt-10 sm:flex-row sm:gap-3 sm:pt-0 sm:pr-28">
      <Thumb item={item} className="h-16 w-24 sm:h-20 sm:w-32" />
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
        <MetaField label="Name (HQ only)" max={120} value={item.label ?? ""} placeholder="e.g. Likoni rally, June" onSave={(v) => update.mutate({ id, label: v })} />
        <MetaField label="Caption on the website" max={200} value={item.caption ?? ""} placeholder="Optional" onSave={(v) => update.mutate({ id, caption: v })} />
      </div>
    </div>
  );
}

function MetaField({ label, value, placeholder, max, onSave }: { label: string; value: string; placeholder?: string; max: number; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input value={v} placeholder={placeholder} maxLength={max}
        onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        className="mt-0.5 h-9 w-full rounded-lg border border-line bg-white px-2.5 text-base focus:border-ocean focus:outline-none sm:text-sm" />
    </label>
  );
}

function Thumb({ item, className }: { item: Media; className?: string }) {
  return item.kind === "video"
    ? <span className={cn("grid shrink-0 place-items-center rounded-lg bg-navy-950 text-white", className)}><Play className="size-6" /></span>
    : <img src={mediaUrl(item.id, true)} alt="" loading="lazy" className={cn("shrink-0 rounded-lg object-cover", className)} />;
}

/** Cover photo chooser for stories and agenda items. */
export function CoverPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-navy-900">Cover photo</p>
      <div className="flex items-center gap-3">
        {value
          ? <img src={mediaUrl(value, true)} alt="" className="h-16 w-24 rounded-lg object-cover ring-1 ring-line" />
          : <span className="grid h-16 w-24 place-items-center rounded-lg bg-slate-100 text-slate-300"><ImageIcon className="size-6" /></span>}
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{value ? "Change" : "Choose"}</Button>
        {value && <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onChange(null)}>Remove</Button>}
      </div>
      {open && <MediaLibrary only="image" selected={value} onClose={() => setOpen(false)} onPick={(m) => { onChange(m.id); setOpen(false); }} />}
    </div>
  );
}

/** Everything uploaded: search by name, rename, pick one, or delete what's no longer needed. */
export function MediaLibrary({ onClose, onPick, only, selected }: { onClose: () => void; onPick?: (m: Media) => void; only?: "image"; selected?: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const lib = useMediaLibrary(q.trim());
  const file = useRef<HTMLInputElement>(null);
  const upload = useUpload();
  const update = useUpdateMedia();
  const del = useMutation({
    mutationFn: (id: string) => api(`/site-admin/media/${id}`, { method: "DELETE" }),
    onSuccess: () => { refreshLibrary(qc); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const items = (lib.data ?? []).filter((m) => !only || m.kind === only);
  return (
    <Modal open onClose={onClose} size="lg" title={only ? "Choose a cover photo" : "Media library"} subtitle="Photos and videos uploaded for the website. Names are only seen by HQ."
      footer={<>
        <input ref={file} type="file" hidden accept={only ? ACCEPT_PHOTO : ACCEPT_ALL}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload.mutate({ file: f }, { onSuccess: () => toast.success("Uploaded") }); }} />
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>Upload</Button>
      </>}>
      <Input aria-label="Search by name or caption" placeholder="Search by name or caption" value={q} onChange={(e) => setQ(e.target.value)}
        leading={<Search className="size-4" />} className="mb-4" />
      {lib.isLoading ? <p className="py-10 text-center text-sm text-slate-500">Loading…</p> : !items.length ? (
        <p className="py-10 text-center text-sm text-slate-500">{q ? "Nothing matches that name." : "Nothing uploaded yet."}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m) => (
            <li key={m.id} className={cn("relative overflow-hidden rounded-xl bg-white ring-1 ring-line", selected === m.id && "ring-2 ring-kenya-green")}>
              <button type="button" onClick={() => onPick?.(m)} disabled={!onPick} className="block w-full" aria-label={`Use ${m.label ?? "this file"}`}>
                <Thumb item={m} className="aspect-[4/3] h-auto w-full rounded-none" />
              </button>
              {selected === m.id && <span className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-kenya-green text-white"><Check className="size-4" /></span>}
              <button type="button" onClick={async () => { if (await confirm({ title: `Delete ${m.label ?? "this file"}?`, body: "It disappears from every page and story that uses it.", confirmLabel: "Delete", danger: true })) del.mutate(m.id); }}
                className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-white/90 text-slate-600 shadow hover:text-kenya-red" aria-label={`Delete ${m.label ?? "file"}`}>
                <Trash2 className="size-4" />
              </button>
              <input defaultValue={m.label ?? ""} aria-label="Name" placeholder="Add a name" maxLength={120}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.label ?? "")) update.mutate({ id: m.id, label: v }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-full truncate border-t border-line px-2 py-1.5 text-base text-navy-900 focus:bg-ocean-50 focus:outline-none sm:text-xs" />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
