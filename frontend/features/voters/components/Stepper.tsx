import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-full text-sm font-bold transition-all duration-300",
                  done && "bg-kenya-green text-white",
                  active && "bg-navy-900 text-white ring-4 ring-navy-900/10",
                  !done && !active && "bg-slate-100 text-slate-400",
                )}
              >
                {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-xs font-semibold whitespace-nowrap max-sm:hidden", active ? "text-navy-900" : "text-muted")}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="mx-2 mb-5 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-100 max-sm:mb-0">
                <div className={cn("h-full bg-kenya-green transition-all duration-500", done ? "w-full" : "w-0")} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
