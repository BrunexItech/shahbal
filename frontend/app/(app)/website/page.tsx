"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Eye, EyeOff, FilePen, ImageIcon, Images, ListChecks, Newspaper, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, Input, Modal, PageHeader, Textarea, useConfirm } from "@/components/ui";
import type { AgendaItem, NewsItem, SitePage } from "@/features/site/api";
import { BlockEditor, CoverPicker, MediaLibrary, mediaUrl, RichBody, useMediaMap } from "@/features/site/media";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";

const TABS = [["news", "News"], ["agenda", "Agenda"], ["about", "About"], ["contact", "Contact"]] as const;
type Tab = (typeof TABS)[number][0];

export default function WebsitePage() {
  const [tab, setTab] = useState<Tab>("news");
  const [library, setLibrary] = useState(false);
  return (
    <>
      <PageHeader eyebrow="Communications" title="Public website"
        subtitle="The pages, agenda and news the public sees. Events come from the calendar when a field event is marked “Show on the public website”."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Images className="size-4" />} onClick={() => setLibrary(true)}>Media library</Button>
          <Link href="/about" target="_blank" className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-line hover:bg-slate-50"><ExternalLink className="size-4" /> View the site</Link>
        </div>} />
      <div role="tablist" aria-label="Website" className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 sm:inline-flex">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-white text-navy-900 shadow-sm" : "text-muted")}>{l}</button>
        ))}
      </div>
      {tab === "news" ? <NewsEditor /> : tab === "agenda" ? <AgendaManager /> : <PageEditor key={tab} pageKey={tab} href={`/${tab}`} />}
      {library && <MediaLibrary onClose={() => setLibrary(false)} />}
    </>
  );
}

// ---- About / Contact / Agenda introduction -------------------------------------------------
function PageEditor({ pageKey, href, intro }: { pageKey: string; href: string; intro?: boolean }) {
  const page = useQuery({ queryKey: ["site", "page", pageKey], queryFn: () => api<SitePage>(`/site/pages/${pageKey}`) });
  if (!page.data) return <Card><SkeletonRows rows={4} /></Card>;
  return <PageForm page={page.data} href={href} intro={intro} />;
}

