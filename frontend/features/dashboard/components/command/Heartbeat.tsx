"use client";

import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { num } from "@/lib/format";

/** Captures per hour: today (solid, up to now) against yesterday (dashed), one axis. */
export function Heartbeat({ today, yesterday }: { today: number[]; yesterday: number[] }) {
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Nairobi" }).format(new Date()));
  const data = Array.from({ length: 24 }, (_, h) => ({
    h, label: `${String(h).padStart(2, "0")}:00`,
    today: h <= hourNow ? today[h] ?? 0 : null,
    yesterday: yesterday[h] ?? 0,
  }));
  const sumToday = today.slice(0, hourNow + 1).reduce((a, b) => a + b, 0);
  const sumYday = yesterday.slice(0, hourNow + 1).reduce((a, b) => a + b, 0);
  return (
    <div className="px-2 pb-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-kenya-green" /> Today · <b className="text-navy-900 tabular-nums">{num(sumToday)}</b></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-slate-400" /> Yesterday by this hour · <b className="text-navy-900 tabular-nums">{num(sumYday)}</b></span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="hb-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#006b3f" stopOpacity={0.28} />
                <stop offset="1" stopColor="#006b3f" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="h" tickFormatter={(h: number) => `${String(h).padStart(2, "0")}h`} ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
              tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              cursor={{ stroke: "#0b1f3a", strokeOpacity: 0.2 }}
              contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
              labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 – ${String((Number(h) + 1) % 24).padStart(2, "0")}:00`}
              formatter={(v, name) => [num(Number(v)), name === "today" ? "Today" : "Yesterday"]}
            />
            <Line type="monotone" dataKey="yesterday" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="today" stroke="#006b3f" strokeWidth={2.5} fill="url(#hb-fill)" connectNulls={false}
              dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
