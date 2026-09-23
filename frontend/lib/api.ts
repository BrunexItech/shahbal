import { API_URL } from "@/lib/config";

const TOKEN_KEY = "chq.token";

// Storage can throw (private mode, blocked site data); auth must degrade, not crash.
function read(key: string) {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
}

export const tokenStore = {
  get: () => read(TOKEN_KEY),
  set: (t: string) => write(TOKEN_KEY, t),
  clear: () => write(TOKEN_KEY, null),
};

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

/** FastAPI errors are either {detail: string} or {detail: [{loc, msg}]} — flatten both. */
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

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; form?: FormData; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = opts.auth === false ? null : tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs(opts.query)}`, {
      method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : res.json();
}
