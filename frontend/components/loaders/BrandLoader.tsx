import { CAMPAIGN_NAME } from "@/lib/config";

/**
 * Full-screen splash for auth bootstrap and route transitions: the brand mark
 * with sonar rings and three orbiting dots in flag colours.
 */
export function BrandLoader({ message = "Preparing your command centre" }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(11,127,166,.28),transparent_55%)]" />
      <div className="relative flex flex-col items-center">
        <div className="relative grid size-28 place-items-center">
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-ocean/60" />
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-gold/50 [animation-delay:.7s]" />
          <div className="absolute inset-0 animate-orbit" style={{ animationDuration: "2.4s" }}>
            <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_12px_#fff]" />
            <span className="absolute bottom-2 left-1 size-2.5 rounded-full bg-kenya-red shadow-[0_0_12px_#bb1e10]" />
            <span className="absolute right-1 bottom-2 size-2.5 rounded-full bg-kenya-green shadow-[0_0_12px_#006b3f]" />
          </div>
          <BrandMark className="size-16" />
        </div>
        <p className="mt-8 font-display text-lg font-semibold text-white">{CAMPAIGN_NAME}</p>
        <p className="shine-text mt-1 text-sm">{message}…</p>
      </div>
    </div>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="bm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12305a" />
          <stop offset="1" stopColor="#071427" />
        </linearGradient>
      </defs>
      <path d="M32 3 56 12v18c0 15-10 26-24 31C18 56 8 45 8 30V12Z" fill="url(#bm-bg)" stroke="#c9a227" strokeWidth="2" />
      <path d="M8 26h48v5H8z" fill="#111" />
      <path d="M8 31h48v1.5H8z" fill="#fff" />
      <path d="M8 32.5h48v6H8z" fill="#bb1e10" />
      <path d="M8 38.5h48V40H8z" fill="#fff" />
      <path d="M9 40h46c-2 9-9 15.5-23 19.5C18 55.5 11 49 9 40Z" fill="#006b3f" />
      <path d="m24 20 5 5 11-11" fill="none" stroke="#c9a227" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
