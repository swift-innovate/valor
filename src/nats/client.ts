/**
 * VALOR NATS Connection Manager
 *
 * Handles connect, reconnect, health check, and graceful shutdown.
 * Uses @nats-io/transport-node for TCP connections.
 */

import { connect } from "@nats-io/transport-node";
import type { NatsConnection, ConnectionOptions } from "@nats-io/nats-core";
import { logger } from "../utils/logger.js";

export interface NatsClientOptions {
  /** NATS server URLs. Defaults to ["nats://localhost:4222"]. */
  servers?: string[];
  /** Connection name shown in NATS monitoring. */
  name?: string;
  /** Max reconnect attempts. -1 for infinite. Default: -1. */
  maxReconnectAttempts?: number;
  /** Delay between reconnect attempts in ms. Default: 2000. */
  reconnectTimeWaitMs?: number;
  /** Auth token, if required. */
  token?: string;
  /** Username/password auth. */
  user?: string;
  pass?: string;
}

const DEFAULT_OPTIONS: Required<
  Pick<NatsClientOptions, "servers" | "maxReconnectAttempts" | "reconnectTimeWaitMs">
> = {
  servers: ["nats://localhost:4222"],
  maxReconnectAttempts: -1,
  reconnectTimeWaitMs: 2000,
};

let _connection: NatsConnection | null = null;

/**
 * Connect to NATS. Returns existing connection if already connected.
 */
export async function getNatsConnection(
  opts?: NatsClientOptions,
): Promise<NatsConnection> {
  if (_connection && !_connection.isClosed()) {
    return _connection;
  }

  const merged = { ...DEFAULT_OPTIONS, ...opts };

  const connectionOpts: ConnectionOptions = {
    servers: merged.servers,
    name: merged.name ?? "valor-engine",
    maxReconnectAttempts: merged.maxReconnectAttempts,
    reconnectTimeWait: merged.reconnectTimeWaitMs,
    token: merged.token,
    user: merged.user,
    pass: merged.pass,
  };

  logger.info("NATS connecting", { servers: merged.servers });

  const nc = await connect(connectionOpts);

  logger.info("NATS connected", {
    server: nc.getServer(),
    info: { protocol: nc.info?.proto, version: nc.info?.version },
  });

  // Monitor connection status in background
  monitorStatus(nc);

  _connection = nc;
  return nc;
}

/**
 * Returns the current connection or null if not connected.
 */
export function currentConnection(): NatsConnection | null {
  if (_connection && !_connection.isClosed()) {
    return _connection;
  }
  return null;
}

/**
 * Health check — returns true if connection is open and responsive.
 */
export async function healthCheck(): Promise<boolean> {
  const nc = currentConnection();
  if (!nc) return false;

  try {
    const rtt = await nc.rtt();
    logger.debug("NATS health check OK", { rtt_ms: rtt });
    return true;
  } catch {
    logger.warn("NATS health check failed");
    return false;
  }
}

/**
 * Graceful shutdown — drain all subscriptions then close.
 */
export async function closeNatsConnection(): Promise<void> {
  const nc = _connection;
  if (!nc || nc.isClosed()) {
    _connection = null;
    return;
  }

  logger.info("NATS draining connection");
  await nc.drain();
  _connection = null;
  logger.info("NATS connection closed");
}

/**
 * Monitor connection status events (reconnect, disconnect, etc).
 */
async function monitorStatus(nc: NatsConnection): Promise<void> {
  for await (const s of nc.status()) {
    switch (s.type) {
      case "disconnect":
        logger.warn("NATS disconnected", { server: s.server });
        break;
      case "reconnect":
        logger.info("NATS reconnected", { server: s.server });
        break;
      case "error":
        logger.error("NATS error", { error: s.error.message });
        break;
      default:
        logger.debug(`NATS status: ${s.type}`);
    }
  }
}
