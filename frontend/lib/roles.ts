import type { Role } from "@/lib/types";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "HQ Administrator",
  coordinator: "Constituency Coordinator",
  ward_coordinator: "Ward Coordinator",
  field_agent: "Field Agent",
  call_agent: "Call Centre Agent",
  viewer: "Observer",
};

const MANAGERS: Role[] = ["super_admin", "coordinator", "ward_coordinator"];

/** Single source of truth for what each role can do in the UI (the API enforces the same rules). */
export const can = {
  /** Campaign-wide overviews (Command Centre, plan, targets, analytics). Agents get their own workspace. */
  oversee: (r: Role) => [...MANAGERS, "viewer"].includes(r),
  capture: (r: Role) => r !== "viewer",
  verify: (r: Role) => [...MANAGERS, "call_agent"].includes(r),
  edit: (r: Role) => ["super_admin", "coordinator", "ward_coordinator", "call_agent"].includes(r),
  setTargets: (r: Role) => r === "super_admin" || r === "coordinator",
  manageStations: (r: Role) => MANAGERS.includes(r),
  manageUsers: (r: Role) => MANAGERS.includes(r),
  importStations: (r: Role) => r === "super_admin",
  audit: (r: Role) => r === "super_admin",
  revealId: (r: Role) => r === "super_admin",
  message: (r: Role) => MANAGERS.includes(r),
  approveMessages: (r: Role) => r === "super_admin",
  planVisits: (r: Role) => MANAGERS.includes(r),
  runVisits: (r: Role) => [...MANAGERS, "field_agent"].includes(r),
  callCentre: (r: Role) => [...MANAGERS, "call_agent"].includes(r),
  markVoted: (r: Role) => r !== "viewer",
  electionAdmin: (r: Role) => r === "super_admin",
  gisLab: (r: Role) => r === "super_admin",
  exportData: (r: Role) => r === "super_admin",
};

export const GRANTABLE: Record<Role, Role[]> = {
  super_admin: ["super_admin", "coordinator", "ward_coordinator", "field_agent", "call_agent", "viewer"],
  coordinator: ["ward_coordinator", "field_agent"],
  ward_coordinator: ["field_agent"],
  field_agent: [],
  call_agent: [],
  viewer: [],
};

/** Where each role lands after signing in. */
export const homeFor = (r: Role) => (r === "field_agent" ? "/home" : r === "call_agent" ? "/calls" : "/dashboard");
