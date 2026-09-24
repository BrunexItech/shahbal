"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileAudio, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, EmptyState, Pagination } from "@/components/ui";
import { api, fetchBlob } from "@/lib/api";
import { dateTime } from "@/lib/format";

type Rec = { id: string; created_at: string; agent: string; voter: string | null; voter_reference: string | null; voter_id: string | null; dialled_last4: string | null; duration_seconds: number; line: string };

/** Browser-recorded WebM has no duration header; seek to the end once so the
 *  player learns the length (then return to the start) and the scrubber works. */
function fixDuration(el: HTMLAudioElement | null) {
  if (!el) return;
  el.addEventListener("loadedmetadata", () => {
    if (el.duration !== Infinity) return;
    const back = () => {
      el.removeEventListener("timeupdate", back);
      el.currentTime = 0;
    };
    el.addEventListener("timeupdate", back);
    el.currentTime = 1e101;
  }, { once: true });
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Supervisors' recordings library. Playback asks for re-confirmation and is audited. */
export function RecordingsPanel() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["calls", "recordings", page],
    queryFn: () => api<{ items: Rec[]; total: number; page: number; size: number }>("/calls/recordings", { query: { page, size: 20 } }),
    placeholderData: keepPreviousData,
  });
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => () => { if (playing) URL.revokeObjectURL(playing.url); }, [playing]);

  async function play(id: string) {
    setBusy(id);
    try {
      const blob = await fetchBlob(`/calls/recordings/${id}/audio`);
      if (playing) URL.revokeObjectURL(playing.url);
      setPlaying({ id, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't play the recording");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Call recordings" subtitle="Encrypted at rest. Playing one needs a quick re-check and is recorded in the audit trail." />
      {isLoading ? <SkeletonRows rows={5} cols={4} /> : !data?.items.length ? (
        <EmptyState icon={<FileAudio className="size-6" />} title="No recordings yet" body="Calls made from the softphone appear here once the voter has been told about recording." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {data.items.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-ocean-50 text-ocean"><FileAudio className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-900">
                      {r.voter_id ? <Link href={`/voters/${r.voter_id}`} className="hover:underline">{r.voter}</Link> : `Manual call ••${r.dialled_last4 ?? ""}`}
                      <span className="font-normal text-muted"> · {r.agent}</span>
                    </p>
                    <p className="text-xs text-muted">{dateTime(r.created_at)} · {mmss(r.duration_seconds)} {r.line === "sandbox" && <Badge className="ml-1">training</Badge>}</p>
                  </div>
                  <Button size="sm" variant="secondary" loading={busy === r.id} icon={<Play className="size-3.5" />} onClick={() => play(r.id)}>Play</Button>
                </div>
                {playing?.id === r.id && <audio ref={fixDuration} src={playing.url} controls autoPlay className="mt-3 w-full" />}
              </li>
            ))}
          </ul>
          <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
