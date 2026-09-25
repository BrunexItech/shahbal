"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { Button, Modal, useConfirm } from "@/components/ui";
import { api, ApiError, fetchBlob } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";
import { can } from "@/lib/roles";
import type { Visit } from "@/lib/types";

export type VisitPhoto = { id: string; url: string; width: number; height: number; taken_by: string; taken_by_id: string; created_at: string };

const keys = { list: (vid: string) => ["visit-photos", vid] as const };

export const useVisitPhotos = (vid: string, enabled = true) =>
  useQuery({ queryKey: keys.list(vid), queryFn: () => api<VisitPhoto[]>(`/visits/${vid}/photos`), enabled, staleTime: 60_000 });

function useInvalidate(vid: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.list(vid) });
    qc.invalidateQueries({ queryKey: ["map"] });
  };
}

export function useAddVisitPhoto(vid: string) {
  const done = useInvalidate(vid);
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("photo", file);
      return api<VisitPhoto>(`/visits/${vid}/photos`, { method: "POST", form });
    },
    onSuccess: done,
  });
}

export function useDeleteVisitPhoto(vid: string) {
  const done = useInvalidate(vid);
  return useMutation({ mutationFn: (url: string) => api<void>(url.replace(/^\/api\/v1/, ""), { method: "DELETE" }), onSuccess: done });
}

/** Photos are private (session-only), so they're fetched as blobs, never hot-linked. */
export function usePhotoSrc(url: string | null | undefined) {
  return useQuery({
    queryKey: ["visit-photo-blob", url],
    queryFn: async () => {
      try {
        return URL.createObjectURL(await fetchBlob(url!.replace(/^\/api\/v1/, "")));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null;
        throw e;
      }
    },
    enabled: !!url,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });
}

export function PhotoImg({ url, alt, className }: { url: string | null | undefined; alt: string; className?: string }) {
  const { data, isLoading } = usePhotoSrc(url);
  if (isLoading) return <div className={cn("grid place-items-center bg-slate-100", className)}><Spinner size="sm" /></div>;
  if (!data) return <div className={cn("grid place-items-center bg-slate-100 text-slate-400", className)}><ImageOff className="size-5" /></div>;
  // eslint-disable-next-line @next/next/no-img-element -- blob: URLs can't go through next/image
  return <img src={data} alt={alt} className={cn("object-cover", className)} />;
}

/**
 * Photo strip on a visit: thumbnails, an "Add photo" button that opens the phone
 * camera, and a viewer. Shown once the team has checked in.
 */
export function VisitPhotos({ visit }: { visit: Visit }) {
  const user = useUser();
  const live = visit.status === "in_progress" || visit.status === "completed";
  const { data: photos = [] } = useVisitPhotos(visit.id, live);
  const add = useAddVisitPhoto(visit.id);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<VisitPhoto | null>(null);
  if (!live) return null;
  const canAdd = can.runVisits(user.role) && photos.length < 12;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <button key={p.id} onClick={() => setOpen(p)} className="size-16 overflow-hidden rounded-xl ring-1 ring-line transition hover:ring-2 hover:ring-ocean" aria-label={`Photo by ${p.taken_by}`}>
            <PhotoImg url={p.url} alt={`Visit photo by ${p.taken_by}`} className="size-full" />
          </button>
        ))}
        {canAdd && (
          <>
            <button onClick={() => input.current?.click()} disabled={add.isPending}
              className="grid size-16 place-items-center rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-kenya-green hover:text-kenya-green disabled:opacity-60"
              aria-label="Add a photo">
              {add.isPending ? <Spinner size="sm" /> : <span className="flex flex-col items-center gap-0.5 text-xs font-semibold"><Camera className="size-5" />Photo</span>}
            </button>
            <input ref={input} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) add.mutate(f, { onSuccess: () => toast.success("Photo added. HQ can see it on the map."), onError: (err) => toast.error(err.message) });
              }} />
          </>
        )}
      </div>
      {open && <PhotoViewer vid={visit.id} photo={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PhotoViewer({ vid, photo, onClose }: { vid: string; photo: VisitPhoto; onClose: () => void }) {
  const user = useUser();
  const del = useDeleteVisitPhoto(vid);
  const confirm = useConfirm();
  const mayDelete = photo.taken_by_id === user.id || can.planVisits(user.role);
  return (
    <Modal open onClose={onClose} size="lg" title="Visit photo" subtitle={`${photo.taken_by} · ${dateTime(photo.created_at)}`}
      footer={mayDelete ? (
        <Button variant="ghost" icon={<Trash2 className="size-4" />} loading={del.isPending}
          onClick={async () => {
            if (await confirm({ title: "Delete this photo?", body: "It will be removed for everyone.", confirmLabel: "Delete" }))
              del.mutate(photo.url, { onSuccess: () => { toast.success("Photo deleted"); onClose(); }, onError: (e) => toast.error(e.message) });
          }}>Delete</Button>
      ) : undefined}>
      <PhotoImg url={photo.url} alt={`Visit photo by ${photo.taken_by}`} className="max-h-[70vh] w-full rounded-xl object-contain" />
    </Modal>
  );
}
