"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { num } from "@/lib/format";

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" });

/** Single series → no legend; the card title names it. Bars ≤24px, 4px rounded caps, hairline grid. */
export function DailyChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="#eef1f5" />
          <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={{ stroke: "#e3e8ef" }} tick={{ fontSize: 11, fill: "#64748b" }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={num} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(11,31,58,.04)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-xl bg-navy-950 px-3 py-2 text-xs text-white shadow-xl">
                  <p className="text-slate-400">{fmtDay(payload[0]!.payload.date)}</p>
                  <p className="mt-0.5 font-semibold"><span className="mr-1.5 inline-block size-2 rounded-sm bg-kenya-green align-middle" />{num(payload[0]!.value as number)} captured</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="count" fill="#006b3f" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
