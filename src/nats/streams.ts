/**
 * VALOR JetStream Stream & Consumer Creation
 *
 * Creates the four durable streams defined in nats-subjects.md:
 * MISSIONS, SITREPS, REVIEW, SYSTEM_EVENTS.
 */

import {
  jetstreamManager,
  AckPolicy,
  DeliverPolicy,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
} from "@nats-io/jetstream";
import type { NatsConnection, Nanos } from "@nats-io/nats-core";
import { STREAM_NAMES, STREAM_SUBJECTS } from "./types.js";
import { logger } from "../utils/logger.js";

/** Convert milliseconds to nanoseconds for NATS config. */
function msToNanos(ms: number): Nanos {
  return (ms * 1_000_000) as Nanos;
}

/** Milliseconds per day. */
const DAY_MS = 86_400_000;

/** How long JetStream waits for an ack before redelivering. Configurable via NATS_ACK_WAIT_MS.
 *  Default: 600000 (10 min) — LLM calls + Ollama cold starts can take several minutes. */
const NATS_ACK_WAIT_MS = parseInt(process.env.NATS_ACK_WAIT_MS ?? "600000", 10);

/**
 * Ensure all VALOR JetStream streams exist. Idempotent — updates existing
 * streams if configuration has changed.
 */
export async function ensureStreams(nc: NatsConnection): Promise<void> {
  const jsm = await jetstreamManager(nc);

  // MISSIONS — WorkQueue: one consumer acks, message removed.
  await upsertStream(jsm, {
    name: STREAM_NAMES.MISSIONS,
    subjects: [STREAM_SUBJECTS.MISSIONS],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_msgs: 10_000,
  });

  // SITREPS — Limits: 7-day retention for audit trail.
  await upsertStream(jsm, {
    name: STREAM_NAMES.SITREPS,
    subjects: [STREAM_SUBJECTS.SITREPS],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_age: msToNanos(7 * DAY_MS),
  });

  // REVIEW — Limits: 30-day retention for verdict records.
  await upsertStream(jsm, {
    name: STREAM_NAMES.REVIEW,
    subjects: [STREAM_SUBJECTS.REVIEW],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_age: msToNanos(30 * DAY_MS),
  });

  // SYSTEM_EVENTS — Limits: 24-hour short-term operational record.
  await upsertStream(jsm, {
    name: STREAM_NAMES.SYSTEM_EVENTS,
    subjects: [STREAM_SUBJECTS.SYSTEM_EVENTS],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_age: msToNanos(DAY_MS),
  });

  logger.info("NATS JetStream streams ensured", {
    streams: Object.values(STREAM_NAMES),
  });
}

/**
 * Create a durable pull consumer for an operative's mission pickup.
 */
export async function ensureMissionConsumer(
  nc: NatsConnection,
  operative: string,
): Promise<void> {
  const jsm = await jetstreamManager(nc);
  const consumerName = `mission-consumer-${operative}`;

  await jsm.consumers.add(STREAM_NAMES.MISSIONS, {
    durable_name: consumerName,
    filter_subject: `valor.missions.${operative}.pending`,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    max_deliver: 3,
    ack_wait: msToNanos(NATS_ACK_WAIT_MS),
  });

  logger.info("NATS mission consumer ensured", {
    consumer: consumerName,
    operative,
    ack_wait_ms: NATS_ACK_WAIT_MS,
  });
}

/**
 * Create a durable consumer for sitrep subscription on a specific mission.
 */
export async function ensureSitrepConsumer(
  nc: NatsConnection,
  consumerName: string,
  filterSubject?: string,
): Promise<void> {
  const jsm = await jetstreamManager(nc);

  await jsm.consumers.add(STREAM_NAMES.SITREPS, {
    durable_name: consumerName,
    filter_subject: filterSubject ?? "valor.sitreps.*",
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.Last,
    ack_wait: msToNanos(10_000),
  });

  logger.info("NATS sitrep consumer ensured", { consumer: consumerName });
}

/**
 * Create a durable consumer for review verdicts.
 */
export async function ensureReviewConsumer(
  nc: NatsConnection,
  consumerName: string,
  filterSubject?: string,
): Promise<void> {
  const jsm = await jetstreamManager(nc);

  await jsm.consumers.add(STREAM_NAMES.REVIEW, {
    durable_name: consumerName,
    filter_subject: filterSubject ?? "valor.review.>",
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    ack_wait: msToNanos(30_000),
  });

  logger.info("NATS review consumer ensured", { consumer: consumerName });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface StreamConfig {
  name: string;
  subjects: string[];
  retention: RetentionPolicy;
  storage: StorageType;
  discard: DiscardPolicy;
  max_msgs?: number;
  max_age?: Nanos;
}

async function upsertStream(
  jsm: Awaited<ReturnType<typeof jetstreamManager>>,
  cfg: StreamConfig,
): Promise<void> {
  try {
    // Try to update existing stream (only mutable fields)
    const existing = await jsm.streams.info(cfg.name);
    if (existing) {
      await jsm.streams.update(cfg.name, {
        subjects: cfg.subjects,
        discard: cfg.discard,
        max_msgs: cfg.max_msgs ?? -1,
        max_age: cfg.max_age ?? (0 as Nanos),
      });
      logger.debug(`NATS stream updated: ${cfg.name}`);
      return;
    }
  } catch {
    // Stream doesn't exist, create it
  }

  await jsm.streams.add({
    name: cfg.name,
    subjects: cfg.subjects,
    retention: cfg.retention,
    storage: cfg.storage,
    discard: cfg.discard,
    max_msgs: cfg.max_msgs ?? -1,
    max_age: cfg.max_age ?? (0 as Nanos),
  });

  logger.debug(`NATS stream created: ${cfg.name}`);
}
