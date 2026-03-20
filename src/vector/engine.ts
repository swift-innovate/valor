import {
  getDecision,
  createAnalysis,
  listAnalyses,
} from "../db/index.js";
import { logger } from "../utils/logger.js";
import { publish } from "../bus/index.js";
import type {
  Decision,
  VectorAnalysis,
  BiasRisk,
} from "../types/index.js";

const VECTOR_SYSTEM_PROMPT = `You are the VECTOR Decision Engine.

You analyze decisions using the VECTOR framework:
V - Visualize future states clearly.
E - Evaluate system-level consequences.
C - Choose based on optionality and reversibility.
T - Design fast, contained experiments.
O - Optimize friction and constraint misalignment.
R - Create structured review loops.

You are adversarial and precise. You do not validate the user.
You return strict JSON only. No commentary outside JSON.`;

/**
 * Build the analysis prompt for a decision.
 */
function buildAnalysisPrompt(decision: Decision): string {
  return `Analyze this decision using the VECTOR framework. Return strict JSON only.

Decision: ${decision.title}
Context: ${decision.context}
Constraints: ${decision.constraints.join(", ") || "None specified"}
Time Horizon: ${decision.time_horizon}
Stakes: ${decision.stakes}
Confidence Level: ${decision.confidence_level}/10

Return this exact JSON structure:
{
  "visualize": { "success_state": "string", "failure_state": "string", "hidden_costs": ["string"] },
  "evaluate": { "system_dependencies": ["string"], "second_order_effects": ["string"], "constraint_conflicts": ["string"] },
  "choose": { "reversibility_score": 0-10, "optionality_score": 0-10, "capital_intensity": "low|medium|high", "risk_profile": "string" },
  "test": { "minimum_viable_test": "string", "success_metric": "string", "kill_signal": "string", "timeframe": "string" },
  "optimize": { "friction_points": ["string"], "automation_candidates": ["string"], "assumption_risks": ["string"] },
  "review": { "recommended_checkpoints_days": [30, 90], "review_questions": ["string"] },
  "bias_risk": { "overconfidence": 0-10, "sunk_cost": 0-10, "confirmation_bias": 0-10, "urgency_distortion": 0-10, "complexity_underestimation": 0-10 }
}`;
}

/**
 * Calculate total risk score from bias dimensions.
 */
export function calculateTotalRisk(bias: BiasRisk): number {
  return bias.overconfidence + bias.sunk_cost + bias.confirmation_bias +
    bias.urgency_distortion + bias.complexity_underestimation;
}

/**
 * Derive recommendation from risk score and stakes.
 */
export function deriveRecommendation(
  totalRisk: number,
  stakes: string,
): "proceed" | "proceed_with_caution" | "reconsider" | "abort" {
  if (stakes === "high") {
    if (totalRisk >= 30) return "abort";
    if (totalRisk >= 20) return "reconsider";
    if (totalRisk >= 10) return "proceed_with_caution";
    return "proceed";
  }
  if (stakes === "medium") {
    if (totalRisk >= 35) return "abort";
    if (totalRisk >= 25) return "reconsider";
    if (totalRisk >= 15) return "proceed_with_caution";
    return "proceed";
  }
  // low stakes
  if (totalRisk >= 40) return "reconsider";
  if (totalRisk >= 25) return "proceed_with_caution";
  return "proceed";
}

/**
 * Run a local/offline VECTOR analysis without LLM.
 * Uses heuristic analysis based on decision metadata.
 * This is the fallback when no provider is available.
 */
export function analyzeOffline(decision: Decision): Omit<VectorAnalysis, "id" | "created_at"> {
  const highStakes = decision.stakes === "high";
  const manyConstraints = decision.constraints.length > 3;
  const lowConfidence = decision.confidence_level <= 4;

  const bias: BiasRisk = {
    overconfidence: decision.confidence_level >= 8 ? 7 : decision.confidence_level >= 6 ? 4 : 1,
    sunk_cost: decision.constraints.some((c) => c.toLowerCase().includes("invest")) ? 5 : 2,
    confirmation_bias: lowConfidence ? 3 : 5,
    urgency_distortion: decision.time_horizon.toLowerCase().includes("urgent") ||
      decision.time_horizon.toLowerCase().includes("asap") ? 7 : 2,
    complexity_underestimation: manyConstraints ? 6 : highStakes ? 5 : 2,
  };

  const totalRisk = calculateTotalRisk(bias);
  const recommendation = deriveRecommendation(totalRisk, decision.stakes);

  return {
    decision_id: decision.id,
    visualize: {
      success_state: `${decision.title} succeeds within ${decision.time_horizon}`,
      failure_state: `${decision.title} fails, requiring rollback`,
      hidden_costs: manyConstraints
        ? ["Constraint interactions may create unforeseen friction"]
        : ["Minimal hidden costs identified"],
    },
    evaluate: {
      system_dependencies: decision.constraints.slice(0, 3),
      second_order_effects: highStakes
        ? ["High-stakes failure cascades to dependent systems"]
        : ["Limited second-order impact expected"],
      constraint_conflicts: manyConstraints
        ? ["Multiple constraints may conflict under pressure"]
        : [],
    },
    choose: {
      reversibility_score: highStakes ? 3 : 7,
      optionality_score: manyConstraints ? 4 : 7,
      capital_intensity: highStakes ? "high" : "low",
      risk_profile: `${decision.stakes} stakes, ${decision.confidence_level}/10 confidence`,
    },
    test: {
      minimum_viable_test: `Validate core assumption of "${decision.title}" in isolated scope`,
      success_metric: "Defined objective met within constraints",
      kill_signal: "2+ constraints violated or confidence drops below 3",
      timeframe: decision.time_horizon,
    },
    optimize: {
      friction_points: decision.constraints.length > 0
        ? [`${decision.constraints.length} constraints to manage`]
        : [],
      automation_candidates: ["Status reporting", "Checkpoint scheduling"],
      assumption_risks: lowConfidence
        ? ["Low confidence suggests unvalidated assumptions"]
        : [],
    },
    review: {
      recommended_checkpoints_days: highStakes ? [7, 30, 90] : [30, 90],
      review_questions: [
        "Are initial assumptions still valid?",
        "Have constraints changed since decision?",
        "Is the original objective still the right one?",
      ],
    },
    bias_risk: bias,
    model_used: "offline_heuristic",
    total_risk_score: totalRisk,
    recommendation,
  };
}

