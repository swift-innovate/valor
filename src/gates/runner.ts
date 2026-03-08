import { nanoid } from "nanoid";
import { getDb } from "../db/database.js";
import { logger } from "../utils/logger.js";
import { publish } from "../bus/index.js";
import type { GateContext, GateEvalResult } from "./types.js";
import {
  missionStateGate,
  convergenceGate,
  revisionCapGate,
  healthGate,
  artifactIntegrityGate,
  budgetGate,
  concurrencyGate,
  hilGate,
  oathGate,
  vectorCheckpointGate,
} from "./evaluators.js";

const ALL_GATES = [
  missionStateGate,
  convergenceGate,
  revisionCapGate,
  healthGate,
  artifactIntegrityGate,
  budgetGate,
  concurrencyGate,
  hilGate,
  oathGate,
  vectorCheckpointGate,
];

export interface GateRunResult {
  passed: boolean;
  results: GateEvalResult[];
  blockers: GateEvalResult[];
  escalations: GateEvalResult[];
  downgrades: GateEvalResult[];
}

export function evaluateGates(ctx: GateContext): GateRunResult {
  const results: GateEvalResult[] = [];
  const blockers: GateEvalResult[] = [];
  const escalations: GateEvalResult[] = [];
  const downgrades: GateEvalResult[] = [];

  for (const gate of ALL_GATES) {
    const result = gate(ctx);
    results.push(result);

    // Record to DB
    getDb()
      .prepare(
        `INSERT INTO gate_results (mission_id, gate, verdict, reason, details, timestamp)
         VALUES (@mission_id, @gate, @verdict, @reason, @details, @timestamp)`,
      )
      .run({
        mission_id: ctx.mission.id,
        gate: result.gate,
        verdict: result.verdict,
        reason: result.reason,
        details: result.details ? JSON.stringify(result.details) : null,
        timestamp: new Date().toISOString(),
      });

    if (result.verdict === "block") blockers.push(result);
    if (result.verdict === "escalate") escalations.push(result);
    if (result.verdict === "downgrade") downgrades.push(result);
  }

  const passed = blockers.length === 0 && escalations.length === 0;

  // Emit event
  publish({
    type: passed ? "gate.passed" : "gate.blocked",
    source: { id: "gate_runner", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      mission_id: ctx.mission.id,
      passed,
      blockers: blockers.map((b) => b.gate),
      escalations: escalations.map((e) => e.gate),
      downgrades: downgrades.map((d) => d.gate),
    },
    metadata: null,
  });

  logger.info("Gates evaluated", {
    mission_id: ctx.mission.id,
    passed,
    blockers: blockers.length,
    escalations: escalations.length,
  });

  return { passed, results, blockers, escalations, downgrades };
}
