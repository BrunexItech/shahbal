import { cn } from "@/lib/cn";
import type { Source, Support, VoterStatus } from "@/lib/types";

const TONES = {
  green: "bg-kenya-green-50 text-kenya-green ring-kenya-green/15",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/15",
  red: "bg-red-50 text-kenya-red ring-kenya-red/15",
  blue: "bg-ocean-50 text-ocean ring-ocean/15",
  gold: "bg-gold-50 text-[#7a5f0c] ring-gold/25",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/10",
  navy: "bg-navy-900 text-white ring-navy-900",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS: Record<VoterStatus, [Tone, string]> = {
  verified: ["green", "Verified"],
  pending: ["amber", "Pending"],
  rejected: ["red", "Rejected"],
};
export const StatusBadge = ({ status }: { status: VoterStatus }) => (
  <Badge tone={STATUS[status][0]} dot>{STATUS[status][1]}</Badge>
);

export const SUPPORT: Record<Support, [Tone, string]> = {
  supporter: ["green", "Supporter"],
  leaning: ["blue", "Leaning"],
  undecided: ["gold", "Undecided"],
  opposed: ["red", "Opposed"],
  unknown: ["slate", "Unknown"],
};
export const SupportBadge = ({ support }: { support: Support }) => <Badge tone={SUPPORT[support][0]}>{SUPPORT[support][1]}</Badge>;

export const SOURCE_LABEL: Record<Source, string> = { field: "Field", portal: "Portal", call_centre: "Call centre", import: "Import" };
