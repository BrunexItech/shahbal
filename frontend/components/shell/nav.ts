import {
  BarChart3,
  ClipboardCheck,
  History,
  LayoutDashboard,
  MapPin,
  Target,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { can } from "@/lib/roles";
import type { Role } from "@/lib/types";

export type NavItem = { href: string; label: string; icon: LucideIcon; show: (r: Role) => boolean; section: string };

/** Adding a module to the UI = one entry here (and its route folder). */
export const NAV: NavItem[] = [
  { section: "Command", href: "/dashboard", label: "War Room", icon: LayoutDashboard, show: () => true },
  { section: "Command", href: "/targets", label: "Ward Targets", icon: Target, show: () => true },
  { section: "Voters", href: "/voters/new", label: "Capture Voter", icon: UserPlus, show: can.capture },
  { section: "Voters", href: "/voters", label: "Voter Registry", icon: UsersRound, show: () => true },
  { section: "Voters", href: "/verification", label: "Verification Queue", icon: ClipboardCheck, show: can.verify },
  { section: "Setup", href: "/stations", label: "Polling Stations", icon: MapPin, show: () => true },
  { section: "Setup", href: "/users", label: "Team & Roles", icon: Users, show: can.manageUsers },
  { section: "Setup", href: "/audit", label: "Audit Trail", icon: History, show: can.audit },
];

export const MOBILE_NAV = ["/dashboard", "/voters/new", "/voters", "/verification", "/targets"];

export const REPORT_ICON = BarChart3;
