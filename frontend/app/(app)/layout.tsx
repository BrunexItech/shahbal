"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { BrandLoader } from "@/components/loaders";
import { IdleGuard } from "@/components/shell/IdleGuard";
import { MobileNav } from "@/components/shell/MobileNav";
import { ShellProvider, Sidebar, SIDEBAR_W, useShell } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { useAuth } from "@/lib/auth";
import { LiveProvider } from "@/lib/live";
import { lastPortal, PORTAL_LOGIN } from "@/lib/portal";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const mustEnrol = !!user?.mfa_setup_required;

  useEffect(() => {
    if (ready && !user) router.replace(PORTAL_LOGIN[lastPortal()]);
    // Production policy: staff must turn on 2FA before touching anything else.
    else if (mustEnrol && pathname !== "/account") router.replace("/account?enrol=1");
  }, [ready, user, router, mustEnrol, pathname]);

  if (!ready || !user || (mustEnrol && pathname !== "/account")) return <BrandLoader />;

  return (
    <LiveProvider>
      <ShellProvider>
        <Shell role={user.role}>{children}</Shell>
        <IdleGuard />
      </ShellProvider>
    </LiveProvider>
  );
}

function Shell({ role, children }: { role: Parameters<typeof MobileNav>[0]["role"]; children: React.ReactNode }) {
  const { collapsed } = useShell();
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="transition-[padding] duration-300 lg:pl-[var(--rail)]" style={{ ["--rail" as string]: `${collapsed ? SIDEBAR_W.rail : SIDEBAR_W.open}px` }}>
        <Topbar />
        <main className="mx-auto max-w-[1520px] px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <MobileNav role={role} />
    </div>
  );
}
