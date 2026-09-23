"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV, NAV } from "@/components/shell/nav";
import { isActive } from "@/components/shell/Sidebar";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/types";

export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = MOBILE_NAV.map((h) => NAV.find((n) => n.href === h)!).filter((n) => n.show(role));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-navy-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="flex justify-around">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const primary = href === "/voters/new";
          return (
            <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium", active ? "text-gold" : "text-slate-400")}>
              <span className={cn("grid place-items-center", primary && "-mt-5 size-12 rounded-2xl bg-kenya-green text-white shadow-lg shadow-kenya-green/40")}>
                <Icon className="size-5" />
              </span>
              {label.split(" ")[0]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
