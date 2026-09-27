"use client";

import { Spinner } from "@/components/loaders";
import { PublicShell } from "@/components/public/PublicShell";
import { Card } from "@/components/ui";

import { usePage } from "./api";
import { RichBody } from "./media";

/** An HQ-written page (About, Our agenda, Contact). */
export function ContentPage({ pageKey, eyebrow, lead, empty }: { pageKey: string; eyebrow: string; lead?: string; empty: string }) {
  const { data, isLoading } = usePage(pageKey);
  return (
    <PublicShell eyebrow={eyebrow} title={data?.title ?? ""} lead={lead}>
      <Card className="p-6 sm:p-10">
        {isLoading ? <div className="grid h-40 place-items-center"><Spinner /></div>
          : data?.body ? <RichBody text={data.body} media={data.media} className="max-w-3xl text-base leading-relaxed text-slate-700 [&_p.font-display]:mt-7 [&_p.font-display]:text-xl" />
          : <p className="text-slate-500">{empty}</p>}
      </Card>
    </PublicShell>
  );
}
