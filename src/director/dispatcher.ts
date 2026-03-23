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
import { listAgents } from "../db/repositories/agent-repo.js";
import { sendMessage, generateConversationId } from "../db/repositories/comms-repo.js";
import { createMission } from "../db/repositories/mission-repo.js";
import { getCardByCallsign } from "../db/repositories/agent-card-repo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchResult {
  dispatched: boolean;
  missionIds: string[];
  escalated: boolean;
  escalationMessage: string | null;
  taskDispatched?: boolean;
  conversationRouted?: boolean;
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
// Priority mapping
// ---------------------------------------------------------------------------

function mapPriority(natsPriority: MissionPriority): "critical" | "high" | "normal" | "low" {
  switch (natsPriority) {
    case "P0": return "critical";
    case "P1": return "high";
    case "P2": return "normal";
    case "P3": return "low";
    default: return "normal";
  }
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
    case "TASK":
      return dispatchTask(nc, output, missionIdPrefix, missionText);
    case "CONVERSE":
      return dispatchConversation(nc, output, missionIdPrefix, missionText);
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

  // Write DB record using NATS mission_id as the DB id
  try {
    const card = getCardByCallsign(routing.operative);
    createMission(
      {
        division_id: null,
        title: brief.title,
        objective: brief.description,
        status: "dispatched",
        phase: null,
        assigned_agent_id: card?.agent_id ?? null,
        priority: mapPriority(brief.priority),
        constraints: [],
        deliverables: brief.acceptance_criteria,
        success_criteria: brief.acceptance_criteria,
        token_usage: null,
        cost_usd: 0,
        revision_count: 0,
        max_revisions: 5,
        parent_mission_id: null,
        initiative_id: null,
        dispatched_at: brief.created_at,
        completed_at: null,
      },
      brief.mission_id,
    );
    logger.info("DB mission record created", { mission_id: brief.mission_id });
  } catch (err) {
    // Non-fatal — NATS dispatch already succeeded
    logger.warn("Failed to create DB mission record", {
      mission_id: brief.mission_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

  // Ensure parent mission exists in DB so sub-mission FKs don't fail
  try {
    createMission(
      {
        division_id: null,
        title: `Mission ${prefix}`,
        objective: missionText.substring(0, 500),
        status: "dispatched",
        phase: null,
        assigned_agent_id: null,
        priority: mapPriority((output.routing?.priority as MissionPriority) ?? "P2"),
        constraints: [],
        deliverables: [],
        success_criteria: [],
        token_usage: null,
        cost_usd: 0,
        revision_count: 0,
        max_revisions: 5,
        parent_mission_id: null,
        initiative_id: null,
        dispatched_at: new Date().toISOString(),
        completed_at: null,
      },
      prefix,
    );
  } catch {
    // Parent may already exist — non-fatal
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

    try {
      const card = getCardByCallsign(step.operative);
      createMission(
        {
          division_id: null,
          title: brief.title,
          objective: brief.description,
          status: "dispatched",
          phase: null,
          assigned_agent_id: card?.agent_id ?? null,
          priority: mapPriority(brief.priority),
          constraints: [],
          deliverables: brief.acceptance_criteria,
          success_criteria: brief.acceptance_criteria,
          token_usage: null,
          cost_usd: 0,
          revision_count: 0,
          max_revisions: 5,
          parent_mission_id: brief.parent_mission,
          initiative_id: null,
          dispatched_at: brief.created_at,
          completed_at: null,
        },
        brief.mission_id,
      );
    } catch (err) {
      logger.warn("Failed to create DB mission record for sub-mission", {
        mission_id: brief.mission_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
// TASK — lightweight fire-and-forget (no mission board entry)
// ---------------------------------------------------------------------------

async function dispatchTask(
  nc: NatsConnection,
  output: DirectorOutput,
  prefix: string,
  missionText: string,
): Promise<DispatchResult> {
  const task = output.task;
  if (!task) {
    logger.error("TASK decision missing task info");
    return { dispatched: false, missionIds: [], escalated: false, escalationMessage: null };
  }

  const taskId = `TASK-${prefix}-${Date.now()}`;
  const encoder = new TextEncoder();
  const payload = encoder.encode(
    JSON.stringify({
      type: "valor.task",
      source: { id: "director", type: "director" },
      payload: {
        task_id: taskId,
        operative: task.operative,
        query: task.query,
        model_tier: task.model_tier,
        original_text: missionText,
      },
      timestamp: new Date().toISOString(),
    }),
  );

  // Publish to operative-specific task subject — no mission board entry
  nc.publish(`valor.tasks.${task.operative.toLowerCase()}`, payload);

  await publishSitrep(nc, "director", {
    mission_id: taskId,
    operative: "director",
    status: "ACCEPTED",
    progress_pct: 0,
    summary: `⚡ Task dispatched to ${task.operative} (${task.model_tier}): "${task.query.slice(0, 100)}"`,
    artifacts: [],
    blockers: [],
    next_steps: [`${task.operative} executes and returns result`],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  logger.info("Dispatched TASK", {
    task_id: taskId,
    operative: task.operative,
    query_length: task.query.length,
  });

  return {
    dispatched: true,
    missionIds: [],
    escalated: false,
    escalationMessage: null,
    taskDispatched: true,
  };
}

// ---------------------------------------------------------------------------
// CONVERSE — route to agent comms channel
// ---------------------------------------------------------------------------

async function dispatchConversation(
  nc: NatsConnection,
  output: DirectorOutput,
  prefix: string,
  missionText: string,
): Promise<DispatchResult> {
  const conv = output.conversation;
  if (!conv) {
    logger.error("CONVERSE decision missing conversation info");
    return { dispatched: false, missionIds: [], escalated: false, escalationMessage: null };
  }

  // Find target agent by callsign
  const agents = listAgents({});
  const targetAgent = agents.find(
    (a) => a.callsign.toLowerCase() === conv.target_agent.toLowerCase(),
  );

  if (targetAgent) {
    try {
      sendMessage(
        {
          from_agent_id: "director",
          to_agent_id: targetAgent.id,
          to_division_id: null,
          subject: `Director: ${conv.summary.slice(0, 80)}`,
          body: missionText,
          priority: "routine",
          category: "advisory",
          conversation_id: generateConversationId(),
          in_reply_to: null,
          attachments: [],
        },
        false,
      );
      logger.info("Dispatched CONVERSE via comms", {
        target_agent: conv.target_agent,
        agent_id: targetAgent.id,
      });
    } catch (err) {
      logger.warn("CONVERSE comms send failed, sending sitrep only", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn("CONVERSE target agent not found — routing via sitrep only", {
      target_agent: conv.target_agent,
    });
  }

  await publishSitrep(nc, "director", {
    mission_id: prefix,
    operative: "director",
    status: "COMPLETE",
    progress_pct: 100,
    summary: `💬 Conversation routed to ${conv.target_agent}: "${conv.summary}"`,
    artifacts: [],
    blockers: [],
    next_steps: [],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  });

  return {
    dispatched: false,
    missionIds: [],
    escalated: false,
    escalationMessage: null,
    conversationRouted: true,
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
