import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";
import { publish } from "../bus/index.js";
import type { StreamEvent, StreamHealth, HeartbeatConfig } from "../types/index.js";

export interface StreamSession {
  session_id: string;
  mission_id: string;
  health: StreamHealth;
  last_heartbeat: number;
  last_activity: number;
  first_token_at: number | null;
  sequence_expected: number;
  sequence_gaps: number[];
  total_chunks: number;
  total_errors: number;
  abort_controller: AbortController;
  warmup_warned: boolean;
}

const sessions = new Map<string, StreamSession>();

/** Configurable via STREAM_HEARTBEAT_TIMEOUT_MS env var (default: 180000 = 3 min). */
const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.STREAM_HEARTBEAT_TIMEOUT_MS ?? "180000", 10);
/** Warn after this many ms with no first token (Ollama cold model load). */
const WARMUP_WARNING_MS = 60_000;
/** Allow longer silence during model warmup before killing the session. */
const WARMUP_TIMEOUT_MS = parseInt(process.env.STREAM_WARMUP_TIMEOUT_MS ?? "300000", 10);

const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  interval_ms: 5000,
  timeout_ms: HEARTBEAT_TIMEOUT_MS,
  max_missed: 3,
};

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

export function supervise(
  missionId: string,
  stream: AsyncIterable<StreamEvent>,
  config?: Partial<HeartbeatConfig>,
): StreamSession {
  const hbConfig = { ...DEFAULT_HEARTBEAT, ...config };
  const sessionId = `str_${nanoid(21)}`;
  const now = Date.now();

  const session: StreamSession = {
    session_id: sessionId,
    mission_id: missionId,
    health: "healthy",
    last_heartbeat: now,
    last_activity: now,
    first_token_at: null,
    sequence_expected: 0,
    sequence_gaps: [],
    total_chunks: 0,
    total_errors: 0,
    abort_controller: new AbortController(),
    warmup_warned: false,
  };

  sessions.set(missionId, session);

  publish({
    type: "stream.started",
    source: { id: "stream_supervisor", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, session_id: sessionId },
    metadata: null,
  });

  // Process stream in background
  processStream(session, stream, hbConfig).catch((err) => {
    handleStreamFailure(session, err instanceof Error ? err.message : String(err));
  });

  return session;
}

async function processStream(
  session: StreamSession,
  stream: AsyncIterable<StreamEvent>,
  hbConfig: HeartbeatConfig,
): Promise<void> {
  try {
    for await (const event of stream) {
      if (session.abort_controller.signal.aborted) {
        break;
      }

      session.last_activity = Date.now();

      // Track sequence
      if (event.sequence !== session.sequence_expected) {
        session.sequence_gaps.push(session.sequence_expected);
        logger.warn("Stream sequence gap", {
          mission_id: session.mission_id,
          expected: session.sequence_expected,
          got: event.sequence,
        });
      }
      session.sequence_expected = event.sequence + 1;

      // Process by type
      switch (event.event_type) {
        case "heartbeat":
          session.last_heartbeat = Date.now();
          break;

        case "token":
          session.total_chunks++;
          if (session.first_token_at === null) {
            session.first_token_at = Date.now();
            logger.info("First token received", {
              mission_id: session.mission_id,
              warmup_ms: session.first_token_at - session.last_activity,
            });
          }
          // Also counts as heartbeat — any activity means provider is alive
          session.last_heartbeat = Date.now();
          break;

        case "tool_use":
          session.total_chunks++;
          session.last_heartbeat = Date.now();
          break;

        case "error":
          session.total_errors++;
          logger.error("Stream error event", {
            mission_id: session.mission_id,
            data: event.data,
          });
          // Fail immediately after accumulating too many errors rather than
          // waiting for the iterator to exhaust or a completion event.
          if (session.total_errors >= 3) {
            handleStreamFailure(
              session,
              `Too many stream errors (${session.total_errors})`,
            );
            return;
          }
          break;

        case "completion":
          if (session.total_errors > 0) {
            logger.warn("Completion received after stream errors", {
              mission_id: session.mission_id,
              total_errors: session.total_errors,
            });
          }
          handleStreamComplete(session);
          return;
      }

      // Evaluate health after each event
      updateHealth(session, hbConfig);
    }

    // Stream ended naturally (iterator exhausted without a completion event).
    // If errors were recorded and no completion event was reached, the provider
    // failed mid-stream — treat as failure, not success.
    if (session.health !== "failed") {
      if (session.total_errors > 0) {
        handleStreamFailure(
          session,
          `Stream ended after ${session.total_errors} error(s) with no completion event`,
        );
      } else {
        handleStreamComplete(session);
      }
    }
  } catch (err) {
    if (!session.abort_controller.signal.aborted) {
      handleStreamFailure(session, err instanceof Error ? err.message : String(err));
    }
  }
}

