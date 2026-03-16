import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import { createMission } from "../../src/db/index.js";
import { getDb } from "../../src/db/database.js";
import {
  missionStateGate,
  convergenceGate,
  revisionCapGate,
  healthGate,
  budgetGate,
  concurrencyGate,
  hilGate,
  evaluateGates,
} from "../../src/gates/index.js";
import type { GateContext } from "../../src/gates/types.js";
import type { Mission, Agent, Division, EventEnvelope } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});
afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

function baseMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mis_test",
    division_id: null,
    title: "Test",
    objective: "Do the thing",
    status: "queued",
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
    created_at: "2026-03-08T00:00:00Z",
    updated_at: "2026-03-08T00:00:00Z",
    dispatched_at: null,
    completed_at: null,
    ...overrides,
  };
}

function baseContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    mission: baseMission(),
    agent: null,
    division: null,
    activeMissionCount: 0,
    maxParallelMissions: 10,
    budgetLimitUsd: 0,
    approvalStatus: "none",
    ...overrides,
  };
}

describe("Individual Gates", () => {
  describe("MissionStateGate", () => {
    it("passes for queued missions", () => {
      const result = missionStateGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("blocks non-dispatchable states", () => {
      const result = missionStateGate(baseContext({
        mission: baseMission({ status: "draft" }),
      }));
      expect(result.verdict).toBe("block");
    });
  });

  describe("RevisionCapGate", () => {
    it("passes when under cap", () => {
      const result = revisionCapGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("blocks at cap", () => {
      const result = revisionCapGate(baseContext({
        mission: baseMission({ revision_count: 3, max_revisions: 3 }),
      }));
      expect(result.verdict).toBe("block");
    });
  });

  describe("ConvergenceGate", () => {
    it("passes with low revision count", () => {
      const result = convergenceGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("downgrades near cap", () => {
      const result = convergenceGate(baseContext({
        mission: baseMission({ revision_count: 2, max_revisions: 3 }),
      }));
      expect(result.verdict).toBe("downgrade");
    });
  });

  describe("HealthGate", () => {
    it("passes with no agent assigned", () => {
      const result = healthGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("passes with healthy agent", () => {
      const agent: Agent = {
        id: "agt_test", callsign: "Test", division_id: null, runtime: "openclaw",
        endpoint_url: null, model: null, health_status: "healthy",
        last_heartbeat: null, persona_id: null, capabilities: [],
        created_at: "", updated_at: "",
      };
      const result = healthGate(baseContext({ agent }));
      expect(result.verdict).toBe("pass");
    });

    it("blocks offline agent", () => {
      const agent: Agent = {
        id: "agt_test", callsign: "Test", division_id: null, runtime: "openclaw",
        endpoint_url: null, model: null, health_status: "offline",
        last_heartbeat: null, persona_id: null, capabilities: [],
        created_at: "", updated_at: "",
      };
      const result = healthGate(baseContext({ agent }));
      expect(result.verdict).toBe("block");
    });

    it("downgrades degraded agent", () => {
      const agent: Agent = {
        id: "agt_test", callsign: "Test", division_id: null, runtime: "openclaw",
        endpoint_url: null, model: null, health_status: "degraded",
        last_heartbeat: null, persona_id: null, capabilities: [],
        created_at: "", updated_at: "",
      };
      const result = healthGate(baseContext({ agent }));
      expect(result.verdict).toBe("downgrade");
    });
  });

  describe("BudgetGate", () => {
    it("passes with no budget limit", () => {
      const result = budgetGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("passes when under budget", () => {
      const result = budgetGate(baseContext({
        mission: baseMission({ cost_usd: 5 }),
        budgetLimitUsd: 10,
      }));
      expect(result.verdict).toBe("pass");
    });

    it("blocks when over budget", () => {
      const result = budgetGate(baseContext({
        mission: baseMission({ cost_usd: 15 }),
        budgetLimitUsd: 10,
      }));
      expect(result.verdict).toBe("block");
    });
  });

  describe("ConcurrencyGate", () => {
    it("passes when under limit", () => {
      const result = concurrencyGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("blocks at limit", () => {
      const result = concurrencyGate(baseContext({
        activeMissionCount: 10,
        maxParallelMissions: 10,
      }));
      expect(result.verdict).toBe("block");
    });
  });

  describe("HILGate", () => {
    it("passes when no division (no policy)", () => {
      const result = hilGate(baseContext());
      expect(result.verdict).toBe("pass");
    });

    it("escalates when auto_dispatch disabled and no approval", () => {
      const division: Division = {
        id: "div_test", name: "Test", lead_agent_id: null,
        autonomy_policy: {
          max_cost_autonomous_usd: 10,
          approval_required_actions: [],
          auto_dispatch_enabled: false,
        },
        escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
        namespace: "test", created_at: "", updated_at: "",
      };
      const result = hilGate(baseContext({ division }));
      expect(result.verdict).toBe("escalate");
    });

    it("passes when auto_dispatch disabled but approval granted", () => {
      const division: Division = {
        id: "div_test", name: "Test", lead_agent_id: null,
        autonomy_policy: {
          max_cost_autonomous_usd: 10,
          approval_required_actions: [],
          auto_dispatch_enabled: false,
        },
        escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
        namespace: "test", created_at: "", updated_at: "",
      };
      const result = hilGate(baseContext({ division, approvalStatus: "approved" }));
      expect(result.verdict).toBe("pass");
    });
  });
});

describe("Gate Runner", () => {
  it("evaluates enabled gates (default config disables 3)", () => {
    const mission = createMission({
      division_id: null, title: "Gate Test", objective: "Test", status: "queued",
      phase: null, assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });
    const result = evaluateGates(baseContext({ mission }));
    // Default config disables artifact_integrity, oath, vector_checkpoint (3 gates)
    expect(result.results).toHaveLength(7);
    expect(result.passed).toBe(true);
  });

  it("reports blockers", () => {
    const mission = createMission({
      division_id: null, title: "Draft Gate Test", objective: "Test", status: "draft",
      phase: null, assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });
    const result = evaluateGates(baseContext({ mission }));
    expect(result.passed).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("emits gate events on bus", () => {
    const mission = createMission({
      division_id: null, title: "Event Gate Test", objective: "Test", status: "queued",
      phase: null, assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });
    const events: EventEnvelope[] = [];
    subscribe("gate.*", (e) => events.push(e));

    evaluateGates(baseContext({ mission }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("gate.passed");
  });

  it("records results to gate_results table", () => {
    const mission = createMission({
      division_id: null, title: "Record Gate Test", objective: "Test", status: "queued",
      phase: null, assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });
    evaluateGates(baseContext({ mission }));

    const rows = getDb().prepare("SELECT * FROM gate_results WHERE mission_id = ?").all(mission.id);
    // Default config disables artifact_integrity, oath, vector_checkpoint (3 gates)
    expect(rows).toHaveLength(7);
  });
});
