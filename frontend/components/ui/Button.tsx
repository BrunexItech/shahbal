import { forwardRef } from "react";

import { Spinner } from "@/components/loaders";
import { cn } from "@/lib/cn";

const VARIANTS = {
  primary: "bg-kenya-green text-white shadow-sm shadow-kenya-green/25 hover:bg-kenya-green-600",
  navy: "bg-navy-900 text-white hover:bg-navy-800",
  gold: "bg-gold text-navy-950 shadow-sm shadow-gold/30 hover:brightness-105",
  secondary: "bg-white text-navy-900 ring-1 ring-line hover:bg-slate-50",
  ghost: "text-navy-800 hover:bg-slate-100",
  danger: "bg-kenya-red text-white hover:brightness-110",
  "danger-soft": "bg-red-50 text-kenya-red ring-1 ring-red-100 hover:bg-red-100",
} as const;

const SIZES = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" } as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  const tone = variant === "primary" || variant === "navy" || variant === "danger" ? "light" : variant === "gold" ? "dark" : "brand";
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl font-semibold whitespace-nowrap transition-all duration-150",
        "active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {/* Keep the label in the layout while loading so the button never changes width. */}
      <span className={cn("inline-flex items-center gap-[inherit]", loading && "invisible")}>
        {icon}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size="sm" tone={tone} />
        </span>
      )}
    </button>
  );
});
