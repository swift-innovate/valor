/**
 * VALOR Analyst Agent
 *
 * Quality gate between operative output and Principal delivery.
 * Subscribes to valor.review.pending, evaluates mission submissions via LLM,
 * and publishes structured verdicts.
 *
 * Design:
 * - Runs as its own process, separate from Director and operatives
 * - Never modifies code or files — read-only review
 * - Uses a DIFFERENT model than the operative (cross-model review)
 * - RETRY limit: max 2 retries before auto-escalating to Principal
 *
 * Usage:
 *   npx ts-node src/analyst/analyst.ts --nats nats://localhost:4222 --model qwen3:latest
 *   npx ts-node src/analyst/analyst.ts --nats nats://localhost:4222 --ollama http://starbase:40114
 */

import { parseArgs } from "node:util";
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
  ensureReviewConsumer,
  publishHeartbeat,
} from "../nats/index.js";
import { jetstream, type ConsumerMessages, type JsMsg } from "@nats-io/jetstream";
import type {
  ReviewSubmission,
  MissionBrief,
  VALORMessage,
} from "../nats/index.js";
import type { NatsConnection } from "@nats-io/nats-core";
import {
  buildAnalystSystemPrompt,
  buildReviewPrompt,
  ANALYST_MODEL_MAP,
} from "./analyst-prompt.js";
import {
  parseVerdict,
  handleApprove,
  handleRetry,
  handleEscalate,
  handleRetryLimitExceeded,
  MAX_RETRIES,
} from "./verdicts.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    nats: { type: "string", default: "nats://localhost:4222" },
    model: { type: "string", default: "qwen3:latest" },
    ollama: { type: "string", default: "http://starbase:40114" },
    "valor-url": { type: "string", default: "http://localhost:3200" },
    "heartbeat-interval": { type: "string", default: "30000" },
  },
  allowPositionals: false,
});

const NATS_URL = args.nats ?? "nats://localhost:4222";
const DEFAULT_MODEL = args.model ?? "qwen3:latest";
const OLLAMA_BASE_URL = args.ollama ?? "http://starbase:40114";
const VALOR_BASE_URL = args["valor-url"] ?? "http://localhost:3200";
const HEARTBEAT_INTERVAL_MS = parseInt(args["heartbeat-interval"] ?? "30000", 10);
const ANALYST_CALLSIGN = "analyst";

// ---------------------------------------------------------------------------
// Retry count tracking (in-memory; resets on restart)
// ---------------------------------------------------------------------------

const retryCounts = new Map<string, number>(); // mission_id → retry count

function getRetryCount(missionId: string): number {
  return retryCounts.get(missionId) ?? 0;
}

function incrementRetryCount(missionId: string): number {
  const count = (retryCounts.get(missionId) ?? 0) + 1;
  retryCounts.set(missionId, count);
  return count;
}

// ---------------------------------------------------------------------------
// LLM call via Ollama API
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callLlm(
  model: string,
  messages: OllamaMessage[],
): Promise<string> {
  const url = `${OLLAMA_BASE_URL}/api/chat`;

  logger.debug("Calling LLM", { model, url, messages: messages.length });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.1,   // Low temperature — we want consistent, deterministic reviews
        num_predict: 1024,
      },
    }),
    signal: AbortSignal.timeout(120_000), // 2 min timeout
  });

  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { message?: { content?: string } };
  const content = data.message?.content;

  if (!content) {
    throw new Error("Ollama response missing message.content");
  }

  return content;
}

/**
 * Select analyst model based on operative's model tier.
 * Never review with the same model that executed the work.
 */
