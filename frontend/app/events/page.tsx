"use client";

import { CalendarDays, Clock, MapPin } from "lucide-react";

import { Spinner } from "@/components/loaders";
import { PublicShell } from "@/components/public/PublicShell";
import { Card } from "@/components/ui";
import { usePublicEvents } from "@/features/site/api";

const KIND: Record<string, string> = { rally: "Rally", town_hall: "Town hall", market_walk: "Market walk", door_to_door: "Door to door", community_meeting: "Community meeting", visit: "Visit" };
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", ...o });

export default function EventsPage() {
  const { data, isLoading } = usePublicEvents();
  return (
    <PublicShell eyebrow="Events" title="Meet the team" lead="Rallies, town halls and walks near you. Come, ask questions, and bring a friend.">
      {isLoading ? <Card className="grid h-40 place-items-center"><Spinner /></Card> : !data?.length ? (
        <Card className="flex flex-col items-center p-10 text-center"><CalendarDays className="size-8 text-slate-300" /><p className="mt-3 text-slate-500">No public events announced yet. Join the team to hear first when we&apos;re in your ward.</p></Card>
      ) : (
        <ul className="space-y-3">
          {data.map((e) => (
            <li key={e.id}>
              <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <div className="grid w-20 shrink-0 place-items-center rounded-2xl bg-navy-950 py-3 text-center text-white">
                  <span className="text-xs font-bold tracking-wider text-gold uppercase">{fmt(e.starts_at, { month: "short" })}</span>
                  <span className="font-display text-3xl leading-none font-extrabold">{fmt(e.starts_at, { day: "numeric" })}</span>
                  <span className="text-xs text-slate-400">{fmt(e.starts_at, { weekday: "short" })}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold tracking-wider text-kenya-green uppercase">{KIND[e.kind] ?? "Event"}</p>
                  <p className="font-display text-xl font-bold text-navy-900">{e.title}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{e.venue}, {e.ward} ({e.constituency})</span>
                    <span className="inline-flex items-center gap-1"><Clock className="size-4" />{fmt(e.starts_at, { hour: "2-digit", minute: "2-digit", hour12: false })}{e.ends_at ? `–${fmt(e.ends_at, { hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}</span>
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
