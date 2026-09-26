import {
  Briefcase, Bus, Construction, Droplets, GraduationCap, HeartPulse, House, type LucideIcon, MessageCircle, ShieldAlert, Trash2, Trees, Waves, Zap,
} from "lucide-react";

export type IssueCategory = "water" | "roads" | "health" | "education" | "jobs" | "waste" | "security" | "drainage" | "housing"
  | "transport" | "electricity" | "environment" | "other";
export type IssueStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "closed";
export type IssuePriority = "normal" | "high" | "urgent";
export type IssueSource = "public" | "field" | "call_centre";

export const CATEGORIES: { id: IssueCategory; icon: LucideIcon; en: string; sw: string }[] = [
  { id: "water", icon: Droplets, en: "Water", sw: "Maji" },
  { id: "roads", icon: Construction, en: "Roads", sw: "Barabara" },
  { id: "health", icon: HeartPulse, en: "Health", sw: "Afya" },
  { id: "education", icon: GraduationCap, en: "Education", sw: "Elimu" },
  { id: "jobs", icon: Briefcase, en: "Jobs & youth", sw: "Ajira na vijana" },
  { id: "waste", icon: Trash2, en: "Waste", sw: "Taka" },
  { id: "security", icon: ShieldAlert, en: "Security", sw: "Usalama" },
  { id: "drainage", icon: Waves, en: "Drainage & floods", sw: "Mitaro na mafuriko" },
  { id: "housing", icon: House, en: "Housing & land", sw: "Makazi na ardhi" },
  { id: "transport", icon: Bus, en: "Transport", sw: "Usafiri" },
  { id: "electricity", icon: Zap, en: "Electricity", sw: "Umeme" },
  { id: "environment", icon: Trees, en: "Environment", sw: "Mazingira" },
  { id: "other", icon: MessageCircle, en: "Something else", sw: "Jambo lingine" },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<IssueCategory, (typeof CATEGORIES)[number]>;

/** Status colours carry meaning (new = needs someone, resolved = done); always shown with a label. */
export const STATUS: Record<IssueStatus, { en: string; sw: string; color: string; tone: "red" | "amber" | "blue" | "green" | "slate" }> = {
  new: { en: "New", sw: "Mpya", color: "#c8102e", tone: "red" },
  acknowledged: { en: "Acknowledged", sw: "Imepokelewa", color: "#e8700f", tone: "amber" },
  in_progress: { en: "In progress", sw: "Inashughulikiwa", color: "#0b7fa6", tone: "blue" },
  resolved: { en: "Resolved", sw: "Imetatuliwa", color: "#006b3f", tone: "green" },
  closed: { en: "Closed", sw: "Imefungwa", color: "#64748b", tone: "slate" },
};
export const STATUS_FLOW: IssueStatus[] = ["new", "acknowledged", "in_progress", "resolved"];

export const PRIORITY: Record<IssuePriority, { label: string; tone: "slate" | "gold" | "red" }> = {
  normal: { label: "Normal", tone: "slate" },
  high: { label: "High", tone: "gold" },
  urgent: { label: "Urgent", tone: "red" },
};

export const SOURCE: Record<IssueSource, string> = { public: "Website", field: "Field team", call_centre: "Call centre" };
