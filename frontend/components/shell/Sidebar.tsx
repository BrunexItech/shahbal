"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { NAV } from "@/components/shell/nav";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME, CAMPAIGN_TAGLINE } from "@/lib/config";
import type { Role } from "@/lib/types";

export function isActive(pathname: string, href: string) {
  if (href === "/voters") return pathname === "/voters" || (/^\/voters\/[^/]+$/.test(pathname) && pathname !== "/voters/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => n.show(role));
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-navy-950 text-slate-300 lg:flex">
      <FlagStripe />
      <div className="relative overflow-hidden px-5 pt-6 pb-5">
        <div className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-ocean/20 blur-3xl" />
        <Link href="/dashboard" className="relative flex items-center gap-3">
          <BrandMark className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-bold text-white">{CAMPAIGN_NAME}</p>
            <p className="truncate text-[11px] text-slate-400">{CAMPAIGN_TAGLINE}</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {sections.map((section) => (
          <div key={section}>
            <p className="mb-2 px-3 text-[10px] font-semibold tracking-[.16em] text-slate-500 uppercase">{section}</p>
            <div className="space-y-0.5">
              {items.filter((i) => i.section === section).map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                      active ? "bg-white/[.08] text-white" : "hover:bg-white/[.04] hover:text-white",
                    )}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gold" />}
                    <Icon className={cn("size-[18px] transition", active ? "text-gold" : "text-slate-500 group-hover:text-slate-300")} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="m-3 rounded-xl border border-white/5 bg-white/[.03] p-3 text-[11px] leading-relaxed text-slate-400">
        <p className="font-semibold text-slate-300">Data protection</p>
        Personal data is encrypted and every access is logged. Use it only for campaign outreach the voter consented to.
      </div>
    </aside>
  );
}
