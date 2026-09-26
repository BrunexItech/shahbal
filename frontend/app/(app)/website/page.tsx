"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Eye, FilePen, Newspaper, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, Input, Modal, PageHeader, Textarea, useConfirm } from "@/components/ui";
import { Markdown } from "@/features/ai/Markdown";
import type { NewsItem, SitePage } from "@/features/site/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";

const PAGES: [string, string, string][] = [
  ["about", "About", "/about"], ["agenda", "Our agenda", "/agenda"], ["contact", "Contact", "/contact"],
];
const HELP = "Write in plain text. Start a line with ## for a heading, - for a bullet, and wrap words in **double stars** for bold.";

export default function WebsitePage() {
  const [tab, setTab] = useState("about");
  return (
    <>
      <PageHeader eyebrow="Setup" title="Public website"
        subtitle="What the public sees at the home address: the pages below and the news. Events come from the calendar when you tick “Show on the public website”."
        actions={<Link href="/about" target="_blank" className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-line hover:bg-slate-50"><ExternalLink className="size-4" /> View the site</Link>} />
      <div role="tablist" aria-label="Website" className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 sm:inline-flex">
        {[...PAGES.map(([k, l]) => [k, l]), ["news", "News"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-white text-navy-900 shadow-sm" : "text-muted")}>{l}</button>
        ))}
      </div>
      {tab === "news" ? <NewsEditor /> : <PageEditor key={tab} pageKey={tab} href={PAGES.find(([k]) => k === tab)![2]} />}
    </>
  );
}

function PageEditor({ pageKey, href }: { pageKey: string; href: string }) {
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["site", "page", pageKey], queryFn: () => api<SitePage>(`/site/pages/${pageKey}`) });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => { if (page.data) { setTitle(page.data.title); setBody(page.data.body); } }, [page.data]);
  const save = useMutation({
    mutationFn: () => api<SitePage>(`/site-admin/pages/${pageKey}`, { method: "PUT", body: { title, body } }),
    onSuccess: (p) => { qc.setQueryData(["site", "page", pageKey], p); toast.success("Page published"); },
    onError: (e) => toast.error(e.message),
  });
  if (!page.data) return <Card><SkeletonRows rows={4} /></Card>;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="space-y-4 p-5">
        <Input label="Page title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Page text" rows={18} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} hint={HELP} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{page.data.updated_at ? `Last published ${dateTime(page.data.updated_at)}` : "Not published yet"}</p>
          <div className="flex gap-2">
            <Link href={href} target="_blank" className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ocean hover:bg-ocean-50"><Eye className="size-4" /> Open page</Link>
            <Button loading={save.isPending} disabled={title.trim().length < 3} onClick={() => save.mutate()}>Publish changes</Button>
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <p className="mb-3 text-xs font-bold tracking-wider text-slate-500 uppercase">Preview</p>
        <p className="font-display text-2xl font-extrabold text-navy-900">{title}</p>
        {body.trim() ? <Markdown text={body} className="mt-3 text-sm leading-relaxed text-slate-700" /> : <p className="mt-3 text-sm text-slate-400">Nothing written yet.</p>}
      </Card>
    </div>
  );
}

function NewsEditor() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const news = useQuery({ queryKey: ["site-admin", "news"], queryFn: () => api<NewsItem[]>("/site-admin/news") });
  const [editing, setEditing] = useState<Partial<NewsItem> | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["site-admin", "news"] }); qc.invalidateQueries({ queryKey: ["site", "news"] }); };
  const del = useMutation({ mutationFn: (id: string) => api(`/site-admin/news/${id}`, { method: "DELETE" }), onSuccess: () => { refresh(); toast.success("Story deleted"); } });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><p className="font-bold text-navy-900">News stories</p><p className="text-xs text-slate-500">Drafts stay private until you publish them.</p></div>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ published: false })}>New story</Button>
      </div>
      {news.isLoading ? <SkeletonRows rows={3} /> : !news.data?.length ? (
        <div className="flex flex-col items-center px-6 py-12 text-center"><Newspaper className="size-8 text-slate-300" /><p className="mt-2 text-sm text-slate-500">No stories yet.</p></div>
      ) : (
        <ul className="divide-y divide-line">
          {news.data.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-navy-900">{n.title}</p>
                <p className="truncate text-xs text-slate-500">{n.summary}</p>
              </div>
              <Badge tone={n.published ? "green" : "slate"}>{n.published ? "Published" : "Draft"}</Badge>
              <button onClick={() => setEditing(n)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-navy-900" aria-label={`Edit ${n.title}`}><FilePen className="size-4" /></button>
              <button onClick={async () => { if (await confirm({ title: "Delete this story?", body: n.title, confirmLabel: "Delete", danger: true })) del.mutate(n.id); }}
                className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-kenya-red" aria-label={`Delete ${n.title}`}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {editing && <StoryModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />}
    </Card>
  );
}

function StoryModal({ initial, onClose, onSaved }: { initial: Partial<NewsItem>; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState({ title: initial.title ?? "", summary: initial.summary ?? "", body: initial.body ?? "", published: initial.published ?? false });
  const save = useMutation({
    mutationFn: () => initial.id ? api(`/site-admin/news/${initial.id}`, { method: "PUT", body: s }) : api("/site-admin/news", { body: s }),
    onSuccess: () => { toast.success(s.published ? "Story published" : "Draft saved"); onSaved(); },
    onError: (e) => toast.error(e.message),
  });
  const ok = s.title.trim().length >= 5 && s.summary.trim().length >= 10 && s.body.trim().length >= 20;
  return (
    <Modal open onClose={onClose} size="lg" title={initial.id ? "Edit story" : "New story"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{s.published ? "Publish" : "Save draft"}</Button></>}>
      <div className="space-y-4">
        <Input label="Headline" required maxLength={140} value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />
        <Textarea label="Summary" required rows={2} maxLength={300} value={s.summary} onChange={(e) => setS({ ...s, summary: e.target.value })} hint="One or two sentences shown on the news list." />
        <Textarea label="Story" required rows={12} maxLength={20000} value={s.body} onChange={(e) => setS({ ...s, body: e.target.value })} hint={HELP} />
        <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <input type="checkbox" className="size-4 accent-kenya-green" checked={s.published} onChange={(e) => setS({ ...s, published: e.target.checked })} /> Published on the website
        </label>
      </div>
    </Modal>
  );
}
