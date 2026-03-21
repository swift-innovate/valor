/**
 * VALOR NATS Module — Barrel Export
 */

// Connection management
export {
  getNatsConnection,
  currentConnection,
  healthCheck,
  closeNatsConnection,
} from "./client.js";
export type { NatsClientOptions } from "./client.js";

// Message types
export type {
  OperativeCallsign,
  MissionState,
  VALORMessageType,
  VALORMessage,
  MissionPriority,
  ModelTier,
  MissionBrief,
  MissionBriefMessage,
  MissionPickup,
  MissionPickupMessage,
  NatsSitrepStatus,
  SitrepArtifact,
  NatsSitrep,
  SitrepMessage,
  ReviewSubmission,
  ReviewSubmissionMessage,
  VerdictDecision,
  ReviewVerdict,
  ReviewVerdictMessage,
  HeartbeatStatus,
  Heartbeat,
  HeartbeatMessage,
  CommsPriority,
  CommsCategory,
  CommsPayload,
  CommsMessageEnvelope,
  SystemStatusRequest,
  SystemStatusResponse,
  OperativeStatus,
  SystemEventKind,
  SystemEvent,
  SystemEventMessage,
} from "./types.js";
export { STREAM_NAMES, STREAM_SUBJECTS } from "./types.js";

// Stream & consumer provisioning
export {
  ensureStreams,
  ensureMissionConsumer,
  ensureSitrepConsumer,
  ensureReviewConsumer,
} from "./streams.js";

// Typed publishers
export {
  publishMissionBrief,
  publishMissionPickup,
  publishSitrep,
  publishMissionComplete,
  publishMissionFailed,
  publishReviewSubmission,
  publishReviewVerdict,
  publishSystemEvent,
  publishHeartbeat,
  publishCommsChannel,
  publishCommsDirect,
  requestSystemStatus,
} from "./publishers.js";

// Consumers
export {
  consumeMissions,
  consumeSitreps,
  consumeReviewVerdicts,
  subscribeHeartbeats,
  subscribeComms,
  subscribeDirectComms,
  serveSystemStatus,
} from "./consumers.js";
export type { MessageHandler, EphemeralHandler } from "./consumers.js";
