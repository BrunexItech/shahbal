"use client";

import { Fragment } from "react";

/** Renders the little Markdown the assistant writes (## headings, - bullets, **bold**) as plain React, never raw HTML. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="my-2 list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) { list.push(bullet[1]); continue; }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<p key={blocks.length} className="mt-4 mb-1 font-display text-base font-bold text-navy-900 first:mt-0">{inline(h[1])}</p>);
    else blocks.push(<p key={blocks.length} className="my-1.5">{inline(line)}</p>);
  }
  flush();
  return <div className={className}>{blocks}</div>;
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i} className="font-semibold text-navy-900">{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>);
}
