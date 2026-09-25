"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/loaders";
import { NAV } from "@/components/shell/nav";
import { isActive } from "@/components/shell/Sidebar";
import { SyncStatus } from "@/components/shell/SyncStatus";
import { Avatar } from "@/components/ui/Avatar";
import { CountUp, LiveDot } from "@/components/ui/Motion";
import { useDashboard } from "@/features/dashboard/api";
import { useAuth, useUser } from "@/lib/auth";
import { CANDIDATE_NAME } from "@/lib/config";
import { useLive } from "@/lib/live";
import { ROLE_LABEL } from "@/lib/roles";

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short" });

/**
 * The command strip: where you are, the live pulse of the campaign, the countdown to
 * election day, and who you are. Dark to frame the page like the sidebar, with a
 * Kenyan-flag edge.
 */
export function Topbar() {
  const user = useUser();
  const { logout } = useAuth();
  const pathname = usePathname();
  const { connected, pulse } = useLive();
  const { data: d } = useDashboard();
  const [now, setNow] = useState<Date | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const here = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => isActive(pathname, n.href));
  const daysLeft = d?.insights.days_left;
  const stats: [string, number, string][] = [
    ["captured today", pulse?.captures_today ?? d?.totals.today ?? 0, "#ffffff"],
    ["in the field", pulse?.online_field ?? 0, "#34c77b"],
    ["on calls", pulse?.on_call ?? 0, "#ff8a7a"],
  ];

  return (
    <header className="sticky top-0 z-20 bg-[#06101f]/95 text-white shadow-[0_10px_30px_-18px_rgba(6,16,31,.8)] backdrop-blur-xl">
      <div className="flex h-[62px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Where am I */}
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="shrink-0 lg:hidden" aria-label="Command Centre"><BrandMark className="size-8" /></Link>
          <div className="min-w-0">
            <p className="hidden text-xs font-semibold tracking-[.18em] text-gold/90 uppercase sm:block">{here?.section ?? "Campaign"}</p>
            <p className="truncate font-display text-base leading-tight font-bold">{here?.label ?? CANDIDATE_NAME}</p>
          </div>
        </div>

        {/* Live pulse */}
        <div className="hidden min-w-0 items-center gap-2 xl:flex">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold tracking-wider uppercase ring-1 ${connected ? "bg-[#34c77b]/15 text-[#7ee2b0] ring-[#34c77b]/30" : "bg-white/5 text-slate-400 ring-white/10"}`}>
            <LiveDot on={connected} className="size-2" /> {connected ? "Live" : "Connecting"}
          </span>
          {stats.map(([label, v, c]) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full bg-white/[.05] px-3 py-1.5 text-xs text-slate-300 ring-1 ring-white/10">
              <span className="size-1.5 rounded-full" style={{ background: c }} />
              <b className="font-display text-sm text-white tabular-nums"><CountUp value={v} /></b> {label}
            </span>
          ))}
        </div>

        {/* Countdown, clock, me */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {daysLeft != null && (
            <span className="hidden items-baseline gap-1.5 rounded-xl bg-gradient-to-br from-gold to-[#a8861a] px-3 py-1.5 text-navy-950 shadow-[0_6px_18px_-8px_rgba(201,162,39,.8)] md:inline-flex" title="Days to election day">
              <b className="font-display text-lg leading-none tabular-nums">{daysLeft}</b>
              <span className="text-xs font-bold tracking-wider uppercase">days to vote</span>
            </span>
          )}
          <div className="hidden text-right leading-tight sm:block">
            <p className="font-mono text-sm font-semibold tabular-nums">{now ? clock.format(now) : "--:--"} <span className="text-xs text-slate-400">EAT</span></p>
            <p className="text-xs text-slate-400">{now ? day.format(now) : ""} · Mombasa</p>
          </div>
          <SyncStatus />
          <div ref={menuRef} className="relative">
            <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full p-0.5 pr-2 ring-1 ring-white/10 transition hover:bg-white/10">
              <Avatar userId={user.id} name={user.full_name} size={34} hasPhoto={user.has_photo} ring={false} className="ring-2 ring-gold/50" />
              <ChevronDown className="size-4 text-slate-400" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 mt-2 w-60 animate-fade-up overflow-hidden rounded-2xl bg-white p-1.5 text-navy-900 shadow-2xl ring-1 ring-line">
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-bold">{user.full_name}</p>
                  <p className="truncate text-xs text-slate-500">{ROLE_LABEL[user.role]} · {user.email}</p>
                </div>
                <div className="my-1 h-px bg-line" />
                <Link role="menuitem" href="/account" onClick={() => setMenu(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-slate-50">
                  <UserRound className="size-4 text-ocean" /> My account & security
                </Link>
                <button role="menuitem" onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-kenya-red hover:bg-red-50">
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Kenyan flag edge */}
      <div aria-hidden className="flex h-[2px]"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white/70" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white/70" /><i className="flex-[3] bg-kenya-green" /></div>
    </header>
  );
}
