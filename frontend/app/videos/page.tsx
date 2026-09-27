"use client";

import { Clapperboard, Link2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/loaders";
import { PublicShell } from "@/components/public/PublicShell";
import { Button, Card } from "@/components/ui";
import { useVideo, useVideos, type Video } from "@/features/site/api";
import { shortDate, topicLabel, VideoCard, VideoPlayer } from "@/features/site/videos";
import { cn } from "@/lib/cn";

export default function VideosPage() {
  const [topic, setTopic] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  // A shared link (?v=…) opens that video.
  useEffect(() => { setPicked(new URLSearchParams(window.location.search).get("v")); }, []);
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const list = useVideos(topic, search);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const topics = list.data?.pages[0]?.topics ?? [];
  const linked = useVideo(picked && !items.some((v) => v.id === picked) ? picked : null);
  const current: Video | undefined = items.find((v) => v.id === picked) ?? linked.data ?? items[0];

  const play = (v: Video) => {
    setPicked(v.id);
    setAutoPlay(true);
    window.history.replaceState(null, "", `/videos?v=${v.id}`);
    stage.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const share = async () => {
    if (!current) return;
    const url = `${window.location.origin}/videos?v=${current.id}`;
    try {
      if (navigator.share) await navigator.share({ title: current.title, url });
      else { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    } catch { /* closed the share sheet */ }
  };

  return (
    <PublicShell eyebrow="Videos" title="Watch the campaign" lead="Rallies, town halls and interviews from across Mombasa. The newest are always first.">
      <div className="space-y-6">
        {list.isLoading ? <Card className="grid h-64 place-items-center"><Spinner /></Card> : !current ? (
          <Card className="flex flex-col items-center p-10 text-center">
            <Clapperboard className="size-8 text-slate-300" />
            <p className="mt-3 text-slate-500">{search || topic ? "No videos match that. Try another topic or word." : "No videos yet. Check back soon."}</p>
          </Card>
        ) : (
          <div ref={stage} className="scroll-mt-4 overflow-hidden rounded-2xl bg-[#06101f] text-white shadow-lg ring-1 ring-black/5">
            <div className="mx-auto max-w-4xl"><VideoPlayer key={current.id} v={current} autoPlay={autoPlay} /></div>
            <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-wider text-gold uppercase">{topicLabel(current.topic)} · {shortDate(current.published_at)}</p>
                <h2 className="mt-1 font-display text-xl font-bold sm:text-2xl">{current.title}</h2>
                {current.description && <p className="mt-2 max-w-3xl text-sm text-slate-300">{current.description}</p>}
              </div>
              <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => void share()}>Share</Button>
            </div>
          </div>
        )}

        {(items.length > 0 || search || topic) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="Topics" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
              {[{ id: "", label: "All", count: 0 }, ...topics].map((t) => (
                <button key={t.id || "all"} type="button" onClick={() => setTopic(t.id)} aria-pressed={topic === t.id}
                  aria-label={t.count ? `${t.label}, ${t.count} ${t.count === 1 ? "video" : "videos"}` : t.label}
                  className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition",
                    topic === t.id ? "bg-navy-950 text-white ring-navy-950" : "bg-white text-navy-900 ring-line hover:bg-slate-50")}>
                  {t.label}{t.count ? <span className="ml-1 text-xs opacity-70">{t.count}</span> : null}
                </button>
              ))}
            </div>
            <label className="relative block sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos" aria-label="Search videos"
                className="h-11 w-full rounded-xl border border-line bg-white pr-3 pl-9 text-base focus:border-ocean focus:outline-none sm:text-sm" />
            </label>
          </div>
        )}

        {items.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((v) => <li key={v.id}><VideoCard v={v} active={v.id === current?.id} onPlay={() => play(v)} /></li>)}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="text-center">
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more videos</Button>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
