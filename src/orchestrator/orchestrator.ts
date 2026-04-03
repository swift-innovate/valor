import { logger } from "../utils/logger.js";
import { publish } from "../bus/index.js";
import {
  getMission,
  transitionMission,
  updateMission,
  listMissions,
  getAgent,
  getDivision,
  createApproval,
  getPendingApproval,
  appendAuditEntry,
  getDivisionLead,
} from "../db/index.js";
import { evaluateGates } from "../gates/index.js";
import type { GateContext } from "../gates/types.js";
import { getBestProvider } from "../providers/registry.js";
import { supervise } from "../stream/supervisor.js";
import { subscribe } from "../bus/index.js";
import { estimateCost } from "../providers/cost.js";
import type { Mission } from "../types/index.js";
import { dispatchWebhook } from "../dispatch/webhook.js";
import { executeInternalMission } from "../execution/index.js";
import { config } from "../config.js";

/** Resolve which agent should execute a mission.
 *  Priority: assigned_agent_id → division lead → null (direct provider) */
function resolveExecutingAgent(mission: Mission) {
  if (mission.assigned_agent_id) {
    return getAgent(mission.assigned_agent_id);
  }
  if (mission.division_id) {
    const lead = getDivisionLead(mission.division_id);
    if (lead) return getAgent(lead.agent_id);
  }
  return null;
}

