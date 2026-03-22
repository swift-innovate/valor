/**
 * VALOR Operative Consumer
 *
 * Production-ready NATS consumer template for VALOR operatives.
 * Subscribes to missions via JetStream, executes work, publishes sitreps,
 * and sends heartbeats on every tick.
 *
 * Usage:
 *   npx ts-node src/consumers/operative-consumer.ts --operative eddie --nats nats://localhost:4222
 *
 * This is the bridge between agent-tick and NATS. All operatives use this
 * template — the only difference is --operative <callsign>.
 */

import { parseArgs } from "node:util";
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
  ensureMissionConsumer,
  consumeMissions,
  publishMissionPickup,
  publishSitrep,
  publishMissionComplete,
  publishMissionFailed,
  publishReviewSubmission,
  publishHeartbeat,
} from "../nats/index.js";
import type {
  MissionBrief,
  NatsSitrep,
  SitrepArtifact,
  OperativeCallsign,
} from "../nats/index.js";
import type { ConsumerMessages } from "@nats-io/jetstream";
import { logger } from "../utils/logger.js";
import { isOperativeRegistered } from "../director/roster.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    operative: { type: "string" },
    nats: { type: "string", default: "nats://localhost:4222" },
    "tick-interval": { type: "string", default: "30000" },
    "heartbeat-interval": { type: "string", default: "30000" },
  },
  allowPositionals: false,
});

if (!args.operative) {
  console.error("Error: --operative <callsign> is required");
  console.error("Example: npx ts-node src/consumers/operative-consumer.ts --operative eddie --nats nats://localhost:4222");
  process.exit(1);
}

const OPERATIVE = args.operative as OperativeCallsign;
const NATS_URL = args.nats ?? "nats://localhost:4222";
const HEARTBEAT_INTERVAL_MS = parseInt(args["heartbeat-interval"] ?? "30000", 10);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentMission: string | null = null;
let isShuttingDown = false;
let consumerMessages: ConsumerMessages | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Mission execution stub
// ---------------------------------------------------------------------------

/**
 * Execute a mission. Replace this stub with real logic when wiring operatives.
 *
 * The stub:
 * 1. Logs the mission brief
 * 2. Publishes an IN_PROGRESS sitrep
 * 3. Simulates work (5s delay)
 * 4. Returns a COMPLETE result
 */
