/**
 * VALOR Director — Mission Classification & Dispatch Pipeline
 *
 * Inbound mission → safety gates → classifier → dispatcher → NATS
 *
 * This is the Director's brain. It receives mission text (from Telegram,
 * NATS, or API), classifies it, and dispatches to the right operative(s).
 */

import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../utils/logger.js";
import { classifyMission } from "./classifier.js";
import type { ClassifierResult } from "./classifier.js";
import { dispatchMission } from "./dispatcher.js";
import type { DispatchResult } from "./dispatcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectorPipelineResult {
  classifier: ClassifierResult;
  dispatch: DispatchResult;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full Director pipeline: safety gates → LLM classify → NATS dispatch.
 *
 * @param nc - Active NATS connection
 * @param missionText - Raw mission text from Principal
 * @param missionIdPrefix - Mission ID prefix (e.g. "VM-020")
 * @returns Pipeline result with classifier and dispatch details
 */
export async function handleMission(
  nc: NatsConnection,
  missionText: string,
  missionIdPrefix: string,
): Promise<DirectorPipelineResult> {
  logger.info("Director pipeline started", {
    prefix: missionIdPrefix,
    text_length: missionText.length,
  });

  const startMs = Date.now();

  // Step 1+2: Safety gates → LLM classification (with progress updates)
  const classifierResult = await classifyMission(missionText, missionIdPrefix, nc);

  // Step 3: Dispatch to NATS
  const dispatchResult = await dispatchMission(
    nc,
    classifierResult,
    missionIdPrefix,
    missionText,
  );

  const durationMs = Date.now() - startMs;

  logger.info("Director pipeline complete", {
    prefix: missionIdPrefix,
    gate_intercepted: classifierResult.gateIntercepted,
    decision: classifierResult.directorOutput?.decision ?? "GATE_BLOCKED",
    gear: classifierResult.gear,
    dispatched: dispatchResult.dispatched,
    escalated: dispatchResult.escalated,
    mission_ids: dispatchResult.missionIds,
    duration_ms: durationMs,
  });

  return {
    classifier: classifierResult,
    dispatch: dispatchResult,
  };
}

// Re-export key types for consumers of this module
export type { ClassifierResult } from "./classifier.js";
export type {
  DirectorOutput,
  DirectorDecision,
  RoutingInfo,
  DecompositionStep,
  EscalationInfo,
} from "./classifier.js";
export type { DispatchResult } from "./dispatcher.js";
export type { GateIntercept, GateLevel, GateResult } from "./safety-gates.js";
export { evaluateGates, formatTelegramAlert } from "./safety-gates.js";
export { classifyMission } from "./classifier.js";
export { dispatchMission, resetMissionCounter } from "./dispatcher.js";
export { callOllama, callGear1, callGear2 } from "./llm-adapter.js";
export type { LlmRequest, LlmResponse } from "./llm-adapter.js";
export {
  getRegisteredOperatives,
  getValidOperativeCallsigns,
  isOperativeRegistered,
  buildRosterPromptSection,
} from "./roster.js";
export type { RegisteredOperative } from "./roster.js";
