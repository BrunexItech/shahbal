"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { MOBILE_NAV, NAV } from "@/components/shell/nav";
import { isActive, useNavBadges } from "@/components/shell/Sidebar";
import { Avatar } from "@/components/ui/Avatar";
import { useAuth, useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/lib/types";

/** Phones and tablets: four shortcuts plus "Menu", which opens every page this role can use. */
export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const badges = useNavBadges();
  const all = NAV.filter((n) => n.show(role));
  const items = MOBILE_NAV.map((h) => NAV.find((n) => n.href === h)!).filter((n) => n.show(role)).slice(0, 4);
  const waiting = all.filter((n) => !items.includes(n)).reduce((a, n) => a + (badges[n.href] ?? 0), 0);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-navy-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="flex justify-around">
          {items.map(({ href, label, short, icon: Icon }) => {
            const active = isActive(pathname, href);
            const primary = href === "/voters/new";
            return (
              <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium", active ? "text-gold" : "text-slate-400")}>
                <span className={cn("relative grid place-items-center", primary && "-mt-5 size-12 rounded-2xl bg-kenya-green text-white shadow-lg shadow-kenya-green/40")}>
                  <Icon className="size-5" />
                  {!!badges[href] && !primary && <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-kenya-red px-1 text-center text-[10px] leading-4 font-bold text-white">{badges[href]! > 99 ? "99+" : badges[href]}</span>}
                </span>
                {short ?? label}
              </Link>
            );
          })}
          <button onClick={() => setOpen(true)} aria-expanded={open} aria-controls="mobile-menu"
            className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium", open ? "text-gold" : "text-slate-400")}>
            <span className="relative grid place-items-center">
              <Menu className="size-5" />
              {waiting > 0 && <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-kenya-red px-1 text-center text-[10px] leading-4 font-bold text-white">{waiting > 99 ? "99+" : waiting}</span>}
            </span>
            Menu
          </button>
        </div>
      </nav>
      {open && <MenuSheet role={role} onClose={() => setOpen(false)} />}
    </>
  );
}

function MenuSheet({ role, onClose }: { role: Role; onClose: () => void }) {
  const pathname = usePathname();
  const user = useUser();
  const { logout } = useAuth();
  const badges = useNavBadges();
  const items = NAV.filter((n) => n.show(role));
  const sections = [...new Set(items.map((i) => i.section))];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-40 lg:hidden">
      <button aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] animate-fade-up flex-col rounded-t-3xl bg-[#06101f] text-slate-300 shadow-2xl sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:max-h-none sm:w-96 sm:rounded-t-none sm:rounded-l-3xl">
        <div aria-hidden className="flex h-1.5 shrink-0 overflow-hidden rounded-t-3xl sm:rounded-none"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
        <div className="flex items-center gap-3 border-b border-white/[.07] px-5 py-4">
          <Avatar userId={user.id} name={user.full_name} size={40} hasPhoto={user.has_photo} ring={false} className="ring-2 ring-gold/40" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.full_name}</p>
            <p className="truncate text-xs text-slate-400">{ROLE_LABEL[user.role]}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close menu"><X className="size-5" /></button>
        </div>
        <nav className="scroll-dark flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {sections.map((section) => (
            <div key={section}>
              <p className="mb-1.5 px-2 text-xs font-bold tracking-[.18em] text-slate-500 uppercase">{section}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {items.filter((i) => i.section === section).map(({ href, label, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  const badge = badges[href];
                  return (
                    <Link key={href} href={href} onClick={onClose}
                      className={cn("relative flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                        active ? "bg-white/[.1] text-white ring-1 ring-gold/40" : "bg-white/[.03] text-slate-300 hover:bg-white/[.07] hover:text-white")}>
                      <Icon className={cn("size-[18px] shrink-0", active ? "text-gold" : "text-slate-400")} />
                      <span className="min-w-0 flex-1 leading-tight">{label}</span>
                      {!!badge && <span className="rounded-full bg-kenya-red px-1.5 text-xs leading-5 font-bold text-white tabular-nums">{badge > 999 ? "999+" : badge}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/[.07] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button onClick={() => void logout()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/[.05] py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
