/**
 * VALOR Director Dispatcher
 *
 * Takes classifier output and publishes to NATS.
 * ROUTE → single MissionBrief. DECOMPOSE → multiple with depends_on.
 * ESCALATE → sitrep to Principal.
 */

import type { NatsConnection } from "@nats-io/nats-core";
import { logger } from "../utils/logger.js";
import {
  publishMissionBrief,
  publishSitrep,
} from "../nats/index.js";
import type {
  MissionBrief,
  NatsSitrep,
  ModelTier,
  MissionPriority,
} from "../nats/index.js";
import type {
  ClassifierResult,
  DirectorOutput,
  RoutingInfo,
  DecompositionStep,
} from "./classifier.js";
import { formatTelegramAlert } from "./safety-gates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchResult {
  dispatched: boolean;
  missionIds: string[];
  escalated: boolean;
  escalationMessage: string | null;
}

// ---------------------------------------------------------------------------
// Mission ID generation
// ---------------------------------------------------------------------------

let _missionCounter = 0;

function nextMissionId(prefix: string): string {
  return `${prefix}-${++_missionCounter}`;
}

/**
 * Reset counter (for testing).
 */
export function resetMissionCounter(): void {
  _missionCounter = 0;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a classified mission to NATS.
 *
 * @param nc - NATS connection
 * @param result - Classifier result from classifyMission()
 * @param missionIdPrefix - Prefix for generated mission IDs (e.g. "VM-020")
 * @param missionText - Original mission text (for sitrep context)
 */
export async function dispatchMission(
  nc: NatsConnection,
  result: ClassifierResult,
  missionIdPrefix: string,
  missionText: string,
): Promise<DispatchResult> {
  // Gate-intercepted — escalate to Principal
  if (result.gateIntercepted && result.intercept) {
    const alertMsg = formatTelegramAlert(result.intercept);

    // Publish escalation sitrep
    await publishSitrep(nc, "director", {
      mission_id: missionIdPrefix,
      operative: "director",
      status: "BLOCKED",
      progress_pct: 0,
      summary: `Safety gate ${result.intercept.matched_gate} intercepted: ${result.intercept.matched_patterns.join(", ")}`,
      artifacts: [],
      blockers: [`Gate ${result.intercept.matched_gate} fired — awaiting Principal override`],
      next_steps: ["Principal to APPROVED or ABORT via Telegram"],
      tokens_used: null,
      timestamp: new Date().toISOString(),
    });

    logger.info("Dispatched gate escalation", {
      gate: result.intercept.matched_gate,
      intercept_id: result.intercept.intercept_id,
    });

    return {
      dispatched: false,
      missionIds: [],
      escalated: true,
      escalationMessage: alertMsg,
    };
  }

  const output = result.directorOutput;
  if (!output) {
    return {
      dispatched: false,
      missionIds: [],
      escalated: false,
      escalationMessage: null,
    };
  }

  switch (output.decision) {
    case "ROUTE":
      return dispatchRoute(nc, output, missionIdPrefix, missionText);
    case "DECOMPOSE":
      return dispatchDecompose(nc, output, missionIdPrefix, missionText);
    case "ESCALATE":
      return dispatchEscalate(nc, output, missionIdPrefix, missionText);
    default:
      logger.error("Unknown decision type", { decision: output.decision });
      return {
        dispatched: false,
        missionIds: [],
        escalated: false,
        escalationMessage: null,
      };
  }
}

// ---------------------------------------------------------------------------
// ROUTE — single operative assignment
// ---------------------------------------------------------------------------

async function dispatchRoute(
  nc: NatsConnection,
  output: DirectorOutput,
  prefix: string,
  missionText: string,
): Promise<DispatchResult> {
  const routing = output.routing;
  if (!routing) {
    logger.error("ROUTE decision missing routing info");
    return { dispatched: false, missionIds: [], escalated: false, escalationMessage: null };
  }

  const missionId = nextMissionId(prefix);
  const brief: MissionBrief = {
    mission_id: missionId,
    title: missionText.slice(0, 100),
    description: missionText,
    priority: routing.priority,
    assigned_to: routing.operative,
    depends_on: [],
    parent_mission: null,
    model_tier: routing.model_tier,
    acceptance_criteria: [],
    context_refs: [],
    deadline: null,
    created_at: new Date().toISOString(),
  };

  await publishMissionBrief(nc, "director", brief);

  // Publish dispatch sitrep
  await publishSitrep(nc, "director", {
    mission_id: missionId,
    operative: "director",
    status: "ACCEPTED",
    progress_pct: 0,
    summary: `Routed to ${routing.operative} (${routing.model_tier}, ${routing.priority}). ${output.reasoning}`,
    artifacts: [],
    blockers: [],
    next_steps: [`${routing.operative} picks up mission`],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  logger.info("Dispatched ROUTE", {
    mission_id: missionId,
    operative: routing.operative,
    confidence: output.confidence,
    gear: "unknown",
  });

  return {
    dispatched: true,
    missionIds: [missionId],
    escalated: false,
    escalationMessage: null,
  };
}

// ---------------------------------------------------------------------------
// DECOMPOSE — multiple sub-missions with dependencies
// ---------------------------------------------------------------------------

async function dispatchDecompose(
  nc: NatsConnection,
  output: DirectorOutput,
  prefix: string,
  missionText: string,
): Promise<DispatchResult> {
  const steps = output.decomposition;
  if (!steps || steps.length === 0) {
    logger.error("DECOMPOSE decision missing decomposition steps");
    return { dispatched: false, missionIds: [], escalated: false, escalationMessage: null };
  }

  // Map task_ids from LLM output to our generated mission IDs
  const idMap = new Map<string, string>();
  const missionIds: string[] = [];

  for (const step of steps) {
    const missionId = nextMissionId(prefix);
    idMap.set(step.task_id, missionId);
    missionIds.push(missionId);
  }

  // Publish each sub-mission
  for (const step of steps) {
    const missionId = idMap.get(step.task_id)!;
    const resolvedDeps = step.depends_on
      .map((dep) => idMap.get(dep) ?? dep)
      .filter(Boolean);

    const brief: MissionBrief = {
      mission_id: missionId,
      title: step.title,
      description: step.description,
      priority: (output.routing?.priority as MissionPriority) ?? "P2",
      assigned_to: step.operative,
      depends_on: resolvedDeps,
      parent_mission: prefix,
      model_tier: step.model_tier as ModelTier,
      acceptance_criteria: step.acceptance_criteria
        ? [step.acceptance_criteria]
        : [],
      context_refs: [],
      deadline: null,
      created_at: new Date().toISOString(),
    };

    await publishMissionBrief(nc, "director", brief);
  }

  // Publish decomposition sitrep
  const stepSummary = steps
    .map((s) => `  ${idMap.get(s.task_id)} → ${s.operative}: ${s.title}`)
    .join("\n");

  await publishSitrep(nc, "director", {
    mission_id: prefix,
    operative: "director",
    status: "ACCEPTED",
    progress_pct: 0,
    summary: `Decomposed into ${steps.length} sub-missions:\n${stepSummary}\n\n${output.reasoning}`,
    artifacts: [],
    blockers: [],
    next_steps: [`First mission: ${missionIds[0]}`],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  logger.info("Dispatched DECOMPOSE", {
    parent: prefix,
    sub_missions: missionIds,
    operatives: steps.map((s) => s.operative),
  });

  return {
    dispatched: true,
    missionIds,
    escalated: false,
    escalationMessage: null,
  };
}

// ---------------------------------------------------------------------------
// ESCALATE — forward to Principal
// ---------------------------------------------------------------------------

async function dispatchEscalate(
  nc: NatsConnection,
  output: DirectorOutput,
  prefix: string,
  missionText: string,
): Promise<DispatchResult> {
  const esc = output.escalation;
  const reason = esc?.reason ?? output.reasoning;

  await publishSitrep(nc, "director", {
    mission_id: prefix,
    operative: "director",
    status: "BLOCKED",
    progress_pct: 0,
    summary: `Escalated to Principal: ${reason}`,
    artifacts: [],
    blockers: [reason],
    next_steps: [esc?.recommended_action ?? "Awaiting Principal decision"],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  const alertMsg = [
    "\u26a0\ufe0f VALOR DIRECTOR — ESCALATION",
    "\u2500".repeat(40),
    `Mission: "${missionText}"`,
    "",
    `Reason: ${reason}`,
    `Safety gate: ${esc?.safety_gate ?? "uncertain"}`,
    `Recommended: ${esc?.recommended_action ?? "Manual routing by Principal"}`,
    "",
    `Confidence: ${output.confidence}/10`,
  ].join("\n");

  logger.info("Dispatched ESCALATE", {
    mission: prefix,
    reason,
    confidence: output.confidence,
  });

  return {
    dispatched: false,
    missionIds: [],
    escalated: true,
    escalationMessage: alertMsg,
  };
}
