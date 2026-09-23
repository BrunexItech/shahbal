"use client";

import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/** Hairline progress bar in flag colours, driven by any in-flight query or mutation. */
export function TopLoader() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden transition-opacity duration-300 ${busy ? "opacity-100" : "opacity-0"}`}
    >
      <div className="top-loader h-full w-full origin-left bg-[linear-gradient(90deg,#111_0%,#bb1e10_35%,#006b3f_70%,#c9a227_100%)]" />
    </div>
  );
}
