"use client";

import { ArrowRight, Newspaper } from "lucide-react";
import Link from "next/link";

import { Spinner } from "@/components/loaders";
import { PublicShell } from "@/components/public/PublicShell";
import { Card } from "@/components/ui";
import { useNews } from "@/features/site/api";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" }) : "");

export default function NewsPage() {
  const { data, isLoading } = useNews();
  return (
    <PublicShell eyebrow="News" title="From the campaign" lead="Updates from the trail across Mombasa's six constituencies.">
      {isLoading ? <Card className="grid h-40 place-items-center"><Spinner /></Card> : !data?.length ? (
        <Card className="flex flex-col items-center p-10 text-center"><Newspaper className="size-8 text-slate-300" /><p className="mt-3 text-slate-500">No stories yet. Check back soon.</p></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((n) => (
            <Link key={n.id} href={`/news/${n.slug}`} className="group">
              <Card className="h-full p-6 transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
                <p className="text-xs font-semibold text-slate-500">{day(n.published_at)}</p>
                <h2 className="mt-1 font-display text-xl font-bold text-navy-900">{n.title}</h2>
                <p className="mt-2 text-sm text-slate-600">{n.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ocean">Read the story <ArrowRight className="size-4" /></span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PublicShell>
  );
}
