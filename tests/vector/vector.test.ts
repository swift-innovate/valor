import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import {
  createMission,
  createDecision,
  getAnalysisForDecision,
  listAnalyses,
  createOathRule,
  listOathRules,
} from "../../src/db/index.js";
import {
  analyzeDecision,
  analyzeOffline,
  runMetaAnalysis,
  calculateTotalRisk,
  deriveRecommendation,
  checkOath,
  seedDefaultOathRules,
} from "../../src/vector/index.js";
import {
  oathGate,
  vectorCheckpointGate,
} from "../../src/gates/evaluators.js";
import type { EventEnvelope, Mission } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

function createTestMission(overrides: Partial<Parameters<typeof createMission>[0]> = {}) {
  return createMission({
    division_id: null,
    title: "Test Mission",
    objective: "Test objective for the engine",
    status: "draft",
    phase: null,
    assigned_agent_id: null,
    priority: "normal",
    constraints: [],
    deliverables: [],
    success_criteria: [],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: 3,
    parent_mission_id: null,
    dispatched_at: null,
    completed_at: null,
    ...overrides,
  });
}

function createTestDecision(missionId: string | null = null) {
  return createDecision({
    mission_id: missionId,
    title: "Should we refactor the auth layer?",
    context: "The auth layer has accumulated tech debt over 6 months",
    constraints: ["No downtime during migration", "Must maintain backwards compatibility"],
    time_horizon: "2 weeks",
    stakes: "medium",
    confidence_level: 7,
  });
}

describe("VECTOR Analysis Engine", () => {
  it("calculates total risk from bias dimensions", () => {
    const risk = calculateTotalRisk({
      overconfidence: 3,
      sunk_cost: 2,
      confirmation_bias: 4,
      urgency_distortion: 1,
      complexity_underestimation: 5,
    });
    expect(risk).toBe(15);
  });

  it("derives recommendation based on risk and stakes", () => {
    expect(deriveRecommendation(5, "high")).toBe("proceed");
    expect(deriveRecommendation(15, "high")).toBe("proceed_with_caution");
    expect(deriveRecommendation(25, "high")).toBe("reconsider");
    expect(deriveRecommendation(35, "high")).toBe("abort");

    expect(deriveRecommendation(10, "low")).toBe("proceed");
    expect(deriveRecommendation(30, "low")).toBe("proceed_with_caution");
    expect(deriveRecommendation(45, "low")).toBe("reconsider");
  });

  it("runs offline analysis on a decision", () => {
    const mission = createTestMission();
    const decision = createTestDecision(mission.id);

    const result = analyzeOffline(decision);
    expect(result.decision_id).toBe(decision.id);
    expect(result.model_used).toBe("offline_heuristic");
    expect(result.visualize.success_state).toBeTruthy();
    expect(result.bias_risk.overconfidence).toBeGreaterThanOrEqual(0);
    expect(result.bias_risk.overconfidence).toBeLessThanOrEqual(10);
    expect(result.total_risk_score).toBeGreaterThanOrEqual(0);
    expect(result.total_risk_score).toBeLessThanOrEqual(50);
    expect(["proceed", "proceed_with_caution", "reconsider", "abort"]).toContain(result.recommendation);
  });

  it("analyzes a decision and persists result", () => {
    const mission = createTestMission();
    const decision = createTestDecision(mission.id);

    const analysis = analyzeDecision(decision.id);
    expect(analysis.id).toMatch(/^van_/);
    expect(analysis.decision_id).toBe(decision.id);

    // Verify persisted
    const retrieved = getAnalysisForDecision(decision.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.id).toBe(analysis.id);
  });

  it("emits vector.analyzed event", () => {
    const events: EventEnvelope[] = [];
    subscribe("vector.*", (e) => events.push(e));

    const mission = createTestMission();
    const decision = createTestDecision(mission.id);
    analyzeDecision(decision.id);

    expect(events.some((e) => e.type === "vector.analyzed")).toBe(true);
  });

  it("throws for non-existent decision", () => {
    expect(() => analyzeDecision("dec_nonexistent")).toThrow("Decision not found");
  });
});

