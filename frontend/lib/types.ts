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
  totp_enabled?: boolean;
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
  do_not_call: boolean;
  last_contacted_at: string | null;
  voted_at: string | null;
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

export type Health = "on_track" | "at_risk" | "critical" | "unknown";

export interface InsightCard {
  tone: "good" | "warn" | "bad" | "info";
  title: string;
  detail: string;
}

export interface Insights {
  today: number;
  yesterday_same_time: number;
  last7: number;
  prev7: number;
  pace: number;
  days_left: number | null;
  projected: number | null;
  required_pace: number | null;
  hourly: number[];
  backlog_days: number | null;
  constituencies: (Progress & { id: string; name: string; verified: number; pace: number; today: number; projected: number | null; projected_percent: number | null; status: Health })[];
  cards: InsightCard[];
}

export interface DashboardSummary {
  insights: Insights;
  ops: {
    messages_today: number;
    delivered_today: number;
    calls_today: number;
    answered_today: number;
    visits_today: number;
    visits_upcoming: number;
    wards_visited: number;
    approvals_pending: number;
    voted: number;
  };
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

export type Channel = "sms" | "whatsapp";
export type CampaignStatus = "pending_approval" | "scheduled" | "sending" | "sent" | "cancelled" | "rejected";

export interface Audience {
  constituency_ids: string[];
  ward_ids: string[];
  station_ids: string[];
  support: Support[];
  statuses: VoterStatus[];
  sources: Source[];
  voted: boolean | null;
}

export interface Campaign {
  id: string;
  name: string;
  channel: Channel;
  kind: "broadcast" | "visit" | "gotv";
  body: string;
  audience: Partial<Audience>;
  status: CampaignStatus;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by_name: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  visit_id: string | null;
  recipients: number;
  sent: number;
  delivered: number;
  failed: number;
  created_at: string;
}

export interface CampaignMessage {
  id: string;
  phone: string;
  voter_id: string;
  voter_name: string | null;
  status: "queued" | "sent" | "delivered" | "failed";
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
}

export interface Preview {
  recipients: number;
  sample: string | null;
  chars: number;
  segments: number;
  unknown_placeholders: string[];
}

export type VisitStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export interface Visit {
  id: string;
  title: string;
  ward_id: string;
  ward_name: string | null;
  constituency_name: string | null;
  station_id: string | null;
  station_name: string | null;
  venue: string;
  scheduled_at: string;
  status: VisitStatus;
  lead_id: string | null;
  lead_name: string | null;
  notes: string | null;
  announce: boolean;
  announce_hours_before: number;
  announcement_campaign_id: string | null;
  announcement_status: CampaignStatus | null;
  announcement_recipients: number | null;
  checkin_at: string | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  completed_at: string | null;
  attendance: number | null;
  outcome: string | null;
  created_at: string;
}

export type CallQueue = "verify" | "persuade" | "gotv" | "follow_up";
export type CallOutcome = "answered" | "no_answer" | "busy" | "call_back" | "wrong_number" | "do_not_call";

export interface CallLog {
  id: string;
  voter_id: string;
  agent_name: string | null;
  queue: CallQueue;
  outcome: CallOutcome;
  support_after: Support | null;
  notes: string | null;
  issue: string | null;
  duration_seconds: number | null;
  follow_up_at: string | null;
  created_at: string;
  recording_id?: string | null;
}

export interface Claim {
  voter: Voter;
  history: CallLog[];
  locked_until: string;
  remaining: number;
}

export type QueueCounts = Record<CallQueue, number>;

export interface AgentStat {
  agent_id: string;
  agent_name: string;
  calls: number;
  answered: number;
  verified: number;
}

export interface ElectionSettings {
  election_date: string | null;
  polls_open: string;
  polls_close: string;
  candidate_label: string;
  days_to_go: number | null;
  is_election_day: boolean;
}

export interface TurnoutRow {
  id: string;
  name: string;
  parent: string | null;
  targets: number;
  voted: number;
  percent: number | null;
}

export interface Turnout {
  overall: TurnoutRow;
  wards: TurnoutRow[];
  stations: TurnoutRow[];
  last_hour: number;
}

export interface RosterRow {
  id: string;
  reference: string;
  full_name: string;
  phone: string;
  support: Support;
  voted_at: string | null;
}

export interface MapWard {
  id: string;
  code: string;
  name: string;
  constituency: string;
  target: number;
  registered_voters: number | null;
  achieved: number;
  verified: number;
  supporters: number;
  percent: number | null;
  gap: number;
  visits_completed: number;
  visits_upcoming: number;
  last_visit_at: string | null;
}

export interface MapOverview {
  wards: MapWard[];
  stations: { id: string; name: string; code: string; ward_id: string; lat: number; lng: number; registered_voters: number | null; captured: number }[];
  visits: { id: string; title: string; venue: string; status: VisitStatus; scheduled_at: string; ward_id: string; lat: number | null; lng: number | null }[];
}

export interface Activity {
  id: string;
  at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  actor: string;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  current: boolean;
}
