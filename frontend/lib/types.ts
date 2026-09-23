export type Role = "super_admin" | "coordinator" | "ward_coordinator" | "field_agent" | "call_agent" | "viewer";
export type VoterStatus = "pending" | "verified" | "rejected";
export type Support = "supporter" | "leaning" | "undecided" | "opposed" | "unknown";
export type Source = "field" | "portal" | "call_centre" | "import";
export type Gender = "female" | "male" | "other";

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  constituency_id: string | null;
  ward_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Ward {
  id: string;
  code: string;
  name: string;
  constituency_id: string;
  registered_voters: number | null;
  target: number;
}

export interface Constituency {
  id: string;
  code: string;
  name: string;
  county: string;
  wards: Ward[];
}

export interface Station {
  id: string;
  code: string;
  name: string;
  ward_id: string;
  streams: number;
  registered_voters: number | null;
  target: number;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
}

export interface Voter {
  id: string;
  reference: string;
  full_name: string;
  phone: string;
  national_id_masked: string;
  voter_card_no: string | null;
  gender: Gender | null;
  birth_year: number | null;
  ward_id: string;
  ward_name: string | null;
  constituency_name: string | null;
  station_id: string | null;
  station_name: string | null;
  support: Support;
  source: Source;
  status: VoterStatus;
  rejection_reason: string | null;
  opted_out: boolean;
  notes: string | null;
  captured_by_name: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  consent_at: string;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface Progress {
  target: number;
  achieved: number;
  gap: number;
  percent: number | null;
}

export interface WardProgress extends Progress {
  id: string;
  name: string;
  constituency_id: string;
  constituency: string;
  registered_voters: number | null;
  verified: number;
  pending: number;
}

export interface DashboardSummary {
  totals: { total: number; achieved: number; verified: number; pending: number; rejected: number; today: number; opted_out: number };
  overall: Progress;
  constituencies: (Progress & { id: string; name: string; verified: number })[];
  wards: WardProgress[];
  by_support: Partial<Record<Support, number>>;
  by_source: Partial<Record<Source, number>>;
  daily: { date: string; count: number }[];
  top_agents: { id: string; name: string; count: number }[];
  recent: { id: string; reference: string; full_name: string; ward: string; status: VoterStatus; source: Source; created_at: string }[];
}

export interface AuditEntry {
  id: string;
  created_at: string;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
}
