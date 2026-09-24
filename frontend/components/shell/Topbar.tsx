"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/loaders";
import { SyncStatus } from "@/components/shell/SyncStatus";
import { useAuth, useUser } from "@/lib/auth";
import { initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";

export function Topbar() {
  const user = useUser();
  const { logout } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
          <BrandMark className="size-8" />
        </Link>
        <div className="hidden items-center gap-2 text-xs text-muted lg:flex">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-kenya-green opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-kenya-green" />
          </span>
          Live · Mombasa County
        </div>
        <div className="flex items-center gap-3">
          <SyncStatus />
          <div className="text-right max-sm:hidden">
            <p className="text-sm font-semibold text-navy-900">{user.full_name}</p>
            <p className="text-[11px] text-muted">{ROLE_LABEL[user.role]}</p>
          </div>
          <div className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-navy-800 to-navy-950 text-sm font-bold text-gold ring-2 ring-gold/30">
            {initials(user.full_name)}
          </div>
          <button onClick={() => void logout()} className="rounded-lg p-2 text-muted transition hover:bg-slate-100 hover:text-kenya-red" aria-label="Sign out" title="Sign out">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