/** Dispatch a mission through the gate system and, if approved, to an agent or provider. */
export async function dispatchMission(missionId: string): Promise<{
  dispatched: boolean;
  reason: string;
  mission: Mission;
}> {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);

  // Must be in queued state to dispatch
  if (mission.status !== "queued" && mission.status !== "gated") {
    return { dispatched: false, reason: `Mission status is "${mission.status}", expected "queued" or "gated"`, mission };
  }

  // Transition to gated for evaluation
  if (mission.status === "queued") {
    transitionMission(missionId, "gated");
  }

  // Resolve the executing agent (assigned directly, or division lead)
  const agent = resolveExecutingAgent(mission);
  const division = mission.division_id ? getDivision(mission.division_id) : null;
  const activeMissions = listMissions({ status: "streaming" }).length
    + listMissions({ status: "dispatched" }).length;

  const pendingApproval = getPendingApproval(missionId);
  let approvalStatus: GateContext["approvalStatus"] = "none";
  if (pendingApproval) {
    approvalStatus = pendingApproval.status === "pending" ? "pending"
      : pendingApproval.status === "approved" ? "approved"
      : pendingApproval.status === "rejected" ? "rejected"
      : "none";
  }

  const ctx: GateContext = {
    mission: getMission(missionId)!, // Re-read after transition
    agent,
    division,
    activeMissionCount: activeMissions,
    maxParallelMissions: 10,
    budgetLimitUsd: division?.autonomy_policy.max_cost_autonomous_usd ?? 0,
    approvalStatus,
  };

  // Evaluate gates
  const gateResult = evaluateGates(ctx);

  // Handle escalations (create approval requests)
  if (gateResult.escalations.length > 0) {
    for (const esc of gateResult.escalations) {
      const existing = getPendingApproval(missionId);
      if (!existing) {
        createApproval({
          mission_id: missionId,
          gate: esc.gate,
          requested_by: "gate_runner",
        });
      }
    }

    publish({
      type: "mission.approval.requested",
      source: { id: "orchestrator", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: missionId, gates: gateResult.escalations.map((e) => e.gate) },
      metadata: null,
    });

    const updated = getMission(missionId)!;
    return { dispatched: false, reason: "Awaiting approval", mission: updated };
  }

  // Handle blocks
  if (!gateResult.passed) {
    const reasons = gateResult.blockers.map((b) => `${b.gate}: ${b.reason}`).join("; ");
    const updated = getMission(missionId)!;
    return { dispatched: false, reason: `Blocked by gates: ${reasons}`, mission: updated };
  }

  // ── Path A: agent with endpoint_url → webhook dispatch ───────────
  if (agent?.endpoint_url) {
    const dispatched = transitionMission(missionId, "dispatched");

    appendAuditEntry({
      entity_type: "mission",
      entity_id: missionId,
      operation: "update",
      before_state: JSON.stringify({ status: "gated" }),
      after_state: JSON.stringify({ status: "dispatched", agent: agent.id, mode: "webhook" }),
      actor_id: "orchestrator",
    });

    publish({
      type: "mission.dispatched",
      source: { id: "orchestrator", type: "system" },
      target: { id: agent.id, type: "agent" },
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: missionId, agent_id: agent.id, mode: "webhook" },
      metadata: null,
    });

    const callbackBase = `http://localhost:${config.port}`;
    const result = await dispatchWebhook(missionId, agent.id, callbackBase);

    if (!result.delivered) {
      logger.warn("Webhook delivery failed — mission left in dispatched", {
        mission_id: missionId,
        agent_id: agent.id,
        error: result.error,
      });
    } else {
      logger.info("Mission dispatched via webhook", {
        mission_id: missionId,
        agent_id: agent.id,
        endpoint: result.endpoint_url,
      });
    }

    return {
      dispatched: result.delivered,
      reason: result.delivered ? `Dispatched to agent ${agent.callsign} via webhook` : `Webhook delivery failed: ${result.error}`,
      mission: getMission(missionId)!,
    };
  }

  // ── Path C: internal agent → operative loop ─────────────────────
  if (agent && !agent.endpoint_url && agent.runtime === "internal") {
    transitionMission(missionId, "dispatched");

    appendAuditEntry({
      entity_type: "mission",
      entity_id: missionId,
      operation: "update",
      before_state: JSON.stringify({ status: "gated" }),
      after_state: JSON.stringify({ status: "dispatched", agent: agent.id, mode: "internal" }),
      actor_id: "orchestrator",
    });

    publish({
      type: "mission.dispatched",
      source: { id: "orchestrator", type: "system" },
      target: { id: agent.id, type: "agent" },
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: missionId, agent_id: agent.id, mode: "internal" },
      metadata: null,
    });

    // Fire and forget — the operative agent manages its own lifecycle
    // and publishes sitreps through the event bus
    executeInternalMission(missionId, agent.id).catch((err) => {
      logger.error("Internal mission execution failed", {
        mission_id: missionId,
        agent_id: agent.id,
        error: err instanceof Error ? err.message : String(err),
      });
      handleMissionFailure(missionId, err instanceof Error ? err.message : String(err));
    });

    return {
      dispatched: true,
      reason: `Dispatched to internal agent ${agent.callsign}`,
      mission: getMission(missionId)!,
    };
  }

  // ── Path B: no agent endpoint → direct provider stream ───────────
  const provider = getBestProvider({
    model: agent?.model ?? undefined,
    capabilities: { streaming: true },
  });

  if (!provider) {
    return {
      dispatched: false,
      reason: "No agent endpoint and no provider available",
      mission: getMission(missionId)!,
    };
  }

  // Transition to dispatched
  const dispatched = transitionMission(missionId, "dispatched");

  appendAuditEntry({
    entity_type: "mission",
    entity_id: missionId,
    operation: "update",
    before_state: JSON.stringify({ status: "gated" }),
    after_state: JSON.stringify({ status: "dispatched", provider: provider.id, mode: "direct" }),
    actor_id: "orchestrator",
  });

  publish({
    type: "mission.dispatched",
    source: { id: "orchestrator", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, provider: provider.id, mode: "direct" },
    metadata: null,
  });

  // Build prompt from persona if agent has one loaded
  const systemPrompt = `You are executing a mission.\nTitle: ${dispatched.title}\nObjective: ${dispatched.objective}${dispatched.constraints.length ? `\nConstraints:\n${dispatched.constraints.map((c) => `- ${c}`).join("\\n")}` : ""}${dispatched.deliverables.length ? `\nDeliverables:\n${dispatched.deliverables.map((d) => `- ${d}`).join("\\n")}` : ""}${dispatched.success_criteria.length ? `\nSuccess criteria:\n${dispatched.success_criteria.map((s) => `- ${s}`).join("\\n")}` : ""}`;

  const stream = provider.stream({
    model: agent?.model ?? "claude-sonnet-4-5",
    messages: [{ role: "user", content: dispatched.objective }],
    max_tokens: 4096,
    system: systemPrompt,
  });

  // Transition to streaming
  transitionMission(missionId, "streaming");

  // Supervise the stream
  supervise(missionId, stream);

  logger.info("Mission dispatched via direct provider", { mission_id: missionId, provider: provider.id });

  return { dispatched: true, reason: `Dispatched via provider ${provider.id}`, mission: getMission(missionId)! };
}

