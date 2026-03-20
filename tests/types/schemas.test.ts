import { describe, it, expect } from "vitest";
import {
  MissionSchema,
  MissionStatus,
  MissionPhase,
  MissionPriority,
  MISSION_TRANSITIONS,
  AgentSchema,
  AgentStatus,
  AgentRuntime,
  DivisionSchema,
  EventEnvelopeSchema,
  GateResultSchema,
  GateName,
  GateVerdict,
  SitrepSchema,
  EngineErrorSchema,
  StreamEventSchema,
  WALEntrySchema,
} from "../../src/types/index.js";

describe("MissionSchema", () => {
  const validMission = {
    id: "mis_abc123",
    division_id: "div_xyz",
    title: "Test Mission",
    objective: "Do the thing",
    status: "draft" as const,
    phase: null,
    assigned_agent_id: null,
    priority: "normal" as const,
    constraints: ["no budget over $5"],
    deliverables: ["report.md"],
    success_criteria: ["report exists"],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: 3,
    parent_mission_id: null,
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
    dispatched_at: null,
    completed_at: null,
  };

  it("validates a correct mission", () => {
    const result = MissionSchema.safeParse(validMission);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = MissionSchema.safeParse({ ...validMission, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = MissionSchema.safeParse({ ...validMission, status: "running" });
    expect(result.success).toBe(false);
  });

  it("rejects negative cost", () => {
    const result = MissionSchema.safeParse({ ...validMission, cost_usd: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts token_usage object", () => {
    const result = MissionSchema.safeParse({
      ...validMission,
      token_usage: { input: 100, output: 50, total: 150 },
    });
    expect(result.success).toBe(true);
  });
});

describe("MissionStatus transitions", () => {
  it("draft can transition to queued or aborted", () => {
    expect(MISSION_TRANSITIONS.draft).toEqual(["queued", "aborted"]);
  });

  it("aar_complete is terminal", () => {
    expect(MISSION_TRANSITIONS.aar_complete).toEqual([]);
  });

  it("aborted is terminal", () => {
    expect(MISSION_TRANSITIONS.aborted).toEqual([]);
  });

  it("failed can retry via queued", () => {
    expect(MISSION_TRANSITIONS.failed).toContain("queued");
  });
});

describe("AgentSchema", () => {
  const validAgent = {
    id: "agt_abc123",
    callsign: "Mira",
    division_id: null,
    runtime: "openclaw" as const,
    endpoint_url: "http://localhost:3000",
    model: "claude-sonnet-4-20250514",
    health_status: "healthy" as const,
    last_heartbeat: "2026-03-07T00:00:00.000Z",
    persona_id: null,
    capabilities: ["chat", "code"],
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
  };

  it("validates a correct agent", () => {
    expect(AgentSchema.safeParse(validAgent).success).toBe(true);
  });

  it("rejects empty callsign", () => {
    expect(AgentSchema.safeParse({ ...validAgent, callsign: "" }).success).toBe(false);
  });

  it("rejects invalid runtime", () => {
    expect(AgentSchema.safeParse({ ...validAgent, runtime: "langchain" }).success).toBe(false);
  });
});

describe("DivisionSchema", () => {
  const validDivision = {
    id: "div_abc123",
    name: "Code Division",
    lead_agent_id: "agt_gage",
    autonomy_policy: {
      max_cost_autonomous_usd: 10,
      approval_required_actions: ["deploy"],
      auto_dispatch_enabled: true,
    },
    escalation_policy: {
      escalate_to: "director",
      escalate_after_failures: 3,
      escalate_on_budget_breach: true,
    },
    namespace: "code",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
  };

  it("validates a correct division", () => {
    expect(DivisionSchema.safeParse(validDivision).success).toBe(true);
  });

  it("rejects negative cost policy", () => {
    const bad = {
      ...validDivision,
      autonomy_policy: { ...validDivision.autonomy_policy, max_cost_autonomous_usd: -5 },
    };
    expect(DivisionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("EventEnvelopeSchema", () => {
  const validEvent = {
    id: "evt_abc123",
    type: "mission.created",
    timestamp: "2026-03-07T00:00:00.000Z",
    source: { id: "system", type: "system" as const },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: "mis_abc" },
    metadata: null,
  };

  it("validates a correct event", () => {
    expect(EventEnvelopeSchema.safeParse(validEvent).success).toBe(true);
  });

  it("rejects empty type", () => {
    expect(EventEnvelopeSchema.safeParse({ ...validEvent, type: "" }).success).toBe(false);
  });

  it("rejects invalid actor type", () => {
    const bad = { ...validEvent, source: { id: "x", type: "alien" } };
    expect(EventEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("GateResultSchema", () => {
  it("validates a pass verdict", () => {
    const result = GateResultSchema.safeParse({
      gate: "budget",
      verdict: "pass",
      reason: "Under budget",
      details: null,
      timestamp: "2026-03-07T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid gate name", () => {
    const result = GateResultSchema.safeParse({
      gate: "nonexistent_gate",
      verdict: "pass",
      reason: "test",
      details: null,
      timestamp: "2026-03-07T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("WALEntrySchema", () => {
  it("validates a create operation", () => {
    const result = WALEntrySchema.safeParse({
      id: "wal_abc",
      entity_type: "mission",
      entity_id: "mis_abc",
      operation: "create",
      before_state: null,
      after_state: '{"status":"draft"}',
      actor_id: "system",
      timestamp: "2026-03-07T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid operation", () => {
    const result = WALEntrySchema.safeParse({
      id: "wal_abc",
      entity_type: "mission",
      entity_id: "mis_abc",
      operation: "upsert",
      before_state: null,
      after_state: null,
      actor_id: "system",
      timestamp: "2026-03-07T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