/**
 * Run VECTOR analysis on a decision.
 * Uses offline heuristics. LLM-powered analysis is a future upgrade
 * that will use the provider layer to call a model with the VECTOR prompt.
 */
export function analyzeDecision(decisionId: string): VectorAnalysis {
  const decision = getDecision(decisionId);
  if (!decision) {
    throw new Error(`Decision not found: ${decisionId}`);
  }

  const analysisInput = analyzeOffline(decision);
  const analysis = createAnalysis(analysisInput);

  publish({
    type: "vector.analyzed",
    source: { id: "vector_engine", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      decision_id: decision.id,
      mission_id: decision.mission_id,
      recommendation: analysis.recommendation,
      total_risk: analysis.total_risk_score,
      stakes: decision.stakes,
    },
    metadata: null,
  });

  logger.info("VECTOR analysis complete", {
    decision_id: decision.id,
    recommendation: analysis.recommendation,
    risk_score: analysis.total_risk_score,
  });

  return analysis;
}

// --- Meta-Analysis ---

export interface MetaAnalysisResult {
  decisions_analyzed: number;
  avg_risk_score: number;
  bias_trends: Record<string, number>;
  common_recommendation: string;
  recurring_patterns: string[];
}

/**
 * Run meta-analysis across recent decisions to detect patterns.
 */
export function runMetaAnalysis(limit = 10): MetaAnalysisResult {
  const analyses = listAnalyses(limit);

  if (analyses.length === 0) {
    return {
      decisions_analyzed: 0,
      avg_risk_score: 0,
      bias_trends: {},
      common_recommendation: "none",
      recurring_patterns: ["No decisions to analyze"],
    };
  }

  // Calculate averages
  const avgRisk = analyses.reduce((sum, a) => sum + a.total_risk_score, 0) / analyses.length;

  // Track bias dimension averages
  const biasSums = { overconfidence: 0, sunk_cost: 0, confirmation_bias: 0, urgency_distortion: 0, complexity_underestimation: 0 };
  for (const a of analyses) {
    biasSums.overconfidence += a.bias_risk.overconfidence;
    biasSums.sunk_cost += a.bias_risk.sunk_cost;
    biasSums.confirmation_bias += a.bias_risk.confirmation_bias;
    biasSums.urgency_distortion += a.bias_risk.urgency_distortion;
    biasSums.complexity_underestimation += a.bias_risk.complexity_underestimation;
  }
  const biasTrends: Record<string, number> = {};
  for (const [key, sum] of Object.entries(biasSums)) {
    biasTrends[key] = Math.round((sum / analyses.length) * 10) / 10;
  }

  // Find most common recommendation
  const recCounts: Record<string, number> = {};
  for (const a of analyses) {
    recCounts[a.recommendation] = (recCounts[a.recommendation] || 0) + 1;
  }
  const commonRec = Object.entries(recCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Detect patterns
  const patterns: string[] = [];
  const highBiasThreshold = 5;
  for (const [dimension, avg] of Object.entries(biasTrends)) {
    if (avg >= highBiasThreshold) {
      patterns.push(`Recurring high ${dimension.replace(/_/g, " ")} (avg: ${avg}/10)`);
    }
  }
  if (avgRisk >= 25) {
    patterns.push(`Consistently high risk scores (avg: ${avgRisk.toFixed(1)}/50)`);
  }
  if (patterns.length === 0) {
    patterns.push("No concerning patterns detected");
  }

  const result: MetaAnalysisResult = {
    decisions_analyzed: analyses.length,
    avg_risk_score: Math.round(avgRisk * 10) / 10,
    bias_trends: biasTrends,
    common_recommendation: commonRec,
    recurring_patterns: patterns,
  };

  publish({
    type: "vector.meta_analyzed",
    source: { id: "vector_engine", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { ...result },
    metadata: null,
  });

  return result;
}
