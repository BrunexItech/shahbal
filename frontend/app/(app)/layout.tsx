"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { BrandLoader } from "@/components/loaders";
import { MobileNav } from "@/components/shell/MobileNav";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { useAuth } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const mustEnrol = !!user?.mfa_setup_required;

  useEffect(() => {
    if (ready && !user) router.replace("/login");
    // Production policy: admins must turn on 2FA before touching anything else.
    else if (mustEnrol && pathname !== "/account") router.replace("/account?enrol=1");
  }, [ready, user, router, mustEnrol, pathname]);

  if (!ready || !user || (mustEnrol && pathname !== "/account")) return <BrandLoader />;

  return (
    <div className="min-h-screen">
      <Sidebar role={user.role} />
      <div className="lg:pl-[264px]">
        <Topbar />
        <main className="mx-auto max-w-[1440px] px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <MobileNav role={user.role} />
    </div>
  );
}