function updateHealth(session: StreamSession, hbConfig: HeartbeatConfig): void {
  const now = Date.now();
  const timeSinceHeartbeat = now - session.last_heartbeat;
  const missedBeats = Math.floor(timeSinceHeartbeat / hbConfig.interval_ms);

  // During warmup (no first token yet), use the longer warmup timeout and
  // emit a warning at WARMUP_WARNING_MS so the Director knows what's happening.
  const isWarmingUp = session.first_token_at === null;
  const effectiveTimeout = isWarmingUp ? WARMUP_TIMEOUT_MS : hbConfig.timeout_ms;

  if (isWarmingUp && !session.warmup_warned && timeSinceHeartbeat >= WARMUP_WARNING_MS) {
    session.warmup_warned = true;
    logger.warn("Waiting for first token — model may be loading", {
      mission_id: session.mission_id,
      waiting_ms: timeSinceHeartbeat,
      warmup_timeout_ms: WARMUP_TIMEOUT_MS,
    });
  }

  let newHealth: StreamHealth;

  if (missedBeats >= hbConfig.max_missed || timeSinceHeartbeat >= effectiveTimeout) {
    newHealth = "failed";
  } else if (missedBeats >= 2 || session.sequence_gaps.length > 3) {
    newHealth = "stalled";
  } else if (missedBeats >= 1 || session.total_errors > 0) {
    newHealth = "degraded";
  } else {
    newHealth = "healthy";
  }

  if (newHealth !== session.health) {
    const prevHealth = session.health;
    session.health = newHealth;

    publish({
      type: `stream.health.${newHealth}`,
      source: { id: "stream_supervisor", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: {
        mission_id: session.mission_id,
        session_id: session.session_id,
        previous: prevHealth,
        current: newHealth,
        missed_heartbeats: missedBeats,
        sequence_gaps: session.sequence_gaps.length,
      },
      metadata: null,
    });

    logger.warn("Stream health changed", {
      mission_id: session.mission_id,
      from: prevHealth,
      to: newHealth,
    });

    if (newHealth === "failed") {
      handleStreamFailure(session, `Heartbeat timeout after ${timeSinceHeartbeat}ms`);
    }
  }
}

function handleStreamComplete(session: StreamSession): void {
  session.health = "healthy";
  sessions.delete(session.mission_id);

  publish({
    type: "stream.completed",
    source: { id: "stream_supervisor", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      mission_id: session.mission_id,
      session_id: session.session_id,
      total_chunks: session.total_chunks,
      total_errors: session.total_errors,
      sequence_gaps: session.sequence_gaps,
    },
    metadata: null,
  });

  logger.info("Stream completed", {
    mission_id: session.mission_id,
    chunks: session.total_chunks,
    errors: session.total_errors,
  });
}

function handleStreamFailure(session: StreamSession, reason: string): void {
  session.health = "failed";
  sessions.delete(session.mission_id);

  publish({
    type: "stream.failed",
    source: { id: "stream_supervisor", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      mission_id: session.mission_id,
      session_id: session.session_id,
      reason,
      total_chunks: session.total_chunks,
      total_errors: session.total_errors,
    },
    metadata: null,
  });

  logger.error("Stream failed", {
    mission_id: session.mission_id,
    reason,
  });
}

export function abort(missionId: string, reason: string): boolean {
  const session = sessions.get(missionId);
  if (!session) return false;

  session.abort_controller.abort();
  handleStreamFailure(session, `Aborted: ${reason}`);
  return true;
}

export function getStreamHealth(missionId: string): StreamSession | undefined {
  return sessions.get(missionId);
}

export function getActiveSessions(): StreamSession[] {
  return [...sessions.values()];
}

/** Start periodic health checking of all active streams. */
export function startHealthMonitor(intervalMs = 5000): void {
  if (healthCheckInterval) return;

  logger.info("Stream health monitor started", {
    check_interval_ms: intervalMs,
    heartbeat_timeout_ms: HEARTBEAT_TIMEOUT_MS,
    warmup_timeout_ms: WARMUP_TIMEOUT_MS,
    warmup_warning_ms: WARMUP_WARNING_MS,
  });

  healthCheckInterval = setInterval(() => {
    for (const session of sessions.values()) {
      updateHealth(session, DEFAULT_HEARTBEAT);
    }
  }, intervalMs);
}

export function stopHealthMonitor(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/** Clear all sessions (for testing). */
export function clearSessions(): void {
  for (const session of sessions.values()) {
    session.abort_controller.abort();
  }
  sessions.clear();
}
