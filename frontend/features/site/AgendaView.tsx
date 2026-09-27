"use client";

import { ChevronDown } from "lucide-react";

import { Spinner } from "@/components/loaders";
import { PublicShell } from "@/components/public/PublicShell";
import { Card } from "@/components/ui";

import { useAgenda, usePage } from "./api";
import { mediaUrl, RichBody } from "./media";

/** Our Agenda: HQ's introduction, then each pledge as a numbered card that opens for the detail. */
export function AgendaView() {
  const intro = usePage("agenda");
  const items = useAgenda();
  const loading = intro.isLoading || items.isLoading;
  const list = items.data ?? [];
  return (
    <PublicShell eyebrow="Our agenda" title={intro.data?.title ?? ""} lead="What we will do for Mombasa, shaped by what residents tell us.">
      {loading ? <Card className="grid h-40 place-items-center"><Spinner /></Card> : (
        <div className="space-y-6">
          {intro.data?.body && (
            <Card className="p-6 sm:p-10">
              <RichBody text={intro.data.body} media={intro.data.media} className="max-w-3xl text-base leading-relaxed text-slate-700 [&_p.font-display]:mt-7 [&_p.font-display]:text-xl" />
            </Card>
          )}
          {list.length ? (
            <ol className="grid gap-4 md:grid-cols-2">
              {list.map((a, i) => (
                <li key={a.id}>
                  <Card className="h-full overflow-hidden">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none flex-col [&::-webkit-details-marker]:hidden">
                        {a.cover_id && <img src={mediaUrl(a.cover_id, true)} alt="" loading="lazy" className="aspect-[5/2] w-full object-cover" />}
                        <div className="flex gap-4 p-6">
                          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-950 font-display text-base font-extrabold text-gold">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <h2 className="font-display text-lg font-bold text-navy-900">{a.title}</h2>
                            <p className="mt-1 text-sm text-slate-600">{a.summary}</p>
                            {a.body.trim() && (
                              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-ocean">
                                <span className="group-open:hidden">Read the plan</span><span className="hidden group-open:inline">Show less</span>
                                <ChevronDown className="size-4 transition group-open:rotate-180" />
                              </span>
                            )}
                          </div>
                        </div>
                      </summary>
                      {a.body.trim() && <RichBody text={a.body} media={a.media} className="border-t border-line px-6 pt-4 pb-6 text-sm leading-relaxed text-slate-700" />}
                    </details>
                  </Card>
                </li>
              ))}
            </ol>
          ) : !intro.data?.body && (
            <Card className="p-6 sm:p-10"><p className="text-slate-500">The agenda is being finalised with residents&apos; input. Tell us what matters in your area from the home page.</p></Card>
          )}
        </div>
      )}
    </PublicShell>
  );
}
