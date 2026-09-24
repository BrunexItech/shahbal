"use client";

import { Badge, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CampaignStatus } from "@/lib/types";

const STATUS: Record<CampaignStatus, [Tone, string]> = {
  pending_approval: ["amber", "Awaiting approval"],
  scheduled: ["blue", "Scheduled"],
  sending: ["gold", "Sending"],
  sent: ["green", "Sent"],
  cancelled: ["slate", "Cancelled"],
  rejected: ["red", "Rejected"],
};

export const CampaignStatusBadge = ({ status }: { status: CampaignStatus }) => (
  <Badge tone={STATUS[status][0]} dot>{STATUS[status][1]}</Badge>
);

/** Toggle chips for multi-select filters (audience builder, layer lists). */
export function ChipGroup<T extends string>({ options, value, onChange, label, empty }: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
  empty?: string;
}) {
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-navy-900">{label}</p>
        <p className="text-xs text-muted">{value.length ? `${value.length} selected` : empty ?? "All"}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button key={o.value} type="button" onClick={() => toggle(o.value)} aria-pressed={on}
              className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                on ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-slate-600 ring-line hover:ring-slate-300")}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Phone-shaped preview so coordinators see exactly what lands on a voter's screen. */
export function PhonePreview({ text, channel, sender }: { text: string | null; channel: "sms" | "whatsapp"; sender: string }) {
  const wa = channel === "whatsapp";
  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[2.2rem] bg-navy-950 p-2.5 shadow-2xl ring-1 ring-black/10">
      <div className={cn("overflow-hidden rounded-[1.8rem]", wa ? "bg-[#efeae2]" : "bg-slate-50")}>
        <div className={cn("flex items-center gap-2 px-4 pt-6 pb-3", wa ? "bg-[#075e54] text-white" : "border-b border-slate-200 bg-white")}>
          <span className={cn("grid size-8 place-items-center rounded-full text-xs font-bold", wa ? "bg-white/20" : "bg-navy-900 text-gold")}>
            {sender.slice(0, 2).toUpperCase()}
          </span>
          <p className={cn("truncate text-sm font-semibold", wa ? "text-white" : "text-navy-900")}>{sender}</p>
        </div>
        <div className="min-h-[300px] px-3 py-4">
          {text ? (
            <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
              wa ? "rounded-tl-sm bg-white text-slate-900" : "rounded-bl-sm bg-slate-200 text-slate-900")}>
              {text}
            </div>
          ) : (
            <p className="px-4 pt-24 text-center text-xs text-muted">Your personalised preview appears here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
