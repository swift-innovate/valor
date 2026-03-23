/**
 * VALOR Director Classifier
 *
 * Takes inbound mission text, runs safety gates first, then calls the LLM.
 * Parses structured JSON response (ROUTE/DECOMPOSE/ESCALATE).
 * Implements confidence scoring — if below threshold, re-runs on Gear 2.
 *
 * Includes timeout handling, retry logic, and progress updates to Telegram.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NatsConnection } from "@nats-io/nats-core";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { publishSitrep } from "../nats/publishers.js";
import { evaluateGates } from "./safety-gates.js";
import type { GateIntercept } from "./safety-gates.js";
import { callGear1, callGear2 } from "./llm-adapter.js";
import type { LlmResponse } from "./llm-adapter.js";
import {
  LlmTimeoutError,
  LlmNetworkError,
  LlmHttpError,
} from "./errors.js";
import {
  getValidOperativeCallsigns,
  buildRosterPromptSection,
} from "./roster.js";

// ---------------------------------------------------------------------------
// Types — Director LLM output schema
// ---------------------------------------------------------------------------

export type DirectorDecision = "ROUTE" | "DECOMPOSE" | "ESCALATE" | "TASK" | "CONVERSE";

export interface RoutingInfo {
  operative: string;
  model_tier: "local" | "efficient" | "balanced" | "frontier";
  priority: "P0" | "P1" | "P2" | "P3";
}

export interface DecompositionStep {
  task_id: string;
  title: string;
  description: string;
  operative: string;
  model_tier: "local" | "efficient" | "balanced" | "frontier";
  depends_on: string[];
  acceptance_criteria: string;
}

export interface EscalationInfo {
  reason: string;
  safety_gate: string;
  recommended_action: string;
}

export interface TaskInfo {
  operative: string;
  query: string;
  model_tier: "local" | "efficient" | "balanced" | "frontier";
}

export interface ConversationInfo {
  target_agent: string;
  summary: string;
}

export interface DirectorOutput {
  decision: DirectorDecision;
  confidence: number;
  reasoning: string;
  routing?: RoutingInfo;
  decomposition?: DecompositionStep[];
  escalation?: EscalationInfo;
  task?: TaskInfo;
  conversation?: ConversationInfo;
}

export interface ClassifierResult {
  /** Whether the mission was intercepted by a safety gate (no LLM call). */
  gateIntercepted: boolean;
  /** Gate intercept details if intercepted. */
  intercept: GateIntercept | null;
  /** Parsed Director output if LLM was called. */
  directorOutput: DirectorOutput | null;
  /** Which gear was used (1 or 2), or null if gate-intercepted. */
  gear: 1 | 2 | null;
  /** Raw LLM response for debugging. */
  rawResponse: LlmResponse | null;
}

// ---------------------------------------------------------------------------
// System prompt loader
// ---------------------------------------------------------------------------

let _systemPromptTemplate: string | null = null;

/**
 * Build the Director system prompt with the live operative roster.
 * The template is cached but the roster is injected fresh each time.
 */
function loadSystemPrompt(): string {
  if (!_systemPromptTemplate) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const promptPath = resolve(__dirname, "system-prompt.md");

    try {
      _systemPromptTemplate = readFileSync(promptPath, "utf-8");
    } catch {
      logger.error("Failed to load Director system prompt", { path: promptPath });
      throw new Error(`Director system prompt not found at ${promptPath}`);
    }
  }

  // Inject live roster into template
  const roster = buildRosterPromptSection();
  return _systemPromptTemplate.replace("{{OPERATIVE_ROSTER}}", roster);
}

// ---------------------------------------------------------------------------
// JSON parser with recovery
// ---------------------------------------------------------------------------

function parseDirectorJson(raw: string): DirectorOutput | null {
  // Try direct parse first
  try {
    return validateOutput(JSON.parse(raw));
  } catch {
    // noop
  }

  // Try extracting JSON from markdown code block
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return validateOutput(JSON.parse(codeBlock[1]));
    } catch {
      // noop
    }
  }

  // Try finding first { ... } block
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return validateOutput(JSON.parse(braceMatch[0]));
    } catch {
      // noop
    }
  }

  return null;
}

const VALID_DECISIONS = new Set(["ROUTE", "DECOMPOSE", "ESCALATE", "TASK", "CONVERSE"]);

