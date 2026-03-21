/**
 * VALOR NATS Typed Publishers
 *
 * One publish helper per message type. Each wraps payload in the VALORMessage
 * envelope and publishes to the correct subject.
 */

import { jetstream } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../utils/logger.js";
import type {
  MissionBrief,
  MissionPickup,
  NatsSitrep,
  ReviewSubmission,
  ReviewVerdict,
  Heartbeat,
  CommsPayload,
  SystemStatusRequest,
  SystemStatusResponse,
  SystemEvent,
  VALORMessage,
  VALORMessageType,
  OperativeCallsign,
} from "./types.js";

// ---------------------------------------------------------------------------
// Envelope factory
// ---------------------------------------------------------------------------

let _idCounter = 0;

function makeId(): string {
  // crypto.randomUUID() is available in Node 19+. Fallback to timestamp + counter.
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${++_idCounter}`;
}

function envelope<T>(
  source: string,
  type: VALORMessageType,
  payload: T,
): VALORMessage<T> {
  return {
    id: makeId(),
    timestamp: new Date().toISOString(),
    source,
    type,
    payload,
  };
}

function encode(msg: VALORMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// JetStream publishers (durable subjects)
// ---------------------------------------------------------------------------

/**
 * Publish a mission brief to an operative's pending queue.
 */
export async function publishMissionBrief(
  nc: NatsConnection,
  source: string,
  payload: MissionBrief,
): Promise<void> {
  const js = jetstream(nc);
  const subject = `valor.missions.${payload.assigned_to}.pending`;
  const msg = envelope(source, "mission.brief", payload);
  await js.publish(subject, encode(msg));
  logger.info("Published mission brief", {
    subject,
    mission_id: payload.mission_id,
  });
}

/**
 * Publish a mission pickup acknowledgment.
 */
export async function publishMissionPickup(
  nc: NatsConnection,
  source: string,
  payload: MissionPickup,
): Promise<void> {
  const js = jetstream(nc);
  const subject = `valor.missions.${payload.operative}.active`;
  const msg = envelope(source, "mission.pickup", payload);
  await js.publish(subject, encode(msg));
  logger.info("Published mission pickup", {
    subject,
    mission_id: payload.mission_id,
  });
}

/**
 * Publish a sitrep for a mission.
 */
export async function publishSitrep(
  nc: NatsConnection,
  source: string,
  payload: NatsSitrep,
): Promise<void> {
  const js = jetstream(nc);
  const subject = `valor.sitreps.${payload.mission_id}`;
  const msg = envelope(source, "sitrep", payload);
  await js.publish(subject, encode(msg));
  logger.debug("Published sitrep", {
    subject,
    mission_id: payload.mission_id,
    status: payload.status,
  });
}

/**
 * Publish a mission completion sitrep to the operative's complete subject.
 */
export async function publishMissionComplete(
  nc: NatsConnection,
  source: string,
  operative: string,
  payload: NatsSitrep,
): Promise<void> {
  const js = jetstream(nc);
  const subject = `valor.missions.${operative}.complete`;
  const msg = envelope(source, "mission.complete", payload);
  await js.publish(subject, encode(msg));
  logger.info("Published mission complete", {
    subject,
    mission_id: payload.mission_id,
  });
}

/**
 * Publish a mission failure sitrep to the operative's failed subject.
 */
export async function publishMissionFailed(
  nc: NatsConnection,
  source: string,
  operative: string,
  payload: NatsSitrep,
): Promise<void> {
  const js = jetstream(nc);
  const subject = `valor.missions.${operative}.failed`;
  const msg = envelope(source, "mission.failed", payload);
  await js.publish(subject, encode(msg));
  logger.warn("Published mission failed", {
    subject,
    mission_id: payload.mission_id,
  });
}

/**
 * Publish a review submission.
 */
export async function publishReviewSubmission(
  nc: NatsConnection,
  source: string,
  payload: ReviewSubmission,
): Promise<void> {
  const js = jetstream(nc);
  const subject = "valor.review.pending";
  const msg = envelope(source, "review.submission", payload);
  await js.publish(subject, encode(msg));
  logger.info("Published review submission", {
    subject,
    mission_id: payload.mission_id,
  });
}

/**
 * Publish a review verdict.
 */
export async function publishReviewVerdict(
  nc: NatsConnection,
  source: string,
  payload: ReviewVerdict,
): Promise<void> {
  const js = jetstream(nc);
  const subject = `valor.review.verdict.${payload.mission_id}`;
  const msg = envelope(source, "review.verdict", payload);
  await js.publish(subject, encode(msg));
  logger.info("Published review verdict", {
    subject,
    mission_id: payload.mission_id,
    decision: payload.decision,
  });
}

/**
 * Publish a system event (JetStream durable).
 */
export async function publishSystemEvent(
  nc: NatsConnection,
  source: string,
  payload: SystemEvent,
): Promise<void> {
  const js = jetstream(nc);
  const subject = "valor.system.events";
  const msg = envelope(source, "system.event", payload);
  await js.publish(subject, encode(msg));
  logger.debug("Published system event", { kind: payload.kind });
}

// ---------------------------------------------------------------------------
// Core NATS publishers (ephemeral subjects)
// ---------------------------------------------------------------------------

/**
 * Publish a heartbeat (ephemeral, no JetStream).
 */
export function publishHeartbeat(
  nc: NatsConnection,
  source: string,
  payload: Heartbeat,
): void {
  const subject = `valor.system.heartbeat.${payload.operative}`;
  const msg = envelope(source, "heartbeat", payload);
  nc.publish(subject, encode(msg));
  logger.debug("Published heartbeat", { operative: payload.operative });
}

/**
 * Publish a comms message to a group channel (ephemeral).
 */
export function publishCommsChannel(
  nc: NatsConnection,
  source: string,
  channel: string,
  payload: CommsPayload,
): void {
  const subject = `valor.comms.${channel}`;
  const msg = envelope(source, "comms.message", payload);
  nc.publish(subject, encode(msg));
  logger.debug("Published comms", { subject, category: payload.category });
}

/**
 * Publish a direct comms message between operatives (ephemeral).
 */
export function publishCommsDirect(
  nc: NatsConnection,
  source: string,
  from: string,
  to: string,
  payload: CommsPayload,
): void {
  const subject = `valor.comms.direct.${from}.${to}`;
  const msg = envelope(source, "comms.message", payload);
  nc.publish(subject, encode(msg));
  logger.debug("Published direct comms", { from, to });
}

/**
 * Request fleet status (ephemeral request/reply).
 */
export async function requestSystemStatus(
  nc: NatsConnection,
  source: string,
  payload: SystemStatusRequest,
  timeoutMs = 5000,
): Promise<SystemStatusResponse | null> {
  const msg = envelope(source, "system.status.request", payload);
  try {
    const resp = await nc.request(
      "valor.system.status",
      encode(msg),
      { timeout: timeoutMs },
    );
    const decoded = JSON.parse(new TextDecoder().decode(resp.data));
    return decoded.payload as SystemStatusResponse;
  } catch {
    logger.warn("System status request timed out");
    return null;
  }
}
