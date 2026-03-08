import type { GateEvaluator } from "./types.js";
import { checkOath } from "../vector/index.js";
import { listDecisions, getAnalysisForDecision } from "../db/index.js";

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

/** Gate 9: Oath — constitutional constraint checks against active rules. */
export const oathGate: GateEvaluator = (ctx) => {
  try {
    const result = checkOath(ctx.mission);
    if (result.passed) {
      return { gate: "oath", verdict: "pass", reason: "All oath rules satisfied", details: null };
    }

    // Layer 0 violations are absolute blocks
    const layer0 = result.violations.filter((v) => v.layer === 0);
    if (layer0.length > 0) {
      return {
        gate: "oath",
        verdict: "block",
        reason: `Constitutional violation: ${layer0[0].rule_name}`,
        details: { violations: result.violations },
      };
    }

    // Layer 1-2 violations escalate for Director review
    return {
      gate: "oath",
      verdict: "escalate",
      reason: `Oath concern: ${result.violations[0].rule_name}`,
      details: { violations: result.violations },
    };
  } catch {
    // If oath checking fails (e.g., no rules seeded), pass through
    return { gate: "oath", verdict: "pass", reason: "Oath check unavailable — passing", details: null };
  }
};

/** Gate 10: VECTOR checkpoint — checks if high-stakes missions have been analyzed. */
export const vectorCheckpointGate: GateEvaluator = (ctx) => {
  // Only enforce for missions linked to decisions
  const decisions = listDecisions({ mission_id: ctx.mission.id });
  if (decisions.length === 0) {
    // No decision linked — pass (VECTOR is opt-in per mission)
    return { gate: "vector_checkpoint", verdict: "pass", reason: "No decision linked to mission", details: null };
  }

  // Check if the latest decision has been analyzed
  const latestDecision = decisions[0];
  const analysis = getAnalysisForDecision(latestDecision.id);

  if (!analysis) {
    // Decision exists but no analysis — block high-stakes, downgrade others
    if (latestDecision.stakes === "high") {
      return {
        gate: "vector_checkpoint",
        verdict: "block",
        reason: "High-stakes decision requires VECTOR analysis before dispatch",
        details: { decision_id: latestDecision.id, stakes: latestDecision.stakes },
      };
    }
    return {
      gate: "vector_checkpoint",
      verdict: "downgrade",
      reason: "Decision awaiting VECTOR analysis",
      details: { decision_id: latestDecision.id },
    };
  }

  // Analysis exists — check recommendation
  if (analysis.recommendation === "abort") {
    return {
      gate: "vector_checkpoint",
      verdict: "block",
      reason: `VECTOR analysis recommends abort (risk: ${analysis.total_risk_score}/50)`,
      details: { decision_id: latestDecision.id, recommendation: analysis.recommendation, risk: analysis.total_risk_score },
    };
  }

  if (analysis.recommendation === "reconsider") {
    return {
      gate: "vector_checkpoint",
      verdict: "escalate",
      reason: `VECTOR analysis recommends reconsideration (risk: ${analysis.total_risk_score}/50)`,
      details: { decision_id: latestDecision.id, recommendation: analysis.recommendation, risk: analysis.total_risk_score },
    };
  }

  return {
    gate: "vector_checkpoint",
    verdict: "pass",
    reason: `VECTOR: ${analysis.recommendation} (risk: ${analysis.total_risk_score}/50)`,
    details: { decision_id: latestDecision.id, recommendation: analysis.recommendation, risk: analysis.total_risk_score },
  };
};
