/**
 * NATS Message Type Definitions
 * 
 * Based on: docs/nats-subjects.md (VM-001)
 * Mission: VM-014 (Telegram Gateway dependency)
 * 
 * These types will be used by:
 * - VM-002: NATS TypeScript client module
 * - VM-014: Telegram gateway (this mission)
 * - VM-012: Director LLM integration
 * - All future VALOR agents and services
 */

/**
 * Base message envelope for all VALOR NATS messages
 */
export interface VALORMessage<T = unknown> {
  id: string; // UUID v4
  timestamp: string; // ISO 8601 UTC
  source: string; // Operative callsign or "director" or gateway identifier
  type: VALORMessageType;
  payload: T;
}

/**
 * Discriminated union of all VALOR message types
 */
export type VALORMessageType =
  | "mission.inbound"
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

// ============================================================================
// Mission Messages
// ============================================================================

/**
 * Raw mission text from Principal via gateway (Telegram, CLI, etc.)
 * Published to: valor.missions.inbound
 * Direction: Gateway → Director
 */
export interface RawMissionInbound {
  text: string;
  source_channel: "telegram" | "cli" | "dashboard" | "api";
  principal_id: string;
  context: {
    chat_id?: string;
    message_id?: string;
    replied_to?: string;
    [key: string]: unknown;
  } | null;
}

/**
 * Classified mission brief from Director
 * Published to: valor.missions.{operative}.pending
 * Direction: Director → Operative
 */
export interface MissionBrief {
  mission_id: string;
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  assigned_to: string;
  depends_on: string[];
  parent_mission: string | null;
  model_tier: "fast" | "standard" | "reasoning";
  acceptance_criteria: string[];
  context_refs: string[];
  deadline: string | null;
  created_at: string;
}

/**
 * Mission pickup acknowledgment
 * Published to: valor.missions.{operative}.active
 * Direction: Operative → All
 */
export interface MissionPickup {
  mission_id: string;
  operative: string;
  acknowledged_at: string;
  estimated_completion: string | null;
  notes: string | null;
}

/**
 * Mission completion
 * Published to: valor.missions.{operative}.complete
 * Direction: Operative → All
 */
export interface MissionComplete {
  mission_id: string;
  operative: string;
  completed_at: string;
  artifacts: string[];
  summary: string;
  next_steps: string[] | null;
}

/**
 * Mission failure
 * Published to: valor.missions.{operative}.failed
 * Direction: Operative → All
 */
export interface MissionFailed {
  mission_id: string;
  operative: string;
  failed_at: string;
  reason: string;
  blockers: string[];
  can_retry: boolean;
}

// ============================================================================
// Sitrep Messages
// ============================================================================

/**
 * Situation report (progress update)
 * Published to: valor.sitreps.{mission_id}
 * Direction: Operative → All
 */
export interface Sitrep {
  mission_id: string;
  status: "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE" | "FAILED";
  progress_pct: number | null;
  summary: string;
  artifacts: string[] | null;
  blockers: string[] | null;
  next_steps: string[] | null;
}

// ============================================================================
// Review Messages
// ============================================================================

/**
 * Review submission
 * Published to: valor.review.pending
 * Direction: Operative → Analyst
 */
export interface ReviewSubmission {
  mission_id: string;
  operative: string;
  completed_at: string;
  artifacts: string[];
  acceptance_criteria_met: boolean[];
  notes: string | null;
}

/**
 * Review verdict
 * Published to: valor.review.verdict.{mission_id}
 * Direction: Analyst → All
 */
export interface ReviewVerdict {
  mission_id: string;
  decision: "APPROVE" | "RETRY" | "ESCALATE";
  reasoning: string;
  issues: string[] | null;
  instructions: string | null;
}

// ============================================================================
// Comms Messages
// ============================================================================

/**
 * Communication message (group or direct)
 * Published to: valor.comms.{channel} or valor.comms.direct.{from}.{to}
 * Direction: Any → Any
 */
export interface CommsMessage {
  from: string;
  to: string | "all"; // "all" for group channels, operative name for direct
  text: string;
  priority: "low" | "normal" | "high" | "urgent";
  category: "chat" | "query" | "alert" | "status";
  reply_to?: string; // Message ID being replied to
  attachments?: string[]; // File paths or URLs
}

// ============================================================================
// System Messages
// ============================================================================

/**
 * Heartbeat
 * Published to: valor.system.heartbeat.{operative}
 * Direction: Operative → All
 */
export interface Heartbeat {
  operative: string;
  status: "IDLE" | "BUSY" | "ERROR";
  current_mission: string | null;
  tick_interval_ms: number;
  uptime_seconds: number;
  last_activity: string; // ISO 8601
}

/**
 * System status request
 * Published to: valor.system.status
 * Direction: Any → Director/System
 */
export interface SystemStatusRequest {
  requestId: string;
  requested_by: string;
}

/**
 * System status response
 * Published to: valor.system.status (reply)
 * Direction: Director/System → Requester
 */
export interface SystemStatusResponse {
  requestId: string;
  timestamp: string;
  operatives: Record<
    string,
    {
      status: "online" | "offline" | "error";
      current_mission: string | null;
      last_heartbeat: string | null;
    }
  >;
  system_health: {
    nats_connected: boolean;
    director_online: boolean;
    active_missions: number;
    pending_reviews: number;
  };
}

/**
 * System event
 * Published to: valor.system.events
 * Direction: System → All
 */
export interface SystemEvent {
  event_type:
    | "agent.online"
    | "agent.offline"
    | "agent.error"
    | "system.startup"
    | "system.shutdown"
    | "mission.dispatched"
    | "mission.completed";
  timestamp: string;
  details: {
    agent?: string;
    mission_id?: string;
    error?: string;
    [key: string]: unknown;
  };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isRawMissionInbound(
  msg: VALORMessage
): msg is VALORMessage<RawMissionInbound> {
  return msg.type === "mission.inbound";
}

export function isMissionBrief(msg: VALORMessage): msg is VALORMessage<MissionBrief> {
  return msg.type === "mission.brief";
}

export function isSitrep(msg: VALORMessage): msg is VALORMessage<Sitrep> {
  return msg.type === "sitrep";
}

export function isCommsMessage(msg: VALORMessage): msg is VALORMessage<CommsMessage> {
  return msg.type === "comms.message";
}

export function isSystemEvent(msg: VALORMessage): msg is VALORMessage<SystemEvent> {
  return msg.type === "system.event";
}

export function isSystemStatusResponse(
  msg: VALORMessage
): msg is VALORMessage<SystemStatusResponse> {
  return msg.type === "system.status.response";
}
