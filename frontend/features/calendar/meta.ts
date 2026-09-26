import {
  Briefcase, CalendarClock, Flag, Footprints, HandCoins, Megaphone, MessageSquareText, Mic, Plane, Presentation, Route, ShoppingBasket, Target,
  Users, type LucideIcon,
} from "lucide-react";

export type EntrySource = "event" | "visit" | "plan" | "election" | "sms";
export interface Entry {
  id: string; source: EntrySource; kind: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean;
  status: string | null; ward_id: string | null; ward: string | null; constituency_id: string | null; constituency: string | null;
  location: string | null; notes: string | null; hq_only: boolean; series_id: string | null; lead: string | null;
  expected_attendance: number | null; attendance: number | null; target: number | null; can_edit: boolean;
}

/**
 * Colour says which family an entry belongs to (six, well apart); the icon says what exactly
 * it is, and the title is always written out, so colour is never the only cue.
 */
export const FAMILY = {
  // Validated (colour-blind separation, contrast) in this order; keep it.
  field: { label: "Field events", color: "#1a8a52", soft: "#e8f4ed" },
  meeting: { label: "Meetings & debates", color: "#4a5fc1", soft: "#eceffa" },
  money: { label: "Fundraising", color: "#b07d00", soft: "#fbf3de" },
  media: { label: "Media", color: "#0b7fa6", soft: "#e4f3f8" },
  deadline: { label: "Deadlines", color: "#d22f3c", soft: "#fce9eb" },
  blast: { label: "SMS & WhatsApp", color: "#8e5bd0", soft: "#f3edfb" },
  other: { label: "Other", color: "#64748b", soft: "#f1f5f9" },
} as const;
export type Family = keyof typeof FAMILY;

export const KINDS: Record<string, { label: string; icon: LucideIcon; family: Family; field?: boolean }> = {
  visit: { label: "Visit", icon: Route, family: "field", field: true },
  rally: { label: "Rally", icon: Megaphone, family: "field", field: true },
  town_hall: { label: "Town hall", icon: Presentation, family: "field", field: true },
  market_walk: { label: "Market walk", icon: ShoppingBasket, family: "field", field: true },
  door_to_door: { label: "Door to door", icon: Footprints, family: "field", field: true },
  community_meeting: { label: "Community meeting", icon: Users, family: "field", field: true },
  media: { label: "Media", icon: Mic, family: "media" },
  meeting: { label: "Meeting", icon: Briefcase, family: "meeting" },
  debate: { label: "Debate", icon: Presentation, family: "meeting" },
  fundraiser: { label: "Fundraiser", icon: HandCoins, family: "money" },
  deadline: { label: "Deadline", icon: CalendarClock, family: "deadline" },
  travel: { label: "Travel", icon: Plane, family: "other" },
  other: { label: "Other", icon: CalendarClock, family: "other" },
  sms: { label: "SMS blast", icon: MessageSquareText, family: "blast" },
  whatsapp: { label: "WhatsApp blast", icon: MessageSquareText, family: "blast" },
  target: { label: "Weekly target", icon: Target, family: "other" },
  election: { label: "Election day", icon: Flag, family: "deadline" },
};

export const kindOf = (k: string) => KINDS[k] ?? KINDS.other;
export const FIELD_KINDS = Object.entries(KINDS).filter(([, v]) => v.field).map(([k]) => k);
export const HQ_KINDS = ["media", "meeting", "debate", "fundraiser", "deadline", "travel", "other"];
