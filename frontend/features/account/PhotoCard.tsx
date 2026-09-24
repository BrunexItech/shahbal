"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Card, CardHeader } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { useAuth, useUser } from "@/lib/auth";

export function PhotoCard() {
  const user = useUser();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api("/users/me/photo", { form });
      await qc.invalidateQueries({ queryKey: ["photo"] });
      await refresh();
      toast.success("Photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update your photo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Profile photo" subtitle="Shown to HQ and your coordinators. Location data is removed and the photo is stored encrypted." />
      <div className="flex flex-col items-center gap-5 p-5 sm:flex-row">
        <Avatar userId={user.id} name={user.full_name} size={96} hasPhoto={user.has_photo} className="text-2xl" />
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button loading={busy} icon={<Camera className="size-4" />} onClick={() => camera.current?.click()}>Take a new photo</Button>
          <Button variant="secondary" disabled={busy} icon={<ImagePlus className="size-4" />} onClick={() => gallery.current?.click()}>Choose from gallery</Button>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </Card>
  );
}
