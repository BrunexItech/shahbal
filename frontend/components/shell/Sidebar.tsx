"use client";

import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import { BrandMark } from "@/components/loaders";
import { NAV } from "@/components/shell/nav";
import { LiveDot, Ring } from "@/components/ui/Motion";
import { useDashboard } from "@/features/dashboard/api";
import { useAuth, useUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";
import { initials, num, pct } from "@/lib/format";
import { useLive } from "@/lib/live";
import { ROLE_LABEL } from "@/lib/roles";

export function isActive(pathname: string, href: string) {
  if (href === "/voters") return pathname === "/voters" || (/^\/voters\/[^/]+$/.test(pathname) && pathname !== "/voters/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ---- collapsed/expanded state shared with the layout -----------------------------
const ShellCtx = createContext<{ collapsed: boolean; toggle: () => void }>({ collapsed: false, toggle: () => {} });
export const useShell = () => useContext(ShellCtx);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("chq.rail") === "1");
    } catch {}
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("chq.rail", c ? "0" : "1");
      } catch {}
      return !c;
    });
  return <ShellCtx.Provider value={{ collapsed, toggle }}>{children}</ShellCtx.Provider>;
}

export const SIDEBAR_W = { open: 280, rail: 88 };

export function Sidebar() {
  const pathname = usePathname();
  const user = useUser();
  const { logout } = useAuth();
  const { collapsed, toggle } = useShell();
  const { data: d } = useDashboard();
  const { pulse, connected } = useLive();
  const items = NAV.filter((n) => n.show(user.role));
  const sections = [...new Set(items.map((i) => i.section))];

  // Work waiting for this person, shown as badges on the nav.
  const badges: Record<string, number | undefined> = {
    "/verification": d?.totals.pending,
    "/messaging": d?.ops.approvals_pending || undefined,
  };

  return (
    <aside
      style={{ width: collapsed ? SIDEBAR_W.rail : SIDEBAR_W.open }}
      className="fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden bg-[#06101f] text-slate-300 transition-[width] duration-300 lg:flex"
    >
      {/* Kenyan flag edge */}
      <div aria-hidden className="absolute inset-y-0 left-0 flex w-1 flex-col">
        <span className="flex-[3] bg-kenya-black" /><span className="flex-1 bg-white" /><span className="flex-[3] bg-kenya-red" />
        <span className="flex-1 bg-white" /><span className="flex-[3] bg-kenya-green" />
      </div>
      <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-ocean/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 -left-20 size-60 rounded-full bg-kenya-green/15 blur-3xl" />

      {/* Identity */}
      <div className={cn("relative flex items-center gap-3 pt-6 pb-5", collapsed ? "justify-center px-3" : "px-6")}>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
          <BrandMark className="size-11 shrink-0 drop-shadow-[0_0_14px_rgba(201,162,39,.35)]" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-extrabold tracking-tight text-white">{CAMPAIGN_NAME}</p>
              <p className="truncate text-[11px] text-gold/90">{CANDIDATE_NAME} · Mombasa 2027</p>
            </div>
          )}
        </Link>
      </div>

      {/* Live mission widget */}
      {d && (
        <div className={cn("relative mx-4 mb-4 rounded-2xl border border-white/[.07] bg-gradient-to-br from-white/[.06] to-white/[.01] backdrop-blur", collapsed ? "p-2" : "p-4")}>
          {collapsed ? (
            <div className="grid place-items-center" title={`County target ${pct(d.overall.percent)}`}>
              <Ring percent={d.overall.percent ?? 0} size={52} stroke={5}><span className="text-[10px] font-bold text-white">{Math.round(d.overall.percent ?? 0)}%</span></Ring>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Ring percent={d.overall.percent ?? 0} size={58} stroke={6}><span className="text-[11px] font-bold text-white">{Math.round(d.overall.percent ?? 0)}%</span></Ring>
              <div className="min-w-0 text-[11px] leading-5">
                <p className="flex items-center gap-1.5 font-semibold tracking-wider text-white uppercase"><LiveDot on={connected} className="size-2" /> {connected ? "Live" : "Reconnecting"}</p>
                <p className="text-slate-400"><b className="text-white">{num(pulse?.online_field ?? 0)}</b> in the field · <b className="text-white">{num(pulse?.on_call ?? 0)}</b> on calls</p>
                <p className="text-slate-400"><b className="text-white">{num(pulse?.captures_today ?? d.totals.today)}</b> captured today</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className={cn("relative flex-1 space-y-5 overflow-y-auto pb-4", collapsed ? "px-3" : "px-4")}>
        {sections.map((section) => (
          <div key={section}>
            {!collapsed && <p className="mb-1.5 px-3 text-[10px] font-bold tracking-[.18em] text-slate-500 uppercase">{section}</p>}
            {collapsed && <div className="mx-auto mb-2 h-px w-8 bg-white/10" />}
            <div className="space-y-1">
              {items.filter((i) => i.section === section).map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                const badge = badges[href];
                return (
                  <Link key={href} href={href} title={collapsed ? label : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl py-2 text-[13.5px] font-medium transition-all duration-200",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      active ? "bg-gradient-to-r from-white/[.12] to-white/[.02] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.06)]" : "text-slate-400 hover:bg-white/[.05] hover:text-white",
                    )}>
                    {active && <span className="absolute inset-y-1.5 -left-1 w-1 rounded-full bg-gold shadow-[0_0_12px_#c9a227]" />}
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg transition",
                      active ? "bg-gold/15 text-gold" : "bg-white/[.04] text-slate-400 group-hover:text-white")}>
                      <Icon className="size-[17px]" />
                    </span>
                    {!collapsed && <span className="flex-1 truncate">{label}</span>}
                    {!!badge && (
                      <span className={cn("rounded-full bg-kenya-red px-1.5 text-[10px] font-bold leading-5 text-white tabular-nums",
                        collapsed && "absolute -top-1 -right-1 min-w-5 text-center")}>{badge > 999 ? "999+" : badge}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Profile */}
      <div className={cn("relative border-t border-white/[.07] p-3", collapsed && "flex flex-col items-center gap-2")}>
        <div className={cn("flex items-center gap-3 rounded-xl p-2", !collapsed && "bg-white/[.03]")}>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-[#8a6d12] text-sm font-extrabold text-navy-950 ring-2 ring-white/10">
            {initials(user.full_name)}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.full_name}</p>
              <p className="truncate text-[11px] text-slate-400">{ROLE_LABEL[user.role]}</p>
            </div>
          )}
          {!collapsed && (
            <button onClick={() => void logout()} className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </button>
          )}
        </div>
        <button onClick={toggle} className={cn("mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-500 transition hover:text-white", collapsed && "justify-center")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}
