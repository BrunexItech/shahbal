import { cn } from "@/lib/cn";

/** Kenyan flag bands (with the white fimbriations) as a hairline accent. */
export function FlagStripe({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("flex h-1 w-full", className)}>
      <span className="flex-[3] bg-kenya-black" />
      <span className="flex-1 bg-white" />
      <span className="flex-[3] bg-kenya-red" />
      <span className="flex-1 bg-white" />
      <span className="flex-[3] bg-kenya-green" />
    </div>
  );
}
