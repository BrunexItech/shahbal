"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/loaders";
import { SyncStatus } from "@/components/shell/SyncStatus";
import { LiveDot } from "@/components/ui/Motion";
import { useAuth, useUser } from "@/lib/auth";
import { CANDIDATE_NAME } from "@/lib/config";
import { initials } from "@/lib/format";
import { useLive } from "@/lib/live";

const clock = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export function Topbar() {
  const user = useUser();
  const { logout } = useAuth();
  const { connected, lastAt } = useLive();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-white/75 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
          <BrandMark className="size-8" />
          <span className="font-display text-sm font-bold text-navy-900">{CANDIDATE_NAME}</span>
        </Link>
        <div className="hidden items-center gap-3 text-xs lg:flex">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold ring-1 ${connected ? "bg-kenya-green-50 text-kenya-green ring-kenya-green/15" : "bg-slate-100 text-slate-500 ring-line"}`}>
            <LiveDot on={connected} className="size-2" /> {connected ? "Live" : "Connecting…"}
          </span>
          <span className="text-muted">Mombasa County · {now ? clock.format(now) : ""} EAT</span>
          {lastAt && <span className="text-muted/70">updated {Math.max(0, Math.round(((now?.getTime() ?? Date.now()) - lastAt) / 1000))}s ago</span>}
        </div>
        <div className="flex items-center gap-3">
          <SyncStatus />
          <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-navy-800 to-navy-950 text-xs font-bold text-gold ring-2 ring-gold/30 lg:hidden">
            {initials(user.full_name)}
          </div>
          <button onClick={() => void logout()} className="rounded-lg p-2 text-muted transition hover:bg-slate-100 hover:text-kenya-red lg:hidden" aria-label="Sign out">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
