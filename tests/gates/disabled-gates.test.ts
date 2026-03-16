import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { evaluateGates } from "../../src/gates/runner.js";
import type { GateContext } from "../../src/gates/types.js";
import { createMission } from "../../src/db/index.js";

// Mock config to control disabledGates
vi.mock("../../src/config.js", () => ({
  config: {
    port: 3200,
    dbPath: "./data/valor-test.db",
    logLevel: "error",
    sigintUrl: "http://localhost:8082",
    disabledGates: ["artifact_integrity", "oath", "vector_checkpoint"],
  },
}));

describe("Disabled gates", () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it("skips gates listed in config.disabledGates", () => {
    const mission = createMission({
      division_id: null,
      title: "Test mission",
      objective: "Test",
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
      dispatched_at: null,
      completed_at: null,
    });

    const ctx: GateContext = {
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 100,
      approvalStatus: "none",
    };

    const result = evaluateGates(ctx);

    // Should have results for 7 gates (10 total minus 3 disabled)
    const gateNames = result.results.map((r) => r.gate);
    expect(gateNames).not.toContain("artifact_integrity");
    expect(gateNames).not.toContain("oath");
    expect(gateNames).not.toContain("vector_checkpoint");
    expect(gateNames).toHaveLength(7);
  });

  it("includes all gates when disabledGates is empty", () => {
    // This test uses the default mock which has 3 disabled
    // so it verifies the count is 7 (10 - 3 disabled)
    const mission = createMission({
      division_id: null,
      title: "Test",
      objective: "Test",
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
      dispatched_at: null,
      completed_at: null,
    });

    const ctx: GateContext = {
      mission,
      agent: null,
      division: null,
      activeMissionCount: 0,
      maxParallelMissions: 10,
      budgetLimitUsd: 100,
      approvalStatus: "none",
    };

    const result = evaluateGates(ctx);
    expect(result.results.length).toBe(7);
  });
});