function selectAnalystModel(operativeModelTier: string | undefined): string {
  if (!operativeModelTier) return DEFAULT_MODEL;

  const mapped = ANALYST_MODEL_MAP[operativeModelTier as keyof typeof ANALYST_MODEL_MAP];
  return mapped ?? DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Brief retrieval via VALOR API
// ---------------------------------------------------------------------------

/**
 * Retrieve the original MissionBrief for a submission by calling the
 * VALOR dashboard API (GET /api/missions-live/:id).
 *
 * The API returns a DashboardMission object which is mapped to MissionBrief.
 * Fields not present in DashboardMission (depends_on, model_tier,
 * acceptance_criteria, context_refs, deadline) are defaulted.
 */
async function getMissionBrief(
  missionId: string,
): Promise<MissionBrief | null> {
  try {
    const res = await fetch(`${VALOR_BASE_URL}/api/missions-live/${missionId}`);
    if (!res.ok) {
      logger.warn("Brief lookup failed", { mission_id: missionId, status: res.status });
      return null;
    }
    const data = await res.json() as Record<string, unknown>;
    return {
      mission_id: (data.mission_id as string) ?? missionId,
      title: (data.title as string) ?? missionId,
      description: (data.description as string) ?? "",
      priority: (data.priority as MissionBrief["priority"]) ?? "P2",
      assigned_to: (data.assigned_to as string) ?? "",
      depends_on: [],
      parent_mission: (data.parent_mission as string | null) ?? null,
      model_tier: "balanced" as MissionBrief["model_tier"],
      acceptance_criteria: [],
      context_refs: [],
      deadline: null,
      created_at: (data.created_at as string) ?? new Date().toISOString(),
    };
  } catch (err) {
    logger.warn("Brief lookup error", {
      mission_id: missionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Review pending consumer (pending submissions only, not verdicts)
// ---------------------------------------------------------------------------

const ANALYST_CONSUMER_NAME = "analyst-review-pending";

type ReviewHandler = (
  submission: ReviewSubmission,
  envelope: VALORMessage<ReviewSubmission>,
  raw: JsMsg,
) => Promise<void>;

async function consumeReviewPending(
  nc: NatsConnection,
  handler: ReviewHandler,
): Promise<ConsumerMessages> {
  // Ensure a durable consumer scoped to valor.review.pending only
  await ensureReviewConsumer(nc, ANALYST_CONSUMER_NAME, "valor.review.pending");

  const js = jetstream(nc);
  const consumer = await js.consumers.get("REVIEW", ANALYST_CONSUMER_NAME);
  const messages = await consumer.consume();

  (async () => {
    for await (const msg of messages) {
      try {
        const text = new TextDecoder().decode(msg.data);
        const envelope = JSON.parse(text) as VALORMessage<ReviewSubmission>;
        await handler(envelope.payload, envelope, msg);
      } catch (err) {
        logger.error("Error processing review submission", {
          error: err instanceof Error ? err.message : String(err),
        });
        msg.nak();
      }
    }
  })().catch((err) => {
    if (!isShuttingDown) {
      logger.error("Review consumer loop crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return messages;
}

// ---------------------------------------------------------------------------
// Review handler
// ---------------------------------------------------------------------------

async function handleReviewSubmission(
  submission: ReviewSubmission,
  _envelope: unknown,
  raw: import("@nats-io/jetstream").JsMsg,
): Promise<void> {
  const { mission_id, operative } = submission;

  logger.info("Review submission received", { mission_id, operative });

  // Ack immediately — analyst processing is idempotent
  raw.ack();

  const nc = await getNatsConnection();

  // Check retry count
  const retryCount = getRetryCount(mission_id);

  if (retryCount >= MAX_RETRIES) {
    // Already hit retry limit — auto-escalate without calling LLM
    logger.warn("Retry limit reached on submission", { mission_id, retryCount });
    await handleRetryLimitExceeded(
      nc,
      submission,
      {
        decision: "ESCALATE",
        reasoning: `Retry limit (${MAX_RETRIES}) exceeded.`,
        issues: ["Maximum retry attempts reached without meeting acceptance criteria."],
        instructions: "Requires Principal review.",
        criteria_results: [],
        confidence: "low",
      },
      ANALYST_CALLSIGN,
    );
    return;
  }

  // Retrieve original mission brief (may be null in Phase 1 stub)
  const brief = await getMissionBrief(mission_id);

  // Select analyst model — cross-model from operative's tier
  const operativeModelTier = brief?.model_tier;
  const analystModel = selectAnalystModel(operativeModelTier);

  logger.info("Reviewing with model", {
    mission_id,
    analyst_model: analystModel,
    operative_tier: operativeModelTier ?? "unknown",
  });

  // Build prompts
  const systemPrompt = buildAnalystSystemPrompt();
  const reviewPrompt = buildReviewPrompt({
    missionId: mission_id,
    title: brief?.title ?? mission_id,
    description: brief?.description ?? "(original brief not available — evaluate submission on its own merits)",
    acceptanceCriteria: brief?.acceptance_criteria ?? [],
    operative,
    submittedSummary: submission.summary,
    artifacts: submission.artifacts,
    selfAssessment: submission.self_assessment,
    retryCount,
  });

  // Call LLM
  let rawVerdict: string;
  try {
    rawVerdict = await callLlm(analystModel, [
      { role: "system", content: systemPrompt },
      { role: "user", content: reviewPrompt },
    ]);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("LLM call failed — escalating", { mission_id, error });

    await handleEscalate(
      nc,
      submission,
      null,
      `Analyst LLM call failed: ${error}`,
      ANALYST_CALLSIGN,
    );
    return;
  }

  logger.debug("LLM review response", { mission_id, raw: rawVerdict.slice(0, 300) });

  // Parse verdict
  const verdict = parseVerdict(rawVerdict);

  if (!verdict) {
    logger.warn("Could not parse LLM verdict — escalating", { mission_id });
    await handleEscalate(
      nc,
      submission,
      null,
      "Analyst could not parse LLM output as a valid verdict.",
      ANALYST_CALLSIGN,
    );
    return;
  }

  // Dispatch verdict
  switch (verdict.decision) {
    case "APPROVE":
      await handleApprove(nc, submission, verdict, ANALYST_CALLSIGN);
      break;

    case "RETRY": {
      const newRetryCount = incrementRetryCount(mission_id);

      if (newRetryCount > MAX_RETRIES) {
        // Crossed limit on this increment — escalate instead
        await handleRetryLimitExceeded(nc, submission, verdict, ANALYST_CALLSIGN);
      } else if (brief) {
        await handleRetry(nc, submission, brief, verdict, newRetryCount, ANALYST_CALLSIGN);
      } else {
        // No brief available to re-dispatch — escalate
        await handleEscalate(
          nc,
          submission,
          verdict,
          "RETRY verdict issued but original mission brief is unavailable — cannot re-dispatch.",
          ANALYST_CALLSIGN,
        );
      }
      break;
    }

    case "ESCALATE":
      await handleEscalate(nc, submission, verdict, verdict.reasoning, ANALYST_CALLSIGN);
      break;
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

let heartbeatTimer: NodeJS.Timeout | null = null;

async function startHeartbeat(): Promise<void> {
  const send = async (status: "IDLE" | "BUSY" | "OFFLINE") => {
    try {
      const nc = await getNatsConnection();
      await publishHeartbeat(nc, ANALYST_CALLSIGN, {
        operative: ANALYST_CALLSIGN,
        status,
        current_mission: null,
        tick_interval_ms: HEARTBEAT_INTERVAL_MS,
        uptime_ms: process.uptime() * 1000,
        last_activity: new Date().toISOString(),
        metadata: { model: DEFAULT_MODEL },
      });
    } catch {
      // Best-effort
    }
  };

  await send("IDLE");

  heartbeatTimer = setInterval(() => send("IDLE"), HEARTBEAT_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let isShuttingDown = false;
let consumerMessages: ConsumerMessages | null = null;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Analyst shutting down", { signal });

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (consumerMessages) {
    consumerMessages.stop();
    consumerMessages = null;
  }

  try {
    const nc = await getNatsConnection();
    await publishHeartbeat(nc, ANALYST_CALLSIGN, {
      operative: ANALYST_CALLSIGN,
      status: "OFFLINE",
      current_mission: null,
      tick_interval_ms: HEARTBEAT_INTERVAL_MS,
      uptime_ms: process.uptime() * 1000,
      last_activity: new Date().toISOString(),
      metadata: { reason: `Shutdown on ${signal}` },
    });
  } catch {
    // Best-effort
  }

  await closeNatsConnection();

  logger.info("Analyst shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info("VALOR Analyst starting", {
    nats: NATS_URL,
    default_model: DEFAULT_MODEL,
    ollama: OLLAMA_BASE_URL,
    valor_url: VALOR_BASE_URL,
    max_retries: MAX_RETRIES,
  });

  const nc = await getNatsConnection({
    servers: [NATS_URL],
    name: "valor-analyst",
    maxReconnectAttempts: -1,
    reconnectTimeWaitMs: 2000,
  });

  await ensureStreams(nc);
  await ensureReviewConsumer(nc, ANALYST_CONSUMER_NAME, "valor.review.pending");

  await startHeartbeat();

  logger.info("Analyst listening for review submissions", {
    subject: "valor.review.pending",
  });

  consumerMessages = await consumeReviewPending(nc, handleReviewSubmission);

  logger.info("VALOR Analyst ready");

  // Keep alive
  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
}

main().catch((err) => {
  logger.error("Fatal error in analyst", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
