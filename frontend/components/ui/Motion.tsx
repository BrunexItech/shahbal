"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/** Number that glides to its new value (ease-out) and flashes when it changes. */
export function CountUp({ value, className, format = (n: number) => Math.round(n).toLocaleString("en-KE") }: {
  value: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState(false);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setFlash(true);
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else {
        from.current = value;
        setTimeout(() => setFlash(false), 400);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={cn("tabular-nums transition-colors duration-500", flash && "text-gold", className)}>{format(shown)}</span>;
}

/** Single-series sparkline (no legend: the tile title names it). Last point is marked. */
export function Sparkline({ data, color = "#006b3f", className, height = 36 }: { data: number[]; color?: string; className?: string; height?: number }) {
  const w = 120;
  const max = Math.max(1, ...data);
  const pts = data.map((d, i) => [(i / Math.max(data.length - 1, 1)) * w, height - 3 - (d / max) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const last = pts.at(-1);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("h-9 w-full", className)} aria-hidden>
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Animated progress ring. */
export function Ring({ percent, size = 148, stroke = 12, color = "#c9a227", track = "rgba(255,255,255,.08)", children }: {
  percent: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(percent, 100));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`} className="transition-[stroke-dasharray] duration-1000 ease-out" />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

/** Pulsing "live" dot. */
export function LiveDot({ on = true, className }: { on?: boolean; className?: string }) {
  return (
    <span className={cn("relative flex size-2.5", className)}>
      {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-kenya-green opacity-60" />}
      <span className={cn("relative inline-flex size-2.5 rounded-full", on ? "bg-kenya-green" : "bg-slate-400")} />
    </span>
  );
}
