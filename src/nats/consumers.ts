/**
 * VALOR NATS Consumers
 *
 * JetStream consumer setup for mission pickup, sitrep subscription,
 * and review verdict subscription.
 */

import { jetstream } from "@nats-io/jetstream";
import type { JsMsg, ConsumerMessages } from "@nats-io/jetstream";
import type { NatsConnection, Subscription, Msg } from "@nats-io/nats-core";
import { logger } from "../utils/logger.js";
import type { VALORMessage } from "./types.js";
import { STREAM_NAMES } from "./types.js";

// ---------------------------------------------------------------------------
// Message decoder
// ---------------------------------------------------------------------------

function decode<T>(msg: JsMsg | Msg): VALORMessage<T> {
  const text = new TextDecoder().decode(msg.data);
  return JSON.parse(text) as VALORMessage<T>;
}

// ---------------------------------------------------------------------------
// JetStream Pull Consumers
// ---------------------------------------------------------------------------

export type MessageHandler<T> = (
  payload: T,
  envelope: VALORMessage<T>,
  raw: JsMsg,
) => Promise<void>;

/**
 * Consume missions for a specific operative. Pulls messages from the
 * durable consumer created by ensureMissionConsumer().
 *
 * The handler is responsible for calling raw.ack() on success.
 * On handler error, the message is nak'd for redelivery.
 */
export async function consumeMissions<T>(
  nc: NatsConnection,
  operative: string,
  handler: MessageHandler<T>,
): Promise<ConsumerMessages> {
  const js = jetstream(nc);
  const consumer = await js.consumers.get(
    STREAM_NAMES.MISSIONS,
    `mission-consumer-${operative}`,
  );

  const messages = await consumer.consume();

  // Process in background — caller controls lifecycle via messages.stop()
  (async () => {
    for await (const msg of messages) {
      try {
        const envelope = decode<T>(msg);
        logger.debug("Mission message received", {
          operative,
          type: envelope.type,
          id: envelope.id,
        });
        await handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Mission handler error", {
          operative,
          error: err instanceof Error ? err.message : String(err),
        });
        msg.nak();
      }
    }
  })();

  return messages;
}

/**
 * Consume sitreps from the SITREPS stream.
 */
export async function consumeSitreps<T>(
  nc: NatsConnection,
  consumerName: string,
  handler: MessageHandler<T>,
): Promise<ConsumerMessages> {
  const js = jetstream(nc);
  const consumer = await js.consumers.get(STREAM_NAMES.SITREPS, consumerName);
  const messages = await consumer.consume();

  (async () => {
    for await (const msg of messages) {
      try {
        const envelope = decode<T>(msg);
        logger.debug("Sitrep received", {
          type: envelope.type,
          id: envelope.id,
          source: envelope.source,
        });
        await handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Sitrep handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
        msg.nak();
      }
    }
  })();

  return messages;
}

/**
 * Consume review verdicts from the REVIEW stream.
 */
export async function consumeReviewVerdicts<T>(
  nc: NatsConnection,
  consumerName: string,
  handler: MessageHandler<T>,
): Promise<ConsumerMessages> {
  const js = jetstream(nc);
  const consumer = await js.consumers.get(STREAM_NAMES.REVIEW, consumerName);
  const messages = await consumer.consume();

  (async () => {
    for await (const msg of messages) {
      try {
        const envelope = decode<T>(msg);
        logger.debug("Review verdict received", {
          type: envelope.type,
          id: envelope.id,
        });
        await handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Review verdict handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
        msg.nak();
      }
    }
  })();

  return messages;
}

// ---------------------------------------------------------------------------
// Core NATS Subscriptions (ephemeral)
// ---------------------------------------------------------------------------

export type EphemeralHandler<T> = (
  payload: T,
  envelope: VALORMessage<T>,
  raw: Msg,
) => void;

/**
 * Subscribe to heartbeats for all operatives or a specific one.
 */
export function subscribeHeartbeats<T>(
  nc: NatsConnection,
  handler: EphemeralHandler<T>,
  operative?: string,
): Subscription {
  const subject = operative
    ? `valor.system.heartbeat.${operative}`
    : "valor.system.heartbeat.*";

  const sub = nc.subscribe(subject, {
    callback: (_err, msg) => {
      if (_err) {
        logger.error("Heartbeat subscription error", {
          error: _err.message,
        });
        return;
      }
      try {
        const envelope = decode<T>(msg);
        handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Heartbeat handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  logger.debug("Subscribed to heartbeats", { subject });
  return sub;
}

/**
 * Subscribe to comms on a channel or all comms.
 */
export function subscribeComms<T>(
  nc: NatsConnection,
  handler: EphemeralHandler<T>,
  channel?: string,
): Subscription {
  const subject = channel ? `valor.comms.${channel}` : "valor.comms.>";

  const sub = nc.subscribe(subject, {
    callback: (_err, msg) => {
      if (_err) {
        logger.error("Comms subscription error", { error: _err.message });
        return;
      }
      try {
        const envelope = decode<T>(msg);
        handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Comms handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  logger.debug("Subscribed to comms", { subject });
  return sub;
}

/**
 * Subscribe to direct comms for a specific operative.
 */
export function subscribeDirectComms<T>(
  nc: NatsConnection,
  operative: string,
  handler: EphemeralHandler<T>,
): Subscription {
  const subject = `valor.comms.direct.*.${operative}`;

  const sub = nc.subscribe(subject, {
    callback: (_err, msg) => {
      if (_err) {
        logger.error("Direct comms subscription error", {
          error: _err.message,
        });
        return;
      }
      try {
        const envelope = decode<T>(msg);
        handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Direct comms handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  logger.debug("Subscribed to direct comms", { subject, operative });
  return sub;
}

/**
 * Respond to system status requests.
 */
export function serveSystemStatus(
  nc: NatsConnection,
  handler: (request: VALORMessage) => VALORMessage,
): Subscription {
  const sub = nc.subscribe("valor.system.status", {
    callback: (_err, msg) => {
      if (_err) {
        logger.error("Status request error", { error: _err.message });
        return;
      }
      try {
        const request = decode(msg);
        const response = handler(request);
        const data = new TextEncoder().encode(JSON.stringify(response));
        msg.respond(data);
      } catch (err) {
        logger.error("Status handler error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  logger.debug("Serving system status requests");
  return sub;
}
