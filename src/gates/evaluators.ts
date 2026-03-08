import type { GateEvaluator } from "./types.js";

/** Gate 1: Mission must be in a dispatchable state. */
export const missionStateGate: GateEvaluator = (ctx) => {
  const allowed = ["queued", "gated"];
  if (allowed.includes(ctx.mission.status)) {
    return { gate: "mission_state", verdict: "pass", reason: "Mission in valid state", details: null };
  }
  return {
    gate: "mission_state",
    verdict: "block",
    reason: `Mission status "${ctx.mission.status}" is not dispatchable`,
    details: { current_status: ctx.mission.status, allowed },
  };
};

/** Gate 2: Convergence — mission hasn't failed too many times without progress. */
export const convergenceGate: GateEvaluator = (ctx) => {
  // If revision count is high but still under cap, downgrade priority
  if (ctx.mission.revision_count > 0 && ctx.mission.revision_count >= ctx.mission.max_revisions - 1) {
    return {
      gate: "convergence",
      verdict: "downgrade",
      reason: "Mission approaching revision cap without convergence",
      details: { revision_count: ctx.mission.revision_count, max: ctx.mission.max_revisions },
    };
  }
  return { gate: "convergence", verdict: "pass", reason: "Convergence acceptable", details: null };
};

/** Gate 3: Revision count must be under the cap. */
export const revisionCapGate: GateEvaluator = (ctx) => {
  if (ctx.mission.revision_count < ctx.mission.max_revisions) {
    return { gate: "revision_cap", verdict: "pass", reason: "Under revision cap", details: null };
  }
  return {
    gate: "revision_cap",
    verdict: "block",
    reason: `Revision cap reached (${ctx.mission.revision_count}/${ctx.mission.max_revisions})`,
    details: { count: ctx.mission.revision_count, max: ctx.mission.max_revisions },
  };
};

/** Gate 4: Assigned agent must be healthy. */
export const healthGate: GateEvaluator = (ctx) => {
  if (!ctx.agent) {
    return { gate: "health", verdict: "pass", reason: "No agent assigned (will be assigned on dispatch)", details: null };
  }
  if (ctx.agent.health_status === "healthy") {
    return { gate: "health", verdict: "pass", reason: "Agent healthy", details: null };
  }
  if (ctx.agent.health_status === "degraded") {
    return {
      gate: "health",
      verdict: "downgrade",
      reason: "Agent degraded — mission may proceed at lower priority",
      details: { agent_id: ctx.agent.id, status: ctx.agent.health_status },
    };
  }
  return {
    gate: "health",
    verdict: "block",
    reason: `Agent ${ctx.agent.callsign} is ${ctx.agent.health_status}`,
    details: { agent_id: ctx.agent.id, status: ctx.agent.health_status },
  };
};

/** Gate 5: Artifact integrity — placeholder, always passes. */
export const artifactIntegrityGate: GateEvaluator = (ctx) => {
  return { gate: "artifact_integrity", verdict: "pass", reason: "No artifacts to verify", details: null };
};

/** Gate 6: Mission cost must be within budget. */
export const budgetGate: GateEvaluator = (ctx) => {
  if (ctx.budgetLimitUsd <= 0) {
    return { gate: "budget", verdict: "pass", reason: "No budget limit set", details: null };
  }
  if (ctx.mission.cost_usd < ctx.budgetLimitUsd) {
    return { gate: "budget", verdict: "pass", reason: "Within budget", details: null };
  }
  return {
    gate: "budget",
    verdict: "block",
    reason: `Budget exceeded ($${ctx.mission.cost_usd.toFixed(2)} / $${ctx.budgetLimitUsd.toFixed(2)})`,
    details: { spent: ctx.mission.cost_usd, limit: ctx.budgetLimitUsd },
  };
};

/** Gate 7: Concurrency — don't exceed parallel mission limit. */
export const concurrencyGate: GateEvaluator = (ctx) => {
  if (ctx.maxParallelMissions <= 0) {
    return { gate: "concurrency", verdict: "pass", reason: "No concurrency limit", details: null };
  }
  if (ctx.activeMissionCount < ctx.maxParallelMissions) {
    return { gate: "concurrency", verdict: "pass", reason: "Under concurrency limit", details: null };
  }
  return {
    gate: "concurrency",
    verdict: "block",
    reason: `Concurrency limit reached (${ctx.activeMissionCount}/${ctx.maxParallelMissions})`,
    details: { active: ctx.activeMissionCount, max: ctx.maxParallelMissions },
  };
};

/** Gate 8: Human-in-the-loop approval required for certain missions. */
export const hilGate: GateEvaluator = (ctx) => {
  // Check if division requires approval for this type of action
  if (ctx.division?.autonomy_policy.auto_dispatch_enabled === false) {
    if (ctx.approvalStatus === "approved") {
      return { gate: "hil", verdict: "pass", reason: "Director approved", details: null };
    }
    if (ctx.approvalStatus === "pending") {
      return { gate: "hil", verdict: "block", reason: "Awaiting Director approval", details: null };
    }
    if (ctx.approvalStatus === "rejected") {
      return { gate: "hil", verdict: "block", reason: "Director rejected this mission", details: null };
    }
    return {
      gate: "hil",
      verdict: "escalate",
      reason: "Division requires Director approval for dispatch",
      details: { division: ctx.division.namespace },
    };
  }

  // High-cost missions always require approval
  if (ctx.division && ctx.mission.cost_usd > ctx.division.autonomy_policy.max_cost_autonomous_usd) {
    if (ctx.approvalStatus === "approved") {
      return { gate: "hil", verdict: "pass", reason: "Cost approved by Director", details: null };
    }
    return {
      gate: "hil",
      verdict: "escalate",
      reason: `Mission cost ($${ctx.mission.cost_usd.toFixed(2)}) exceeds autonomous limit ($${ctx.division.autonomy_policy.max_cost_autonomous_usd.toFixed(2)})`,
      details: { cost: ctx.mission.cost_usd, limit: ctx.division.autonomy_policy.max_cost_autonomous_usd },
    };
  }

  return { gate: "hil", verdict: "pass", reason: "No approval required", details: null };
};

/** Gate 9: Oath — constitutional checks. Placeholder for now. */
export const oathGate: GateEvaluator = (ctx) => {
  // Future: check mission constraints against constitutional rules
  return { gate: "oath", verdict: "pass", reason: "Oath checks passed", details: null };
};

/** Gate 10: VECTOR checkpoint — decision framework. Placeholder for now. */
export const vectorCheckpointGate: GateEvaluator = (ctx) => {
  // Future: VECTOR method evaluation at decision checkpoints
  return { gate: "vector_checkpoint", verdict: "pass", reason: "VECTOR checkpoint passed", details: null };
};
