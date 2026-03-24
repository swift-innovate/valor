/**
 * VALOR NATS Message Types
 *
 * Aligned with docs/nats-subjects.md (VM-001).
 * model_tier uses VALOR's tier naming: local | efficient | balanced | frontier
 * (Eddie's schema used fast | standard | reasoning — remapped here).
 */

// ---------------------------------------------------------------------------
// Operatives & Subjects
// ---------------------------------------------------------------------------

export type OperativeCallsign =
  | "mira"
  | "eddie"
  | "forge"
  | "gage"
  | "zeke"
  | "rook"
  | "herbie"
  | "paladin";

export type MissionState = "pending" | "active" | "complete" | "failed";

// ---------------------------------------------------------------------------
// Base Envelope
// ---------------------------------------------------------------------------

export type VALORMessageType =
  | "mission.brief"
  | "mission.pickup"
  | "mission.complete"
  | "mission.failed"
  | "sitrep"
  | "review.submission"
  | "review.verdict"
  | "comms.message"
  | "heartbeat"
  | "system.status.request"
  | "system.status.response"
  | "system.event";

export interface VALORMessage<T = unknown> {
  id: string;
  timestamp: string;
  source: string;
  type: VALORMessageType;
  payload: T;
}

// ---------------------------------------------------------------------------
// Mission Brief
// ---------------------------------------------------------------------------

export type MissionPriority = "P0" | "P1" | "P2" | "P3";
export type ModelTier = "local" | "efficient" | "balanced" | "frontier";

export interface MissionBrief {
  mission_id: string;
  title: string;
  description: string;
  priority: MissionPriority;
  assigned_to: string;
  depends_on: string[];
  parent_mission: string | null;
  model_tier: ModelTier;
  acceptance_criteria: string[];
  context_refs: string[];
  deadline: string | null;
  created_at: string;
}

export type MissionBriefMessage = VALORMessage<MissionBrief> & {
  type: "mission.brief";
};

// ---------------------------------------------------------------------------
// Mission Pickup
// ---------------------------------------------------------------------------

export interface MissionPickup {
  mission_id: string;
  operative: string;
  acknowledged_at: string;
  estimated_completion: string | null;
  notes: string | null;
}

export type MissionPickupMessage = VALORMessage<MissionPickup> & {
  type: "mission.pickup";
};

// ---------------------------------------------------------------------------
// Sitrep
// ---------------------------------------------------------------------------

export type NatsSitrepStatus =
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "COMPLETE"
  | "FAILED";

export interface SitrepArtifact {
  type: "file" | "url" | "branch" | "pr" | "note";
  label: string;
  ref: string;
}

export interface NatsSitrep {
  mission_id: string;
  operative: string;
  status: NatsSitrepStatus;
  progress_pct: number;
  summary: string;
  artifacts: SitrepArtifact[];
  blockers: string[];
  next_steps: string[];
  tokens_used: number | null;
  timestamp: string;
  /** Parent mission ID — propagated so dashboard can rebuild parent→child linkage */
  parent_mission?: string | null;
}

export type SitrepMessage = VALORMessage<NatsSitrep> & { type: "sitrep" };

// ---------------------------------------------------------------------------
// Review Submission
// ---------------------------------------------------------------------------

export interface ReviewSubmission {
  mission_id: string;
  operative: string;
  completed_at: string;
  summary: string;
  artifacts: SitrepArtifact[];
  self_assessment: string | null;
}

export type ReviewSubmissionMessage = VALORMessage<ReviewSubmission> & {
  type: "review.submission";
};

// ---------------------------------------------------------------------------
// Review Verdict
// ---------------------------------------------------------------------------

export type VerdictDecision = "APPROVE" | "RETRY" | "ESCALATE";

export interface ReviewVerdict {
  mission_id: string;
  reviewer: string;
  decision: VerdictDecision;
  reasoning: string;
  issues: string[];
  instructions: string | null;
  escalation_target: string | null;
  reviewed_at: string;
}

export type ReviewVerdictMessage = VALORMessage<ReviewVerdict> & {
  type: "review.verdict";
};

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export type HeartbeatStatus = "IDLE" | "BUSY" | "ERROR" | "OFFLINE";

export interface Heartbeat {
  operative: string;
  status: HeartbeatStatus;
  current_mission: string | null;
  tick_interval_ms: number;
  uptime_ms: number;
  last_activity: string;
  metadata: Record<string, unknown> | null;
}

export type HeartbeatMessage = VALORMessage<Heartbeat> & {
  type: "heartbeat";
};

// ---------------------------------------------------------------------------
// Comms
// ---------------------------------------------------------------------------

export type CommsPriority = "routine" | "priority" | "flash";
export type CommsCategory =
  | "task_handoff"
  | "status_update"
  | "request"
  | "response"
  | "escalation"
  | "advisory"
  | "coordination";

export interface CommsPayload {
  subject: string;
  body: string;
  to: string | null;
  channel: string | null;
  priority: CommsPriority;
  category: CommsCategory;
  thread_id: string | null;
  in_reply_to: string | null;
}

export type CommsMessageEnvelope = VALORMessage<CommsPayload> & {
  type: "comms.message";
};

// ---------------------------------------------------------------------------
// System Status (Request / Reply)
// ---------------------------------------------------------------------------

export interface SystemStatusRequest {
  requested_by: string;
  include_missions: boolean;
}

export interface OperativeStatus {
  operative: string;
  heartbeat_status: HeartbeatStatus;
  last_heartbeat: string | null;
  current_mission: string | null;
}

export interface SystemStatusResponse {
  requested_by: string;
  fleet: OperativeStatus[];
  active_missions: number;
  queued_missions: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// System Event
// ---------------------------------------------------------------------------

export type SystemEventKind =
  | "agent.online"
  | "agent.offline"
  | "stream.created"
  | "stream.error";

export interface SystemEvent {
  kind: SystemEventKind;
  operative: string | null;
  detail: string;
}

export type SystemEventMessage = VALORMessage<SystemEvent> & {
  type: "system.event";
};

// ---------------------------------------------------------------------------
// Stream & Consumer Configuration Constants
// ---------------------------------------------------------------------------

export const STREAM_NAMES = {
  MISSIONS: "MISSIONS",
  SITREPS: "SITREPS",
  REVIEW: "REVIEW",
  SYSTEM_EVENTS: "SYSTEM_EVENTS",
} as const;

export const STREAM_SUBJECTS = {
  MISSIONS: "valor.missions.*.*",
  SITREPS: "valor.sitreps.*",
  REVIEW: "valor.review.>",
  SYSTEM_EVENTS: "valor.system.events",
} as const;