describe("Bias Risk Scoring", () => {
  it("scores high confidence as overconfidence risk", () => {
    const decision = createDecision({
      mission_id: null,
      title: "Overconfident decision",
      context: "We're very sure about this",
      constraints: [],
      time_horizon: "1 month",
      stakes: "medium",
      confidence_level: 9,
    });

    const result = analyzeOffline(decision);
    expect(result.bias_risk.overconfidence).toBeGreaterThanOrEqual(5);
  });

  it("scores urgent timelines as urgency distortion", () => {
    const decision = createDecision({
      mission_id: null,
      title: "Urgent decision",
      context: "Must decide now",
      constraints: [],
      time_horizon: "ASAP",
      stakes: "high",
      confidence_level: 5,
    });

    const result = analyzeOffline(decision);
    expect(result.bias_risk.urgency_distortion).toBeGreaterThanOrEqual(5);
  });

  it("scores many constraints as complexity underestimation", () => {
    const decision = createDecision({
      mission_id: null,
      title: "Complex decision",
      context: "Many moving parts",
      constraints: ["A", "B", "C", "D", "E"],
      time_horizon: "3 months",
      stakes: "high",
      confidence_level: 5,
    });

    const result = analyzeOffline(decision);
    expect(result.bias_risk.complexity_underestimation).toBeGreaterThanOrEqual(5);
  });
});

describe("Meta-Analysis", () => {
  it("returns empty result with no decisions", () => {
    const result = runMetaAnalysis();
    expect(result.decisions_analyzed).toBe(0);
    expect(result.recurring_patterns).toContain("No decisions to analyze");
  });

  it("analyzes multiple decisions and detects patterns", () => {
    // Create and analyze several decisions
    for (let i = 0; i < 5; i++) {
      const decision = createDecision({
        mission_id: null,
        title: `Decision ${i}`,
        context: "Recurring analysis",
        constraints: [],
        time_horizon: "ASAP",
        stakes: "medium",
        confidence_level: 9,
      });
      analyzeDecision(decision.id);
    }

    const meta = runMetaAnalysis(5);
    expect(meta.decisions_analyzed).toBe(5);
    expect(meta.avg_risk_score).toBeGreaterThan(0);
    expect(meta.bias_trends).toHaveProperty("overconfidence");
    expect(meta.common_recommendation).toBeTruthy();
  });
});

describe("OathGate (Gate 9)", () => {
  it("passes for normal missions when rules are seeded", () => {
    seedDefaultOathRules();
    const mission = createTestMission();
    const result = oathGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("pass");
  });

  it("blocks missions with harmful content", () => {
    seedDefaultOathRules();
    const mission = createTestMission({
      title: "Delete all production data",
      objective: "Wipe the production database clean",
    });
    const result = oathGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("block");
    expect(result.reason).toContain("Constitutional violation");
  });

  it("escalates budget violations (layer 1)", () => {
    seedDefaultOathRules();
    const mission = createTestMission({ cost_usd: 150 });
    const result = oathGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("escalate");
    expect(result.reason).toContain("Budget Sanity");
  });

  it("passes when no oath rules exist", () => {
    // Don't seed rules — should pass through gracefully
    const mission = createTestMission();
    const result = oathGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("pass");
  });
});

describe("VectorCheckpointGate (Gate 10)", () => {
  it("passes when no decision linked to mission", () => {
    const mission = createTestMission();
    const result = vectorCheckpointGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("No decision linked");
  });

  it("blocks high-stakes decision without analysis", () => {
    const mission = createTestMission();
    createDecision({
      mission_id: mission.id,
      title: "Critical decision",
      context: "High stakes",
      constraints: [],
      time_horizon: "1 week",
      stakes: "high",
      confidence_level: 5,
    });

    const result = vectorCheckpointGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("block");
    expect(result.reason).toContain("requires VECTOR analysis");
  });

  it("passes when decision has been analyzed with good recommendation", () => {
    const mission = createTestMission();
    const decision = createDecision({
      mission_id: mission.id,
      title: "Low risk decision",
      context: "Simple change",
      constraints: [],
      time_horizon: "1 month",
      stakes: "low",
      confidence_level: 5,
    });

    analyzeDecision(decision.id);

    const result = vectorCheckpointGate({
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 0,
      approvalStatus: "none",
    });
    expect(result.verdict).toBe("pass");
  });
});