async function executeMission(
  brief: MissionBrief,
): Promise<{ artifacts: SitrepArtifact[]; summary: string }> {
  logger.info("Executing mission (stub)", {
    mission_id: brief.mission_id,
    title: brief.title,
    priority: brief.priority,
  });

  // Publish IN_PROGRESS sitrep
  const nc = await getNatsConnection();
  await publishSitrep(nc, OPERATIVE, {
    mission_id: brief.mission_id,
    operative: OPERATIVE,
    status: "IN_PROGRESS",
    progress_pct: 10,
    summary: `Mission accepted. Starting: ${brief.title}`,
    artifacts: [],
    blockers: [],
    next_steps: ["Execute mission steps", "Publish completion sitrep"],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  // Simulate work — real implementation replaces this with actual agent execution
  logger.info("Simulating mission work (5s)...", { mission_id: brief.mission_id });
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Mid-mission progress sitrep
  await publishSitrep(nc, OPERATIVE, {
    mission_id: brief.mission_id,
    operative: OPERATIVE,
    status: "IN_PROGRESS",
    progress_pct: 80,
    summary: "Work complete. Preparing deliverable.",
    artifacts: [],
    blockers: [],
    next_steps: ["Finalize output", "Submit for review"],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    summary: `Mission ${brief.mission_id} completed: ${brief.title}`,
    artifacts: [
      {
        type: "note",
        label: "Stub execution note",
        ref: `Mission ${brief.mission_id} executed by ${OPERATIVE} (stub). Replace executeMission() with real logic.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mission handler
// ---------------------------------------------------------------------------

async function handleMission(
  payload: MissionBrief,
  _envelope: unknown,
  raw: import("@nats-io/jetstream").JsMsg,
): Promise<void> {
  const { mission_id, title } = payload;

  logger.info("Mission received", { mission_id, title, operative: OPERATIVE });

  // Acknowledge to JetStream immediately — prevents redelivery during execution
  raw.ack();

  // Track current mission for heartbeat
  currentMission = mission_id;

  const nc = await getNatsConnection();

  try {
    // Announce pickup
    await publishMissionPickup(nc, OPERATIVE, {
      mission_id,
      operative: OPERATIVE,
      acknowledged_at: new Date().toISOString(),
      estimated_completion: null,
      notes: null,
    });

    logger.info("Mission pickup published", { mission_id });

    // Execute
    const result = await executeMission(payload);

    // Publish COMPLETE sitrep
    await publishMissionComplete(nc, OPERATIVE, OPERATIVE, {
      mission_id,
      operative: OPERATIVE,
      status: "COMPLETE",
      progress_pct: 100,
      summary: result.summary,
      artifacts: result.artifacts,
      blockers: [],
      next_steps: [],
      tokens_used: null,
      timestamp: new Date().toISOString(),
    });

    // Submit for review
    await publishReviewSubmission(nc, OPERATIVE, {
      mission_id,
      operative: OPERATIVE,
      completed_at: new Date().toISOString(),
      summary: result.summary,
      artifacts: result.artifacts,
      self_assessment: "Stub execution — review and wire real implementation.",
    });

    logger.info("Mission complete, submitted for review", { mission_id });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Mission execution failed", { mission_id, error });

    // Publish FAILED sitrep
    await publishMissionFailed(nc, OPERATIVE, OPERATIVE, {
      mission_id,
      operative: OPERATIVE,
      status: "FAILED",
      progress_pct: 0,
      summary: `Mission failed: ${error}`,
      artifacts: [],
      blockers: [error],
      next_steps: ["Review error", "Retry or escalate"],
      tokens_used: null,
      timestamp: new Date().toISOString(),
    });
  } finally {
    currentMission = null;
  }
}

// ---------------------------------------------------------------------------
// Heartbeat loop
// ---------------------------------------------------------------------------

async function startHeartbeatLoop(): Promise<void> {
  const sendHeartbeat = async (status: "IDLE" | "BUSY" | "ERROR" | "OFFLINE") => {
    try {
      const nc = await getNatsConnection();
      await publishHeartbeat(nc, OPERATIVE, {
        operative: OPERATIVE,
        status,
        current_mission: currentMission,
        tick_interval_ms: HEARTBEAT_INTERVAL_MS,
        uptime_ms: process.uptime() * 1000,
        last_activity: new Date().toISOString(),
        metadata: null,
      });
      logger.debug("Heartbeat sent", { status, current_mission: currentMission });
    } catch (err) {
      logger.warn("Heartbeat failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Send initial heartbeat
  await sendHeartbeat("IDLE");

  heartbeatTimer = setInterval(async () => {
    if (isShuttingDown) return;
    const status = currentMission ? "BUSY" : "IDLE";
    await sendHeartbeat(status);
  }, HEARTBEAT_INTERVAL_MS);

  logger.info("Heartbeat loop started", { interval_ms: HEARTBEAT_INTERVAL_MS });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Shutting down", { signal, operative: OPERATIVE });

  // Stop heartbeat timer
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // Stop consuming new missions
  if (consumerMessages) {
    consumerMessages.stop();
    consumerMessages = null;
  }

  // Publish OFFLINE heartbeat
  try {
    const nc = await getNatsConnection();
    await publishHeartbeat(nc, OPERATIVE, {
      operative: OPERATIVE,
      status: "OFFLINE",
      current_mission: currentMission,
      tick_interval_ms: HEARTBEAT_INTERVAL_MS,
      uptime_ms: process.uptime() * 1000,
      last_activity: new Date().toISOString(),
      metadata: { reason: `Shutdown on ${signal}` },
    });
    logger.info("OFFLINE heartbeat published");
  } catch {
    // Best-effort — don't block shutdown
  }

  // Drain NATS connection
  await closeNatsConnection();

  logger.info("Shutdown complete", { operative: OPERATIVE });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info("VALOR operative consumer starting", {
    operative: OPERATIVE,
    nats: NATS_URL,
    heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
  });

  // Verify operative is registered via agent card
  try {
    if (!isOperativeRegistered(OPERATIVE)) {
      logger.error("Operative not registered — refusing to start", {
        operative: OPERATIVE,
        hint: "Submit and approve an agent card via the dashboard before starting this consumer.",
      });
      console.error(
        `Error: "${OPERATIVE}" has no approved agent card. Register at /dashboard/agent-cards first.`,
      );
      process.exit(1);
    }
    logger.info("Operative registration verified", { operative: OPERATIVE });
  } catch (err) {
    // DB not available — warn but allow startup (e.g. DB on different host)
    logger.warn("Could not verify agent registration (DB unavailable)", {
      operative: OPERATIVE,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Connect to NATS
  const nc = await getNatsConnection({
    servers: [NATS_URL],
    name: `valor-operative-${OPERATIVE}`,
    maxReconnectAttempts: -1,
    reconnectTimeWaitMs: 2000,
  });

  // Ensure required JetStream streams exist
  logger.info("Ensuring NATS streams...");
  await ensureStreams(nc);

  // Ensure this operative's durable consumer exists
  logger.info("Ensuring mission consumer...");
  await ensureMissionConsumer(nc, OPERATIVE);

  // Start heartbeat loop
  await startHeartbeatLoop();

  // Start consuming missions
  logger.info("Starting mission consumer...", { operative: OPERATIVE });
  consumerMessages = await consumeMissions<MissionBrief>(nc, OPERATIVE, handleMission);

  logger.info("VALOR operative consumer ready", {
    operative: OPERATIVE,
    subject: `valor.missions.${OPERATIVE}.pending`,
  });

  // Keep alive — the consumer loop runs until shutdown signal
  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
}

main().catch((err) => {
  logger.error("Fatal error in operative consumer", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