function validateOutput(obj: unknown): DirectorOutput | null {
  if (!obj || typeof obj !== "object") return null;

  const o = obj as Record<string, unknown>;

  if (!VALID_DECISIONS.has(o.decision as string)) return null;
  if (typeof o.confidence !== "number") return null;
  if (typeof o.reasoning !== "string") return null;

  const result: DirectorOutput = {
    decision: o.decision as DirectorDecision,
    confidence: Math.max(0, Math.min(10, o.confidence)),
    reasoning: o.reasoning,
  };

  // Dynamic operative validation — only registered agents are valid
  const validOperatives = getValidOperativeCallsigns();

  if (o.decision === "ROUTE" && o.routing && typeof o.routing === "object") {
    const r = o.routing as Record<string, unknown>;
    const operative = r.operative as string;
    if (validOperatives.has(operative)) {
      result.routing = {
        operative,
        model_tier: (r.model_tier as RoutingInfo["model_tier"]) ?? "balanced",
        priority: (r.priority as RoutingInfo["priority"]) ?? "P2",
      };
    } else {
      // LLM routed to unregistered operative — force escalation
      logger.warn("LLM routed to unregistered operative, forcing ESCALATE", {
        operative,
        registered: Array.from(validOperatives),
      });
      result.decision = "ESCALATE";
      result.escalation = {
        reason: `Best fit "${operative}" is not registered. Available: ${Array.from(validOperatives).join(", ") || "none"}`,
        safety_gate: "uncertain",
        recommended_action: "Reassign to an available operative or bring the target agent online.",
      };
    }
  }

  if (o.decision === "DECOMPOSE" && Array.isArray(o.decomposition)) {
    result.decomposition = (o.decomposition as Record<string, unknown>[])
      .filter((s) => typeof s.task_id === "string" && typeof s.operative === "string")
      .map((s) => ({
        task_id: s.task_id as string,
        title: (s.title as string) ?? "",
        description: (s.description as string) ?? "",
        operative: s.operative as string,
        model_tier: (s.model_tier as DecompositionStep["model_tier"]) ?? "balanced",
        depends_on: Array.isArray(s.depends_on) ? (s.depends_on as string[]) : [],
        acceptance_criteria: (s.acceptance_criteria as string) ?? "",
      }));
  }

  if (o.decision === "ESCALATE" && o.escalation && typeof o.escalation === "object") {
    const e = o.escalation as Record<string, unknown>;
    result.escalation = {
      reason: (e.reason as string) ?? "",
      safety_gate: (e.safety_gate as string) ?? "uncertain",
      recommended_action: (e.recommended_action as string) ?? "",
    };
  }

  if (o.decision === "TASK" && o.task && typeof o.task === "object") {
    const t = o.task as Record<string, unknown>;
    const operative = t.operative as string;
    if (validOperatives.has(operative)) {
      result.task = {
        operative,
        query: (t.query as string) ?? "",
        model_tier: (t.model_tier as TaskInfo["model_tier"]) ?? "local",
      };
    } else {
      // Unknown operative — escalate
      logger.warn("TASK routed to unregistered operative, forcing ESCALATE", {
        operative,
        registered: Array.from(validOperatives),
      });
      result.decision = "ESCALATE";
      result.escalation = {
        reason: `Task operative "${operative}" is not registered. Available: ${Array.from(validOperatives).join(", ") || "none"}`,
        safety_gate: "uncertain",
        recommended_action: "Reassign to an available operative.",
      };
    }
  }

  if (o.decision === "CONVERSE" && o.conversation && typeof o.conversation === "object") {
    const cv = o.conversation as Record<string, unknown>;
    result.conversation = {
      target_agent: (cv.target_agent as string) ?? "mira",
      summary: (cv.summary as string) ?? "",
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Progress update helper
// ---------------------------------------------------------------------------

async function sendProgressUpdate(
  nc: NatsConnection | null,
  missionId: string,
  status: string,
  summary: string,
): Promise<void> {
  if (!nc) return; // No NATS connection (testing mode)

  try {
    await publishSitrep(nc, "director", {
      mission_id: missionId,
      operative: "director",
      status: status as "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE" | "FAILED",
      summary,
      progress_pct: 0,
      artifacts: [],
      blockers: [],
      next_steps: [],
      tokens_used: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Failed to send progress update", {
      mission_id: missionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Progress summary builder
// ---------------------------------------------------------------------------

function buildProgressSummary(output: DirectorOutput, label: string): string {
  switch (output.decision) {
    case "ROUTE":
      return `✅ Mission classified${label}: ROUTE → ${output.routing?.operative ?? "unknown"}`;
    case "DECOMPOSE":
      return `✅ Mission decomposed${label} into ${output.decomposition?.length ?? 0} sub-tasks`;
    case "TASK":
      return `⚡ Task dispatched${label}: ${output.task?.operative ?? "unknown"} — "${output.task?.query?.slice(0, 80) ?? ""}"`;
    case "CONVERSE":
      return `💬 Conversation routed${label} → ${output.conversation?.target_agent ?? "unknown"}`;
    default:
      return `⚠️ Mission escalated${label}: ${output.escalation?.reason ?? "unknown"}`;
  }
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify a mission. Runs safety gates first, then LLM if gates pass.
 * If Gear 1 confidence is below threshold, escalates to Gear 2.
 *
 * Includes timeout handling, retry logic, and progress updates.
 *
 * @param missionText - The mission description
 * @param missionId - Mission identifier for progress updates
 * @param nc - Optional NATS connection for sending sitreps (null in tests)
 */
export async function classifyMission(
  missionText: string,
  missionId?: string,
  nc?: NatsConnection | null,
): Promise<ClassifierResult> {
  const mid = missionId ?? "unknown";

  // Send initial progress update
  if (nc) {
    await sendProgressUpdate(nc, mid, "IN_PROGRESS", "✅ Mission received. Director is classifying...");
  }

  // Step 1: Safety gates (synchronous, no LLM)
  const gateResult = evaluateGates(missionText);

  if (!gateResult.passed) {
    logger.info("Mission intercepted by safety gate", {
      gate: gateResult.intercept!.matched_gate,
      intercept_id: gateResult.intercept!.intercept_id,
    });

    if (nc) {
      await sendProgressUpdate(
        nc,
        mid,
        "BLOCKED",
        `⚠️ Mission blocked by safety gate: ${gateResult.intercept!.matched_gate}`,
      );
    }

    return {
      gateIntercepted: true,
      intercept: gateResult.intercept,
      directorOutput: null,
      gear: null,
      rawResponse: null,
    };
  }

  // Step 2: Gear 1 — fast local model
  const systemPrompt = loadSystemPrompt();
  const userMessage = `Mission: "${missionText}"`;

  logger.info("Gear 1 classification starting", { model: config.directorModel });

  let gear1Response: LlmResponse | null = null;
  let gear1Error: Error | null = null;

  try {
    // Start 10s progress update timer
    const progressTimer = setTimeout(async () => {
      if (nc) {
        await sendProgressUpdate(nc, mid, "IN_PROGRESS", "⏳ Still waiting on LLM response...");
      }
    }, 10_000);

    gear1Response = await callGear1(systemPrompt, userMessage);
    clearTimeout(progressTimer);
  } catch (error) {
    gear1Error = error as Error;

    // Handle timeout — retry once after 30s
    if (error instanceof LlmTimeoutError) {
      logger.warn("Gear 1 timeout — will retry", {
        timeout_ms: error.timeoutMs,
        url: error.url,
      });

      if (nc) {
        await sendProgressUpdate(
          nc,
          mid,
          "IN_PROGRESS",
          "⏳ LLM timeout after 60s. Model may be loading into VRAM. Retrying...",
        );
      }

      // Wait 30s before retry (model may be loading)
      await new Promise((resolve) => setTimeout(resolve, 30_000));

      try {
        gear1Response = await callGear1(systemPrompt, userMessage);
        logger.info("Gear 1 retry succeeded");
      } catch (retryError) {
        logger.error("Gear 1 retry also failed", {
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });

        if (nc) {
          const errorMsg =
            retryError instanceof LlmTimeoutError
              ? "❌ Director LLM failed after 2 timeouts. Mission saved in JetStream. Check Ollama and use /retry."
              : retryError instanceof LlmNetworkError
                ? `❌ Cannot reach Ollama at ${retryError.url}. Check CITADEL/starbase.`
                : `❌ Director LLM error: ${retryError instanceof Error ? retryError.message : String(retryError)}`;

          await sendProgressUpdate(nc, mid, "FAILED", errorMsg);
        }

        // Return escalation result
        return {
          gateIntercepted: false,
          intercept: null,
          directorOutput: {
            decision: "ESCALATE",
            confidence: 0,
            reasoning: `LLM call failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
            escalation: {
              reason: "LLM timeout or network error after retry",
              safety_gate: "technical",
              recommended_action: "Check Ollama connectivity and retry mission.",
            },
          },
          gear: 1,
          rawResponse: null,
        };
      }
    }
    // Network error — don't retry, escalate immediately
    else if (error instanceof LlmNetworkError) {
      logger.error("Gear 1 network error — cannot reach Ollama", {
        url: error.url,
        cause: error.cause.message,
      });

      if (nc) {
        await sendProgressUpdate(
          nc,
          mid,
          "FAILED",
          `❌ Cannot reach Ollama at ${error.url}. Check CITADEL/starbase.`,
        );
      }

      return {
        gateIntercepted: false,
        intercept: null,
        directorOutput: {
          decision: "ESCALATE",
          confidence: 0,
          reasoning: `Ollama unreachable: ${error.message}`,
          escalation: {
            reason: "Network error",
            safety_gate: "technical",
            recommended_action: "Verify Ollama is running and accessible.",
          },
        },
        gear: 1,
        rawResponse: null,
      };
    }
    // HTTP error — escalate
    else if (error instanceof LlmHttpError) {
      logger.error("Gear 1 HTTP error", {
        status: error.status,
        body: error.body.slice(0, 200),
      });

      if (nc) {
        await sendProgressUpdate(
          nc,
          mid,
          "FAILED",
          `❌ Ollama error (${error.status}): ${error.body.slice(0, 100)}`,
        );
      }

      return {
        gateIntercepted: false,
        intercept: null,
        directorOutput: {
          decision: "ESCALATE",
          confidence: 0,
          reasoning: `Ollama HTTP error: ${error.message}`,
          escalation: {
            reason: "HTTP error",
            safety_gate: "technical",
            recommended_action: "Check Ollama logs.",
          },
        },
        gear: 1,
        rawResponse: null,
      };
    }
  }

  // Parse Gear 1 response
  const gear1Output = gear1Response ? parseDirectorJson(gear1Response.content) : null;

  if (gear1Output && gear1Output.confidence >= config.directorConfidenceThreshold) {
    logger.info("Gear 1 classification complete", {
      decision: gear1Output.decision,
      confidence: gear1Output.confidence,
      operative: gear1Output.routing?.operative ?? null,
    });

    if (nc) {
      const summary = buildProgressSummary(gear1Output, "");
      await sendProgressUpdate(nc, mid, "COMPLETE", summary);
    }

    return {
      gateIntercepted: false,
      intercept: null,
      directorOutput: gear1Output,
      gear: 1,
      rawResponse: gear1Response,
    };
  }

  // Step 3: Gear 2 — reasoning model (low confidence or parse failure)
  const reason = gear1Output
    ? `confidence ${gear1Output.confidence} < threshold ${config.directorConfidenceThreshold}`
    : "Gear 1 JSON parse failure";

  logger.info("Escalating to Gear 2", {
    reason,
    model: config.directorGear2Model,
  });

  if (nc) {
    await sendProgressUpdate(
      nc,
      mid,
      "IN_PROGRESS",
      "⏳ Low confidence from Gear 1. Escalating to reasoning model...",
    );
  }

  const gear2Response = await callGear2(systemPrompt, userMessage);
  const gear2Output = parseDirectorJson(gear2Response.content);

  if (gear2Output) {
    logger.info("Gear 2 classification complete", {
      decision: gear2Output.decision,
      confidence: gear2Output.confidence,
      operative: gear2Output.routing?.operative ?? null,
    });

    if (nc) {
      const summary = buildProgressSummary(gear2Output, " (Gear 2)");
      await sendProgressUpdate(nc, mid, "COMPLETE", summary);
    }

    return {
      gateIntercepted: false,
      intercept: null,
      directorOutput: gear2Output,
      gear: 2,
      rawResponse: gear2Response,
    };
  }

  // Both gears failed to produce valid JSON — escalate to Principal
  logger.error("Both gears failed to produce valid Director output");

  if (nc) {
    await sendProgressUpdate(
      nc,
      mid,
      "FAILED",
      "❌ Both gears failed to produce valid JSON. Escalating to Principal for manual routing.",
    );
  }

  return {
    gateIntercepted: false,
    intercept: null,
    directorOutput: {
      decision: "ESCALATE",
      confidence: 0,
      reasoning: "Both Gear 1 and Gear 2 failed to produce valid JSON. Escalating to Principal.",
      escalation: {
        reason: "LLM output parse failure on both gears",
        safety_gate: "uncertain",
        recommended_action: "Principal should manually route this mission.",
      },
    },
    gear: 2,
    rawResponse: gear2Response,
  };
}