/** Handle mission completion — called when stream supervisor emits stream.completed. */
export function handleMissionComplete(missionId: string): Mission {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);

  if (mission.status !== "streaming") {
    logger.warn("Mission not in streaming state for completion", {
      mission_id: missionId,
      status: mission.status,
    });
    return mission;
  }

  const completed = transitionMission(missionId, "complete");

  appendAuditEntry({
    entity_type: "mission",
    entity_id: missionId,
    operation: "update",
    before_state: JSON.stringify({ status: "streaming" }),
    after_state: JSON.stringify({ status: "complete" }),
    actor_id: "orchestrator",
  });

  // Move to AAR pending
  const aarPending = transitionMission(missionId, "aar_pending");

  publish({
    type: "mission.completed",
    source: { id: "orchestrator", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId },
    metadata: null,
  });

  return aarPending;
}

/** Handle mission failure — called when stream supervisor emits stream.failed. */
export function handleMissionFailure(missionId: string, reason: string): Mission {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);

  if (mission.status !== "streaming" && mission.status !== "dispatched") {
    logger.warn("Mission not in active state for failure", {
      mission_id: missionId,
      status: mission.status,
    });
    return mission;
  }

  const failed = transitionMission(missionId, "failed");

  appendAuditEntry({
    entity_type: "mission",
    entity_id: missionId,
    operation: "update",
    before_state: JSON.stringify({ status: mission.status }),
    after_state: JSON.stringify({ status: "failed", reason }),
    actor_id: "orchestrator",
  });

  publish({
    type: "mission.failed",
    source: { id: "orchestrator", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, reason },
    metadata: null,
  });

  return failed;
}

/** Process AAR — simple pass-through for now. */
export function processAAR(missionId: string, approved: boolean): Mission {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);

  if (mission.status !== "aar_pending") {
    throw new Error(`Mission ${missionId} is not in aar_pending state`);
  }

  if (approved) {
    const completed = transitionMission(missionId, "aar_complete");
    publish({
      type: "mission.aar.approved",
      source: { id: "orchestrator", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: missionId },
      metadata: null,
    });
    return completed;
  }

  // Not approved — retry by going back to queued
  updateMission(missionId, { revision_count: mission.revision_count + 1 });
  const requeued = transitionMission(missionId, "queued");
  publish({
    type: "mission.aar.rejected",
    source: { id: "orchestrator", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, revision: mission.revision_count + 1 },
    metadata: null,
  });
  return requeued;
}

/** Abort a mission. */
export function abortMission(missionId: string, reason: string): Mission {
  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);

  const aborted = transitionMission(missionId, "aborted");

  appendAuditEntry({
    entity_type: "mission",
    entity_id: missionId,
    operation: "update",
    before_state: JSON.stringify({ status: mission.status }),
    after_state: JSON.stringify({ status: "aborted", reason }),
    actor_id: "director",
  });

  publish({
    type: "mission.aborted",
    source: { id: "director", type: "director" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, reason },
    metadata: null,
  });

  return aborted;
}

/** Wire up bus listeners for stream events. Call once at startup. */
export function initOrchestratorListeners(): void {
  subscribe("stream.completed", (event) => {
    const missionId = event.payload.mission_id as string;
    try {
      handleMissionComplete(missionId);
    } catch (err) {
      logger.error("Failed to handle mission completion", {
        mission_id: missionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  subscribe("stream.failed", (event) => {
    const missionId = event.payload.mission_id as string;
    const reason = event.payload.reason as string;
    try {
      handleMissionFailure(missionId, reason);
    } catch (err) {
      logger.error("Failed to handle mission failure", {
        mission_id: missionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info("Orchestrator listeners initialized");
}
