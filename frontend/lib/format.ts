const nf = new Intl.NumberFormat("en-KE");
export const num = (n: number | null | undefined) => (n == null ? "—" : nf.format(n));

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(n >= 10 ? 0 : 1)}%`);

const dt = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
export const dateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : "—");

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
