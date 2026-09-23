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
  capture: (r: Role) => r !== "viewer",
  verify: (r: Role) => [...MANAGERS, "call_agent"].includes(r),
  edit: (r: Role) => ["super_admin", "coordinator", "ward_coordinator", "call_agent"].includes(r),
  setTargets: (r: Role) => r === "super_admin" || r === "coordinator",
  manageStations: (r: Role) => MANAGERS.includes(r),
  manageUsers: (r: Role) => MANAGERS.includes(r),
  importStations: (r: Role) => r === "super_admin",
  audit: (r: Role) => r === "super_admin",
  revealId: (r: Role) => r === "super_admin",
};

export const GRANTABLE: Record<Role, Role[]> = {
  super_admin: ["super_admin", "coordinator", "ward_coordinator", "field_agent", "call_agent", "viewer"],
  coordinator: ["ward_coordinator", "field_agent"],
  ward_coordinator: ["field_agent"],
  field_agent: [],
  call_agent: [],
  viewer: [],
};
