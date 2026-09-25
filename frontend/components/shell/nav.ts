import {
  BarChart3,
  ClipboardCheck,
  Contact,
  Flag,
  Globe2,
  History,
  LayoutDashboard,
  MapPin,
  MessageSquareText,
  PhoneCall,
  Route,
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
  { section: "Command", href: "/dashboard", label: "Command Centre", short: "Home", icon: LayoutDashboard, show: () => true },
  { section: "Command", href: "/analytics", label: "Analytics", icon: BarChart3, show: (r) => can.manageUsers(r) || r === "viewer" },
  { section: "Command", href: "/targets", label: "Targets & Captures", short: "Targets", icon: Target, show: () => true },
  { section: "Voters", href: "/voters/new", label: "Capture Voter", short: "Capture", icon: UserPlus, show: can.capture },
  { section: "Voters", href: "/voters", label: "Voter Registry", icon: UsersRound, show: () => true },
  { section: "Voters", href: "/verification", label: "Verification Queue", icon: ClipboardCheck, show: can.verify },
  { section: "Outreach", href: "/audiences", label: "Audiences", icon: Contact, show: can.message },
  { section: "Outreach", href: "/messaging", label: "Messaging", icon: MessageSquareText, show: can.message },
  { section: "Outreach", href: "/visits", label: "Campaign Visits", short: "Visits", icon: Route, show: () => true },
  { section: "Outreach", href: "/calls", label: "Call Centre", icon: PhoneCall, show: can.callCentre },
  { section: "Election", href: "/election", label: "Election Day", short: "Election", icon: Flag, show: () => true },
  { section: "Command", href: "/gis-lab", label: "GIS Lab", icon: Globe2, show: can.gisLab },
  { section: "Setup", href: "/stations", label: "Polling Stations", icon: MapPin, show: () => true },
  { section: "Setup", href: "/users", label: "Team", icon: Users, show: can.manageUsers },
  { section: "Setup", href: "/audit", label: "Audit Trail", icon: History, show: can.audit },
  { section: "Setup", href: "/account", label: "My Account", icon: UserCog, show: () => true },
];

export const MOBILE_NAV = ["/dashboard", "/targets", "/voters/new", "/visits", "/election"];
