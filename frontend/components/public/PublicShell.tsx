"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/loaders";
import { FlagStripe } from "@/components/shell/FlagStripe";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";

export const PUBLIC_LINKS: [string, string][] = [
  ["/", "Join"], ["/about", "About"], ["/agenda", "Our agenda"], ["/events", "Events"], ["/news", "News"], ["/volunteer", "Volunteer"], ["/?voice=1", "Report an issue"],
];

/** The public website's frame: header with the menu, the page, and the footer. */
export function PublicShell({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="relative overflow-hidden bg-[#06101f] pb-16 text-white">
        <FlagStripe />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(11,127,166,.4),transparent_55%),radial-gradient(ellipse_at_0%_100%,rgba(0,107,63,.3),transparent_55%)]" />
        <PublicNav />
        <div className="relative mx-auto max-w-5xl px-5 pt-10">
          <p className="text-xs font-bold tracking-[.18em] text-gold uppercase">{eyebrow}</p>
          <h1 className="mt-2 font-display text-4xl leading-tight font-extrabold sm:text-5xl">{title}</h1>
          {lead && <p className="mt-3 max-w-2xl text-base text-slate-300 sm:text-lg">{lead}</p>}
        </div>
      </header>
      <main className="relative mx-auto -mt-8 w-full max-w-5xl flex-1 px-4 pb-16">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicNav({ dark = true }: { dark?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <nav aria-label="Main" className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 pt-5">
      <Link href="/" className="flex items-center gap-3">
        <BrandMark className="size-10" />
        <span><span className="block font-display font-bold">{CAMPAIGN_NAME}</span><span className="block text-xs text-slate-400">{CANDIDATE_NAME} · Mombasa</span></span>
      </Link>
      <div className="hidden items-center gap-1 lg:flex">
        {PUBLIC_LINKS.slice(1).map(([href, label]) => (
          <Link key={href} href={href} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold transition",
            path === href ? "bg-white/15 text-white" : dark ? "text-slate-300 hover:text-white" : "text-navy-900")}>{label}</Link>
        ))}
        <Link href="/" className="ml-1 rounded-full bg-gold px-4 py-1.5 text-sm font-bold text-navy-950 hover:brightness-105">Join the team</Link>
      </div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu" className="grid size-10 place-items-center rounded-xl bg-white/10 lg:hidden">
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-4 top-full z-40 mt-3 rounded-2xl bg-[#0b1a30] p-2 shadow-2xl ring-1 ring-white/10 lg:hidden">
          {PUBLIC_LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={cn("block rounded-xl px-4 py-3 text-base font-semibold", path === href ? "bg-white/10 text-white" : "text-slate-200 hover:bg-white/5")}>{label}</Link>
          ))}
        </div>
      )}
    </nav>
  );
}

export function PublicFooter() {
  return (
    <footer className="bg-[#06101f] text-slate-400">
      <FlagStripe />
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3"><BrandMark className="size-9" /><span className="font-display font-bold text-white">{CAMPAIGN_NAME}</span></div>
          <p className="mt-3 max-w-xs text-sm">{CANDIDATE_NAME} for Governor, Mombasa County. Built by volunteers and supporters across all six constituencies.</p>
        </div>
        <ul className="space-y-2 text-sm">
          {PUBLIC_LINKS.map(([href, label]) => <li key={href}><Link href={href} className="hover:text-white">{label}</Link></li>)}
        </ul>
        <ul className="space-y-2 text-sm">
          <li><Link href="/?track=1" className="hover:text-white">Track a report</Link></li>
          <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
          <li><Link href="/privacy" className="hover:text-white">Privacy &amp; your data</Link></li>
        </ul>
      </div>
      <p className="border-t border-white/5 px-5 py-4 text-center text-xs">© {new Date().getFullYear()} {CAMPAIGN_NAME}. Your details are protected under Kenya&apos;s Data Protection Act, 2019.</p>
    </footer>
  );
}
