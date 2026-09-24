"use client";

/**
 * Offline capture queue (IndexedDB). Each record carries the `client_ref` the
 * API uses for idempotency, so replaying a sync after a dropped response can
 * never create a duplicate voter.
 */
import { api, ApiError } from "@/lib/api";

export type OutboxItem = {
  client_ref: string;
  body: Record<string, unknown> & { full_name: string };
  created_at: number;
  attempts: number;
  error?: string; // set when the server rejected it (needs a human)
};

const DB = "chq-offline";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_ref" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const outbox = {
  add: (item: OutboxItem) => tx("readwrite", (s) => s.put(item)).then(notify),
  list: () => tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>),
  remove: (ref: string) => tx("readwrite", (s) => s.delete(ref)).then(notify),
};

export type SyncReport = { synced: string[]; duplicates: string[]; failed: string[]; offline: boolean };

let running: Promise<SyncReport> | null = null;

/** Push queued captures to the server. Safe to call often; concurrent calls share one run. */
export function flushOutbox(): Promise<SyncReport> {
  running ??= (async () => {
    const report: SyncReport = { synced: [], duplicates: [], failed: [], offline: false };
    try {
      for (const item of await outbox.list()) {
        if (item.error) continue; // waiting for a person to fix or discard
        try {
          await api("/voters", { body: { ...item.body, client_ref: item.client_ref } });
          await outbox.remove(item.client_ref);
          report.synced.push(item.body.full_name);
        } catch (e) {
          if (e instanceof ApiError && e.status === 0) {
            report.offline = true;
            break; // still no connection: try again later
          }
          if (e instanceof ApiError && e.status === 409) {
            await outbox.remove(item.client_ref);
            report.duplicates.push(item.body.full_name);
          } else if (e instanceof ApiError && e.status === 401) {
            break; // signed out: keep everything until they sign back in
          } else {
            await outbox.add({ ...item, attempts: item.attempts + 1, error: e instanceof Error ? e.message : "Rejected" });
            report.failed.push(item.body.full_name);
          }
        }
      }
    } finally {
      running = null;
    }
    return report;
  })();
  return running;
}

export const newClientRef = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
