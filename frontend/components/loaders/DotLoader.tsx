import { cn } from "@/lib/cn";

/** Three dots in flag colours — for inline "saving / syncing" states. */
export function DotLoader({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="Working" className={cn("dot-loader inline-flex items-center gap-1", className)}>
      <span className="size-1.5 rounded-full bg-kenya-black" />
      <span className="size-1.5 rounded-full bg-kenya-red" />
      <span className="size-1.5 rounded-full bg-kenya-green" />
    </span>
  );
}
