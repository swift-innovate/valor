/**
 * VALOR Director Classifier
 *
 * Takes inbound mission text, runs safety gates first, then calls the LLM.
 * Parses structured JSON response (ROUTE/DECOMPOSE/ESCALATE).
 * Implements confidence scoring — if below threshold, re-runs on Gear 2.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { evaluateGates } from "./safety-gates.js";
import type { GateIntercept } from "./safety-gates.js";
import { callGear1, callGear2 } from "./llm-adapter.js";
import type { LlmResponse } from "./llm-adapter.js";

// ---------------------------------------------------------------------------
// Types — Director LLM output schema
// ---------------------------------------------------------------------------

export type DirectorDecision = "ROUTE" | "DECOMPOSE" | "ESCALATE";

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

export interface DirectorOutput {
  decision: DirectorDecision;
  confidence: number;
  reasoning: string;
  routing?: RoutingInfo;
  decomposition?: DecompositionStep[];
  escalation?: EscalationInfo;
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

let _systemPrompt: string | null = null;

function loadSystemPrompt(): string {
  if (_systemPrompt) return _systemPrompt;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const promptPath = resolve(__dirname, "system-prompt.md");

  try {
    _systemPrompt = readFileSync(promptPath, "utf-8");
  } catch {
    logger.error("Failed to load Director system prompt", { path: promptPath });
    throw new Error(`Director system prompt not found at ${promptPath}`);
  }

  return _systemPrompt;
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

const VALID_DECISIONS = new Set(["ROUTE", "DECOMPOSE", "ESCALATE"]);
const VALID_OPERATIVES = new Set([
  "mira", "eddie", "forge", "gage", "zeke", "rook", "herbie", "paladin",
]);

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

  if (o.decision === "ROUTE" && o.routing && typeof o.routing === "object") {
    const r = o.routing as Record<string, unknown>;
    if (VALID_OPERATIVES.has(r.operative as string)) {
      result.routing = {
        operative: r.operative as string,
        model_tier: (r.model_tier as RoutingInfo["model_tier"]) ?? "balanced",
        priority: (r.priority as RoutingInfo["priority"]) ?? "P2",
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

  return result;
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify a mission. Runs safety gates first, then LLM if gates pass.
 * If Gear 1 confidence is below threshold, escalates to Gear 2.
 */
export async function classifyMission(
  missionText: string,
): Promise<ClassifierResult> {
  // Step 1: Safety gates (synchronous, no LLM)
  const gateResult = evaluateGates(missionText);

  if (!gateResult.passed) {
    logger.info("Mission intercepted by safety gate", {
      gate: gateResult.intercept!.matched_gate,
      intercept_id: gateResult.intercept!.intercept_id,
    });

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
  const gear1Response = await callGear1(systemPrompt, userMessage);
  const gear1Output = parseDirectorJson(gear1Response.content);

  if (gear1Output && gear1Output.confidence >= config.directorConfidenceThreshold) {
    logger.info("Gear 1 classification complete", {
      decision: gear1Output.decision,
      confidence: gear1Output.confidence,
      operative: gear1Output.routing?.operative ?? null,
    });

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

  const gear2Response = await callGear2(systemPrompt, userMessage);
  const gear2Output = parseDirectorJson(gear2Response.content);

  if (gear2Output) {
    logger.info("Gear 2 classification complete", {
      decision: gear2Output.decision,
      confidence: gear2Output.confidence,
      operative: gear2Output.routing?.operative ?? null,
    });

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
