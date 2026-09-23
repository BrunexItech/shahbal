import { num } from "@/lib/format";

/** Ranked horizontal bars with the label and value as text, so identity never rests on colour. */
export function BarList({ rows, color = "bg-navy-800" }: { rows: { key: string; label: React.ReactNode; value: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} title={`${num(r.value)} (${total ? Math.round((r.value / total) * 100) : 0}%)`}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-navy-900">{r.label}</span>
            <span className="text-muted tabular-nums">
              {num(r.value)} <span className="text-xs">· {total ? Math.round((r.value / total) * 100) : 0}%</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
