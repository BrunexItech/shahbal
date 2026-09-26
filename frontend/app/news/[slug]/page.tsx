"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use } from "react";

import { Spinner } from "@/components/loaders";
import { PublicShell } from "@/components/public/PublicShell";
import { Card } from "@/components/ui";
import { Markdown } from "@/features/ai/Markdown";
import { useStory } from "@/features/site/api";

export default function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, isLoading, error } = useStory(slug);
  const when = data?.published_at ? new Date(data.published_at).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" }) : "";
  return (
    <PublicShell eyebrow={when ? `News · ${when}` : "News"} title={data?.title ?? (error ? "Story not found" : "")} lead={data?.summary}>
      <Card className="p-6 sm:p-10">
        {isLoading ? <div className="grid h-40 place-items-center"><Spinner /></div>
          : data?.body ? <Markdown text={data.body} className="max-w-3xl text-base leading-relaxed text-slate-700" />
          : <p className="text-slate-500">This story isn&apos;t available.</p>}
        <Link href="/news" className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ocean hover:underline"><ArrowLeft className="size-4" /> All news</Link>
      </Card>
    </PublicShell>
  );
}
