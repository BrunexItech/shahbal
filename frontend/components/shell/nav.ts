import {
  BarChart3,
  Bot,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Contact,
  Flag,
  Globe2,
  HandHeart,
  History,
  House,
  LayoutDashboard,
  MapPin,
  Newspaper,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Route,
  ShieldCheck,
  Target,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { can } from "@/lib/roles";
import type { Role } from "@/lib/types";

export type NavItem = { href: string; label: string; short?: string; icon: LucideIcon; show: (r: Role) => boolean; section: string };

/** Adding a module to the UI = one entry here (and its route folder). */
export const NAV: NavItem[] = [
  { section: "Command", href: "/dashboard", label: "Command Centre", short: "Home", icon: LayoutDashboard, show: can.oversee },
  { section: "My work", href: "/home", label: "My Area", short: "Home", icon: House, show: (r) => r === "field_agent" },
  { section: "Command", href: "/analytics", label: "Analytics", icon: BarChart3, show: (r) => can.manageUsers(r) || r === "viewer" },
  { section: "Command", href: "/assistant", label: "Ask the campaign", short: "Ask", icon: Bot, show: can.oversee },
  { section: "Command", href: "/calendar", label: "Campaign Calendar", short: "Calendar", icon: CalendarDays, show: can.oversee },
  { section: "Command", href: "/plan", label: "Campaign Plan", short: "Plan", icon: CalendarRange, show: can.oversee },
  { section: "Command", href: "/targets", label: "Targets & Captures", short: "Targets", icon: Target, show: can.oversee },
  { section: "Voters", href: "/voters/new", label: "Capture Voter", short: "Capture", icon: UserPlus, show: can.capture },
  { section: "Voters", href: "/voters", label: "Voter Registry", icon: UsersRound, show: can.staff },
  { section: "Voters", href: "/verification", label: "Verification Queue", icon: ClipboardCheck, show: can.verify },
  { section: "Outreach", href: "/issues", label: "Community Voice", short: "Voice", icon: Megaphone, show: can.staff },
  { section: "Outreach", href: "/audiences", label: "Audiences", icon: Contact, show: can.message },
  { section: "Outreach", href: "/messaging", label: "Messaging", icon: MessageSquareText, show: can.message },
  { section: "Outreach", href: "/daily-plans", label: "Daily Plans", short: "Plans", icon: ClipboardList, show: can.oversee },
  { section: "Outreach", href: "/visits", label: "Campaign Visits", short: "Visits", icon: Route, show: can.staff },
  { section: "Outreach", href: "/volunteers", label: "Volunteers", icon: HandHeart, show: can.manageUsers },
  { section: "Outreach", href: "/calls", label: "Call Centre", icon: PhoneCall, show: can.callCentre },
  { section: "Election", href: "/election", label: "Election Day", short: "Election", icon: Flag, show: can.staff },
  { section: "Command", href: "/gis-lab", label: "GIS Lab", icon: Globe2, show: can.gisLab },
  { section: "Setup", href: "/stations", label: "Polling Stations", icon: MapPin, show: can.oversee },
  { section: "Setup", href: "/users", label: "Team", icon: Users, show: can.manageUsers },
  { section: "Setup", href: "/website", label: "Public Website", short: "Website", icon: Newspaper, show: can.publish },
  { section: "Setup", href: "/data-requests", label: "Data Requests", short: "Data", icon: ShieldCheck, show: can.audit },
  { section: "Setup", href: "/audit", label: "Audit Trail", icon: History, show: can.audit },
  { section: "Setup", href: "/account", label: "My Account", icon: UserCog, show: () => true },
];

// Phone bottom bar: the first five a role may use, in this order.
export const MOBILE_NAV = ["/home", "/dashboard", "/targets", "/voters/new", "/visits", "/election", "/calls"];
