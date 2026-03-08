import type { Mission, GateName, GateVerdict } from "../types/index.js";
import type { Agent } from "../types/index.js";
import type { Division } from "../types/index.js";

export interface GateContext {
  mission: Mission;
  agent: Agent | null;
  division: Division | null;
  activeMissionCount: number;
  maxParallelMissions: number;
  budgetLimitUsd: number;
  approvalStatus: "none" | "pending" | "approved" | "rejected";
}

export interface GateEvalResult {
  gate: GateName;
  verdict: GateVerdict;
  reason: string;
  details: Record<string, unknown> | null;
}

export type GateEvaluator = (ctx: GateContext) => GateEvalResult;