function PageForm({ page, href, intro }: { page: SitePage; href: string; intro?: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [preview, setPreview] = useState(false);
  const media = useMediaMap();
  const save = useMutation({
    mutationFn: () => api<SitePage>(`/site-admin/pages/${page.key}`, { method: "PUT", body: { title, body } }),
    onSuccess: (p) => { qc.setQueryData(["site", "page", page.key], p); toast.success("Published"); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-navy-900">{intro ? "Introduction above the agenda" : "Page"}</p>
        {!preview && <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(true)}>Preview</Button>}
      </div>
      {preview ? (
        <div>
          <PreviewBar onBack={() => setPreview(false)} />
          <div className="rounded-xl bg-slate-50 p-5">
          <p className="font-display text-xl font-extrabold text-navy-900">{title}</p>
          {body.trim() ? <RichBody compact text={body} media={{ ...page.media, ...media }} className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-700" /> : <p className="mt-3 text-sm text-slate-400">Nothing written yet.</p>}
          </div>
        </div>
      ) : (
        <>
          <Input label="Page title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
          <BlockEditor initial={body} onChange={setBody} label={intro ? "Introduction" : "Page text"} />
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <p className="text-xs text-slate-500">{page.updated_at ? `Last published ${dateTime(page.updated_at)}` : "Not published yet"}</p>
        <div className="flex gap-2">
          <Link href={href} target="_blank" className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ocean hover:bg-ocean-50"><ExternalLink className="size-4" /> Open page</Link>
          <Button loading={save.isPending} disabled={title.trim().length < 3} onClick={() => save.mutate()}>Publish changes</Button>
        </div>
      </div>
    </Card>
  );
}

// ---- Agenda --------------------------------------------------------------------------------
function AgendaManager() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const items = useQuery({ queryKey: ["site-admin", "agenda"], queryFn: () => api<AgendaItem[]>("/site-admin/agenda") });
  const [editing, setEditing] = useState<Partial<AgendaItem> | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["site-admin", "agenda"] }); qc.invalidateQueries({ queryKey: ["site", "agenda"] }); };
  const order = useMutation({
    mutationFn: (ids: string[]) => api("/site-admin/agenda/order", { body: { ids } }),
    onMutate: (ids) => qc.setQueryData<AgendaItem[]>(["site-admin", "agenda"], (l) => ids.map((id) => l!.find((a) => a.id === id)!)),
    onError: (e) => toast.error(e.message),
    onSettled: refresh,
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/site-admin/agenda/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); toast.success("Removed from the agenda"); },
    onError: (e) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (a: AgendaItem) => api(`/site-admin/agenda/${a.id}`, { method: "PUT", body: { title: a.title, summary: a.summary, body: a.body, cover_id: a.cover_id, published: !a.published } }),
    onSuccess: (_, a) => { refresh(); toast.success(a.published ? "Hidden from the website" : "Shown on the website"); },
    onError: (e) => toast.error(e.message),
  });
  const list = items.data ?? [];
  const move = (i: number, d: -1 | 1) => {
    const ids = list.map((a) => a.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    order.mutate(ids);
  };
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div><p className="font-bold text-navy-900">Agenda items</p><p className="text-xs text-slate-500">Each pledge is a card on the Our Agenda page, in this order. Hidden items are kept as drafts.</p></div>
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ published: true })}>Add item</Button>
        </div>
        {items.isLoading ? <SkeletonRows rows={3} /> : !list.length ? (
          <div className="flex flex-col items-center px-6 py-12 text-center"><ListChecks className="size-8 text-slate-300" /><p className="mt-2 text-sm text-slate-500">No agenda items yet. Add the first pledge.</p></div>
        ) : (
          <ol className="divide-y divide-line">
            {list.map((a, i) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:flex-nowrap">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-950 text-xs font-bold text-gold">{i + 1}</span>
                {a.cover_id ? <img src={mediaUrl(a.cover_id, true)} alt="" className="hidden h-12 w-16 shrink-0 rounded-lg object-cover sm:block" />
                  : <span className="hidden h-12 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-300 sm:grid"><ImageIcon className="size-5" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-semibold text-navy-900">{a.title}{!a.published && <Badge tone="slate">Hidden</Badge>}</p>
                  <p className="truncate text-xs text-slate-500">{a.summary}</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center">
                  <RowBtn label="Move up" disabled={i === 0 || order.isPending} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></RowBtn>
                  <RowBtn label="Move down" disabled={i === list.length - 1 || order.isPending} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></RowBtn>
                  <RowBtn label={a.published ? `Hide ${a.title}` : `Show ${a.title}`} onClick={() => toggle.mutate(a)}>{a.published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</RowBtn>
                  <RowBtn label={`Edit ${a.title}`} onClick={() => setEditing(a)}><FilePen className="size-4" /></RowBtn>
                  <RowBtn label={`Delete ${a.title}`} danger onClick={async () => { if (await confirm({ title: "Delete this agenda item?", body: a.title, confirmLabel: "Delete", danger: true })) del.mutate(a.id); }}><Trash2 className="size-4" /></RowBtn>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <PageEditor pageKey="agenda" href="/agenda" intro />
      {editing && <AgendaModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />}
    </div>
  );
}

function RowBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={cn("grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30", danger ? "hover:bg-red-50 hover:text-kenya-red" : "hover:text-navy-900")}>
      {children}
    </button>
  );
}

function AgendaModal({ initial, onClose, onSaved }: { initial: Partial<AgendaItem>; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState({ title: initial.title ?? "", summary: initial.summary ?? "", body: initial.body ?? "", cover_id: initial.cover_id ?? null as string | null, published: initial.published ?? true });
  const save = useMutation({
    mutationFn: () => initial.id ? api(`/site-admin/agenda/${initial.id}`, { method: "PUT", body: s }) : api("/site-admin/agenda", { body: s }),
    onSuccess: () => { toast.success("Agenda updated"); onSaved(); },
    onError: (e) => toast.error(e.message),
  });
  const ok = s.title.trim().length >= 3 && s.summary.trim().length >= 10;
  const [preview, setPreview] = useState(false);
  const media = useMediaMap();
  return (
    <Modal open onClose={onClose} size="lg" title={initial.id ? "Edit agenda item" : "New agenda item"}
      footer={<>
        {preview
          ? <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setPreview(false)}>Back to editing</Button>
          : <Button variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(true)}>Preview</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>Save</Button>
      </>}>
      {preview ? (
        <article>
          <PreviewBar onBack={() => setPreview(false)} />
          <div className="max-w-md overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            {s.cover_id && <img src={mediaUrl(s.cover_id, true)} alt="" className="aspect-[5/2] w-full object-cover" />}
            <div className="p-5">
              <p className="font-display text-lg font-bold text-navy-900">{s.title || "Title"}</p>
              <p className="mt-1 text-sm text-slate-600">{s.summary}</p>
              {s.body.trim() && <RichBody compact text={s.body} media={{ ...initial.media, ...media }} className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-slate-700" />}
            </div>
          </div>
        </article>
      ) : (
      <div className="space-y-4">
        <Input label="Title" required maxLength={120} placeholder="e.g. Clean water in every ward" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />
        <Textarea label="Summary" required rows={2} maxLength={300} value={s.summary} onChange={(e) => setS({ ...s, summary: e.target.value })} hint="One or two sentences shown on the card." />
        <CoverPicker value={s.cover_id} onChange={(id) => setS((x) => ({ ...x, cover_id: id }))} />
        <BlockEditor initial={s.body} onChange={(body) => setS((x) => ({ ...x, body }))} label="Details, shown when someone opens the card" />
        <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <input type="checkbox" className="size-4 accent-kenya-green" checked={s.published} onChange={(e) => setS({ ...s, published: e.target.checked })} /> Show on the website
        </label>
      </div>
      )}
    </Modal>
  );
}

/** Sits on top of every preview so there's always an obvious way back to the editor. */
function PreviewBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ocean-50 px-4 py-2.5 ring-1 ring-ocean/15">
      <p className="flex items-center gap-2 text-sm font-semibold text-navy-900"><Eye className="size-4 text-ocean" /> Preview: how it will look on the website</p>
      <Button size="sm" variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back to editing</Button>
    </div>
  );
}

// ---- News ----------------------------------------------------------------------------------
function NewsEditor() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const news = useQuery({ queryKey: ["site-admin", "news"], queryFn: () => api<NewsItem[]>("/site-admin/news") });
  const [editing, setEditing] = useState<Partial<NewsItem> | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["site-admin", "news"] }); qc.invalidateQueries({ queryKey: ["site", "news"] }); };
  const del = useMutation({
    mutationFn: (id: string) => api(`/site-admin/news/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); toast.success("Story deleted"); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div><p className="font-bold text-navy-900">News stories</p><p className="text-xs text-slate-500">Drafts stay private until you publish them.</p></div>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ published: false })}>New story</Button>
      </div>
      {news.isLoading ? <SkeletonRows rows={3} /> : !news.data?.length ? (
        <div className="flex flex-col items-center px-6 py-12 text-center"><Newspaper className="size-8 text-slate-300" /><p className="mt-2 text-sm text-slate-500">No stories yet.</p></div>
      ) : (
        <ul className="divide-y divide-line">
          {news.data.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-5 py-3">
              {n.cover_id ? <img src={mediaUrl(n.cover_id, true)} alt="" className="hidden h-12 w-16 shrink-0 rounded-lg object-cover sm:block" />
                : <span className="hidden h-12 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-300 sm:grid"><ImageIcon className="size-5" /></span>}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-navy-900">{n.title}</p>
                <p className="truncate text-xs text-slate-500">{n.summary}</p>
              </div>
              <Badge tone={n.published ? "green" : "slate"}>{n.published ? "Published" : "Draft"}</Badge>
              <RowBtn label={`Edit ${n.title}`} onClick={() => setEditing(n)}><FilePen className="size-4" /></RowBtn>
              <RowBtn label={`Delete ${n.title}`} danger onClick={async () => { if (await confirm({ title: "Delete this story?", body: n.title, confirmLabel: "Delete", danger: true })) del.mutate(n.id); }}><Trash2 className="size-4" /></RowBtn>
            </li>
          ))}
        </ul>
      )}
      {editing && <StoryModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />}
    </Card>
  );
}

function StoryModal({ initial, onClose, onSaved }: { initial: Partial<NewsItem>; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState({ title: initial.title ?? "", summary: initial.summary ?? "", body: initial.body ?? "", published: initial.published ?? false,
    cover_id: initial.cover_id ?? null as string | null });
  const [preview, setPreview] = useState(false);
  const media = useMediaMap();
  const save = useMutation({
    mutationFn: () => initial.id ? api(`/site-admin/news/${initial.id}`, { method: "PUT", body: s }) : api("/site-admin/news", { body: s }),
    onSuccess: () => { toast.success(s.published ? "Story published" : "Draft saved"); onSaved(); },
    onError: (e) => toast.error(e.message),
  });
  const ok = s.title.trim().length >= 5 && s.summary.trim().length >= 10 && s.body.trim().length >= 20;
  return (
    <Modal open onClose={onClose} size="lg" title={initial.id ? "Edit story" : "New story"}
      footer={<>
        {preview
          ? <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setPreview(false)}>Back to editing</Button>
          : <Button variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(true)}>Preview</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{s.published ? "Publish" : "Save draft"}</Button>
      </>}>
      {preview ? (
        <article>
          <PreviewBar onBack={() => setPreview(false)} />
          {s.cover_id && <img src={mediaUrl(s.cover_id, true)} alt="" className="mb-4 aspect-[16/9] w-full max-w-sm rounded-xl object-cover" />}
          <p className="font-display text-xl font-extrabold text-navy-900">{s.title || "Headline"}</p>
          <p className="mt-1 text-sm text-slate-500">{s.summary}</p>
          <RichBody compact text={s.body} media={{ ...initial.media, ...media }} className="mt-4 text-sm leading-relaxed text-slate-700" />
        </article>
      ) : (
        <div className="space-y-4">
          <Input label="Headline" required maxLength={140} value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />
          <Textarea label="Summary" required rows={2} maxLength={300} value={s.summary} onChange={(e) => setS({ ...s, summary: e.target.value })} hint="One or two sentences shown on the news list." />
          <CoverPicker value={s.cover_id} onChange={(id) => setS((x) => ({ ...x, cover_id: id }))} />
          <BlockEditor initial={s.body} onChange={(body) => setS((x) => ({ ...x, body }))} label="Story" />
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
            <input type="checkbox" className="size-4 accent-kenya-green" checked={s.published} onChange={(e) => setS({ ...s, published: e.target.checked })} /> Published on the website
          </label>
        </div>
      )}
    </Modal>
  );
}
