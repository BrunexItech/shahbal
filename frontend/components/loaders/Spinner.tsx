import { useId } from "react";

import { cn } from "@/lib/cn";

const SIZES = { xs: 14, sm: 18, md: 28, lg: 44, xl: 64 } as const;

type Props = {
  size?: keyof typeof SIZES;
  /** "brand" = green→gold sweep on light surfaces; "light" = white on dark fills; "dark" = navy on gold/light fills. */
  tone?: "brand" | "light" | "dark";
  className?: string;
  label?: string;
};

/** Gradient arc with a faded track — reads as premium where a plain border spinner reads as default. */
export function Spinner({ size = "md", tone = "brand", className, label = "Loading" }: Props) {
  const id = useId();
  const px = SIZES[size];
  const stroke = Math.max(2, Math.round(px / 9));
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [from, to, track] = {
    light: ["#ffffff", "#ffffff", "rgba(255,255,255,.25)"],
    dark: ["#0b1f3a", "#0b1f3a", "rgba(11,31,58,.15)"],
    brand: ["#006b3f", "#c9a227", "rgba(11,31,58,.08)"],
  }[tone];

  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)}>
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="animate-orbit" style={{ animationDuration: "0.9s" }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} stopOpacity="0" />
            <stop offset="55%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * 0.72} ${c}`}
        />
      </svg>
    </span>
  );
}
