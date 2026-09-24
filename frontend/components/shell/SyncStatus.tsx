"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, CloudUpload, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DotLoader } from "@/components/loaders";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { flushOutbox, outbox, subscribe, type OutboxItem } from "@/lib/outbox";

/** Top-bar indicator for captures saved offline; syncs on reconnect and every 30 s. */
export function SyncStatus() {
  const qc = useQueryClient();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => outbox.list().then(setItems).catch(() => setItems([])), []);

  const sync = useCallback(async (manual = false) => {
    if (!navigator.onLine) return;
    setSyncing(true);
    const r = await flushOutbox().catch(() => null);
    setSyncing(false);
    await refresh();
    if (!r) return;
    if (r.synced.length) {
      toast.success(`${r.synced.length} offline capture${r.synced.length > 1 ? "s" : ""} synced`);
      qc.invalidateQueries({ queryKey: ["voters"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
    if (r.duplicates.length) toast.warning(`Already registered: ${r.duplicates.join(", ")}`);
    if (r.failed.length) toast.error(`${r.failed.length} capture(s) need attention`);
    if (manual && r.offline) toast.error("Still offline");
  }, [qc, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh().then(() => sync());
    const on = () => { setOnline(true); void sync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unsub = subscribe(() => void refresh());
    const t = setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      unsub();
      clearInterval(t);
    };
  }, [refresh, sync]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (online && !items.length) return null;
  const needsAttention = items.some((i) => i.error);

  return (
    <div className="relative" ref={panel}>
      <button onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold ring-1 transition",
          needsAttention ? "bg-red-50 text-kenya-red ring-red-200" : !online ? "bg-slate-100 text-slate-700 ring-line" : "bg-amber-50 text-amber-800 ring-amber-200")}>
        {syncing ? <DotLoader /> : !online ? <CloudOff className="size-4" /> : needsAttention ? <TriangleAlert className="size-4" /> : <CloudUpload className="size-4" />}
        {!online ? `Offline${items.length ? ` · ${items.length} saved` : ""}` : `${items.length} to sync`}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 animate-fade-up rounded-2xl border border-line bg-white p-4 shadow-2xl">
          <p className="text-sm font-semibold text-navy-900">Saved on this device</p>
          <p className="mt-0.5 text-xs text-muted">{online ? "These upload automatically. Tap sync to try now." : "You're offline. These upload when signal returns."}</p>
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {items.map((i) => (
              <li key={i.client_ref} className={cn("rounded-xl px-3 py-2 text-xs ring-1", i.error ? "bg-red-50 ring-red-100" : "bg-slate-50 ring-line")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-navy-900">{i.body.full_name}</span>
                  {i.error && (
                    <button onClick={() => outbox.remove(i.client_ref)} className="text-muted hover:text-kenya-red" aria-label={`Discard ${i.body.full_name}`}><Trash2 className="size-3.5" /></button>
                  )}
                </div>
                <p className={i.error ? "mt-0.5 text-kenya-red" : "mt-0.5 text-muted"}>{i.error ?? new Date(i.created_at).toLocaleString("en-KE")}</p>
              </li>
            ))}
          </ul>
          {online && items.some((i) => !i.error) && <Button size="sm" className="mt-3 w-full" loading={syncing} onClick={() => sync(true)}>Sync now</Button>}
        </div>
      )}
    </div>
  );
}
