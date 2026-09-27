"use client";

import { ArrowRight, CalendarDays, Clock, MapPin } from "lucide-react";
import Link from "next/link";

import { useAgenda, useNews, usePublicEvents } from "./api";
import { mediaUrl } from "./media";

type Lang = "en" | "sw";
const T = {
  en: { eyebrow: "The campaign", title: "What we stand for, and where we'll be", agenda: "Our agenda", news: "Latest news", events: "Coming up", all: "See all", read: "Read" },
  sw: { eyebrow: "Kampeni", title: "Tunachosimamia, na tutakapokuwa", agenda: "Ajenda yetu", news: "Habari mpya", events: "Matukio yajayo", all: "Ona zote", read: "Soma" },
};
const when = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", ...o });

/**
 * Below the sign-up: a glimpse of the agenda, the latest news and the next public events, each linking to its page.
 * Sections with nothing published stay out of the way; if nothing is published at all, this renders nothing.
 */
export function Highlights({ lang }: { lang: Lang }) {
  const t = T[lang];
  const agenda = useAgenda();
  const news = useNews();
  const events = usePublicEvents();
  const pledges = (agenda.data ?? []).slice(0, 3);
  const stories = (news.data ?? []).slice(0, 3);
  const next = (events.data ?? []).slice(0, 3);
  if (!pledges.length && !stories.length && !next.length) return null;

  return (
    <section aria-labelledby="highlights" className="mx-auto max-w-5xl space-y-10 px-4 pb-16">
      <div className="text-center">
        <p className="text-xs font-bold tracking-[.18em] text-ocean uppercase">{t.eyebrow}</p>
        <h2 id="highlights" className="mt-1 font-display text-2xl font-extrabold text-navy-900 sm:text-3xl">{t.title}</h2>
      </div>

      {pledges.length > 0 && (
        <div>
          <Heading title={t.agenda} href="/agenda" all={t.all} />
          <ol className="grid gap-3 md:grid-cols-3">
            {pledges.map((a, i) => (
              <li key={a.id}>
                <Link href="/agenda" className="group flex h-full gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-md">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-950 font-display text-sm font-extrabold text-gold">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block font-display font-bold text-navy-900">{a.title}</span>
                    <span className="mt-1 line-clamp-3 block text-sm text-slate-600">{a.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      {stories.length > 0 && (
        <div>
          <Heading title={t.news} href="/news" all={t.all} />
          <ul className="grid gap-3 md:grid-cols-3">
            {stories.map((n) => (
              <li key={n.id}>
                <Link href={`/news/${n.slug}`} className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-md">
                  {n.cover_id
                    ? <img src={mediaUrl(n.cover_id, true)} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
                    : <span aria-hidden className="block h-1.5 bg-gradient-to-r from-kenya-green via-gold to-kenya-red" />}
                  <span className="flex flex-1 flex-col p-5">
                    {n.published_at && <span className="text-xs font-semibold text-slate-500">{when(n.published_at, { day: "numeric", month: "long" })}</span>}
                    <span className="mt-1 font-display font-bold text-navy-900">{n.title}</span>
                    <span className="mt-1 line-clamp-2 text-sm text-slate-600">{n.summary}</span>
                    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-ocean">{t.read} <ArrowRight className="size-4" /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {next.length > 0 && (
        <div>
          <Heading title={t.events} href="/events" all={t.all} />
          <ul className="grid gap-3 md:grid-cols-3">
            {next.map((e) => (
              <li key={e.id} className="flex gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-line">
                <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-[#06101f] py-2 text-white">
                  <span className="text-xs font-bold text-gold uppercase">{when(e.starts_at, { month: "short" })}</span>
                  <span className="font-display text-xl leading-none font-extrabold">{when(e.starts_at, { day: "numeric" })}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-navy-900">{e.title}</span>
                  <span className="mt-1 flex items-center gap-1 truncate text-xs text-slate-600"><MapPin className="size-3.5 shrink-0" />{e.venue}, {e.ward}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-600"><Clock className="size-3.5 shrink-0" />{when(e.starts_at, { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Heading({ title, href, all }: { title: string; href: string; all: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold text-navy-900">{href === "/events" && <CalendarDays className="size-5 text-kenya-green" />}{title}</h3>
      <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-ocean hover:underline">{all} <ArrowRight className="size-4" /></Link>
    </div>
  );
}
