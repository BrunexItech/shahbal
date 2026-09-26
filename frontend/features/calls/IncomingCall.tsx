"use client";

import { MapPin, Phone, PhoneIncoming, PhoneOff, ShieldAlert } from "lucide-react";

import { StatusBadge, SupportBadge } from "@/components/ui";
import type { Softphone } from "@/features/calls/useSoftphone";
import { initials } from "@/lib/format";
import type { Support, VoterStatus } from "@/lib/types";

/** Ringing banner: who's calling (matched to their voter record when known), Answer or Decline. */
export function IncomingCall({ phone, onAnswer }: { phone: Softphone; onAnswer: () => void }) {
  if (phone.state !== "incoming") return null;
  const c = phone.caller;
  const v = c?.voter;
  const name = v?.full_name ?? c?.name ?? "Unknown caller";
  return (
    <div role="alertdialog" aria-live="assertive" aria-label={`Incoming call from ${name}`}
      className="fixed inset-x-3 top-3 z-50 mx-auto max-w-lg animate-fade-up overflow-hidden rounded-3xl bg-[#06101f] text-white shadow-[0_30px_70px_-20px_rgba(6,16,31,.9)] ring-1 ring-white/10 sm:top-6">
      <div aria-hidden className="flex h-1"><i className="flex-[3] bg-kenya-black" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-red" /><i className="flex-1 bg-white" /><i className="flex-[3] bg-kenya-green" /></div>
      <div className="flex items-center gap-4 p-5">
        <span className="relative grid size-16 shrink-0 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[#34c77b]/30" />
          <span className="relative grid size-14 place-items-center rounded-full bg-gradient-to-br from-gold to-[#8a6d12] text-lg font-extrabold text-navy-950">{initials(name)}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold tracking-[.16em] text-[#8ff0bf] uppercase"><PhoneIncoming className="size-3.5" /> Incoming call</p>
          <p className="truncate font-display text-xl font-bold">{name}</p>
          <p className="font-mono text-sm text-slate-300">{c?.number}</p>
          {v ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-slate-300"><MapPin className="size-3.5" />{v.ward}</span>
              <StatusBadge status={v.status as VoterStatus} />
              <SupportBadge support={v.support as Support} />
            </div>
          ) : c?.voter === null ? <p className="mt-1 text-xs text-slate-400">Not in the voter registry yet. You can capture them after the call.</p>
            : <p className="mt-1 text-xs text-slate-400">Looking up the number…</p>}
          {v && (v.do_not_call || v.opted_out) && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-300"><ShieldAlert className="size-3.5" /> Asked not to be contacted: take their call, but don&apos;t call them back.</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 pb-5">
        <button onClick={() => void phone.decline()} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 font-semibold text-slate-100 ring-1 ring-white/15 hover:bg-white/15">
          <PhoneOff className="size-5" /> Decline
        </button>
        <button onClick={onAnswer} autoFocus className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1fa463] font-semibold shadow-lg shadow-[#1fa463]/40 hover:brightness-110">
          <Phone className="size-5" /> Answer
        </button>
      </div>
    </div>
  );
}
