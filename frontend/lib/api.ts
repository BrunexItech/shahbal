import { API_URL } from "@/lib/config";

/**
 * Auth lives in an httpOnly, SameSite=Strict cookie that JavaScript can't read,
 * so an XSS bug can't steal a session. Every request carries the CSRF header
 * the API requires for cookie-authenticated writes.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(params?: Query) {
  if (!params) return "";
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

/** FastAPI errors are either {detail: string} or {detail: [{loc, msg}]}; flatten both. */
async function toError(res: Response): Promise<ApiError> {
  let body: { detail?: unknown } = {};
  try {
    body = await res.json();
  } catch {}
  const d = body.detail;
  if (Array.isArray(d)) {
    const fields: Record<string, string> = {};
    for (const e of d as { loc: (string | number)[]; msg: string }[]) {
      fields[String(e.loc.at(-1))] = e.msg.replace(/^Value error, /, "");
    }
    return new ApiError(res.status, Object.values(fields)[0] ?? "Please check the form", fields);
  }
  return new ApiError(res.status, typeof d === "string" ? d : `Request failed (${res.status})`);
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

/** Sensitive actions answer 428 until the user re-confirms (passkey / code). The
 *  StepUpProvider registers a handler that shows the prompt and resolves true on success. */
let onStepUp: () => Promise<boolean> = async () => false;
export const setStepUpHandler = (fn: () => Promise<boolean>) => (onStepUp = fn);
export const STEP_UP = 428;

export const apiUrl = (path: string, query?: Query) => `${API_URL}${path}${qs(query)}`;

type Opts = { method?: string; body?: unknown; query?: Query; form?: FormData; silent401?: boolean; noStepUp?: boolean };

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
      headers,
      credentials: "include",
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 401 && !opts.silent401) onUnauthorized();
  if (res.status === STEP_UP && !opts.noStepUp) {
    if (await onStepUp()) return api<T>(path, { ...opts, noStepUp: true }); // retry once after re-confirming
  }
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Authenticated file download (the cookie rides along; no token in the URL). */
export async function download(path: string, filename: string, query?: Query, retried = false): Promise<void> {
  const res = await fetch(apiUrl(path, query), { credentials: "include", headers: { "X-Requested-With": "fetch" } });
  if (res.status === STEP_UP && !retried && (await onStepUp())) return download(path, filename, query, true);
  if (!res.ok) throw await toError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/** Authenticated binary fetch (e.g. recordings) with the same re-confirmation handling. */
export async function fetchBlob(path: string, retried = false): Promise<Blob> {
  const res = await fetch(apiUrl(path), { credentials: "include", headers: { "X-Requested-With": "fetch" } });
  if (res.status === STEP_UP && !retried && (await onStepUp())) return fetchBlob(path, true);
  if (!res.ok) throw await toError(res);
  return res.blob();
}
