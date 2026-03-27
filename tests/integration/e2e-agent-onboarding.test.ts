/**
 * E2E Agent Onboarding + Mission Lifecycle Integration Test
 *
 * Validates the complete agent onboarding and mission execution flow:
 * 1. Register a division
 * 2. Submit an agent card
 * 3. Approve the agent card (creates agent automatically)
 * 4. Create and assign a mission to the agent
 * 5. Agent checks inbox, sees mission
 * 6. Agent accepts mission (transition to dispatched)
 * 7. Agent submits sitreps
 * 8. Agent submits artifacts
 * 9. Agent completes mission
 * 10. Verify everything is recorded
 *
 * Also tests edge cases: wrong agent, wrong state, non-existent mission, double-complete.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";
import { missionRoutes } from "../../src/api/missions.js";
import { divisionRoutes } from "../../src/api/divisions.js";
import { agentCardRoutes } from "../../src/api/agent-cards.js";
import { agentRoutes } from "../../src/api/agents.js";
import { sitrepRoutes } from "../../src/api/sitreps.js";
import { artifactRoutes } from "../../src/api/artifacts.js";

// ── Test app with all routes wired up ────────────────────────────────

const app = new Hono();
app.route("/agent-cards", agentCardRoutes);
app.route("/divisions", divisionRoutes);
app.route("/missions", missionRoutes);
app.route("/agents", agentRoutes);
app.route("/sitreps", sitrepRoutes);
app.route("/artifacts", artifactRoutes);

// ── Constants ────────────────────────────────────────────────────────

const DIRECTOR = { "X-VALOR-Role": "director" } as const;
const JSON_CT = { "Content-Type": "application/json" } as const;
const DIRECTOR_JSON = { ...DIRECTOR, ...JSON_CT };

// ── Shared state across the happy-path describe block ────────────────

let divisionId: string;
let agentCardId: string;
let agentId: string;
let missionId: string;

// Second agent for edge-case tests
let otherAgentCardId: string;
let otherAgentId: string;

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeAll(() => {
  freshDb();
  clearSubscriptions();
});

afterAll(() => {
  clearSubscriptions();
  cleanupDb();
});

// ── Helpers ──────────────────────────────────────────────────────────

async function post(path: string, body: unknown, headers: Record<string, string> = DIRECTOR_JSON) {
  return app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown, headers: Record<string, string> = DIRECTOR_JSON) {
  return app.request(path, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return app.request(path);
}

// =====================================================================
// Happy Path: Full Onboarding + Mission Lifecycle
// =====================================================================

describe("E2E Agent Onboarding + Mission Lifecycle", () => {
  // ── Step 1: Register a division ──────────────────────────────────

  it("Step 1: creates a division", async () => {
    const res = await post("/divisions", {
      name: "Test Division",
      namespace: "test_div",
      autonomy_policy: {
        max_cost_autonomous_usd: 50,
        approval_required_actions: [],
        auto_dispatch_enabled: true,
      },
      escalation_policy: {
        escalate_to: "director",
        escalate_after_failures: 3,
        escalate_on_budget_breach: true,
      },
    });

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toMatch(/^div_/);
    divisionId = data.id as string;
  });

  // ── Step 2: Submit an agent card ─────────────────────────────────

  it("Step 2: submits an agent card for test-agent", async () => {
    const res = await post("/agent-cards", {
      callsign: "test-agent",
      name: "Test Agent — E2E Operative",
      operator: "SIT",
      runtime: "claude_api",
      primary_skills: ["testing", "integration"],
      model: "claude-sonnet-4-20250514",
      description: "E2E test operative for onboarding validation.",
    }, JSON_CT);  // No director header needed — cards are open for submission

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toMatch(/^acd_/);
    expect(data.approval_status).toBe("pending");
    expect(data.callsign).toBe("test-agent");
    agentCardId = data.id as string;
  });

  // ── Step 2b: Submit a second agent card for edge-case tests ──────

  it("Step 2b: submits a second agent card for other-agent", async () => {
    const res = await post("/agent-cards", {
      callsign: "other-agent",
      name: "Other Agent",
      operator: "SIT",
      runtime: "claude_api",
      primary_skills: ["misc"],
      description: "Second agent for edge-case tests.",
    }, JSON_CT);

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    otherAgentCardId = data.id as string;
  });

  // ── Step 3: Approve the agent card ───────────────────────────────

  it("Step 3: approves the agent card (creates agent)", async () => {
    const res = await post(`/agent-cards/${agentCardId}/approve`, {
      approved_by: "director",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.approval_status).toBe("approved");
    expect(data.agent_id).toMatch(/^agt_/);
    agentId = data.agent_id as string;
  });

  it("Step 3b: approves other-agent card", async () => {
    const res = await post(`/agent-cards/${otherAgentCardId}/approve`, {
      approved_by: "director",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    otherAgentId = data.agent_id as string;
  });

  // ── Step 3c: Verify agent exists via GET ─────────────────────────

  it("Step 3c: agent is retrievable after card approval", async () => {
    const res = await get(`/agents/${agentId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.callsign).toBe("test-agent");
    expect(data.health_status).toBe("registered");
  });

  // ── Step 4: Create a mission assigned to the agent ───────────────

  it("Step 4: creates a mission assigned to test-agent", async () => {
    const res = await post("/missions", {
      title: "E2E Test Mission",
      objective: "Validate the full agent onboarding and mission lifecycle flow.",
      priority: "normal",
      division_id: divisionId,
      assigned_agent_id: agentId,
      constraints: ["Must complete within test timeout"],
      deliverables: ["Test report"],
      success_criteria: ["All assertions pass"],
    });

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toMatch(/^mis_/);
    expect(data.status).toBe("draft");
    expect(data.assigned_agent_id).toBe(agentId);
    expect(data.division_id).toBe(divisionId);
    missionId = data.id as string;
  });

  // ── Step 5: Agent checks inbox for assigned missions ─────────────

  it("Step 5: agent sees the mission in their missions list", async () => {
    const res = await get(`/agents/${agentId}/missions`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>[];
    expect(data.length).toBeGreaterThanOrEqual(1);

    const assigned = data.find((m) => m.id === missionId);
    expect(assigned).toBeDefined();
    expect(assigned!.status).toBe("draft");
    expect(assigned!.title).toBe("E2E Test Mission");
  });

  // ── Step 6: Queue and dispatch the mission ───────────────────────
  // The mission lifecycle is: draft → queued → gated → dispatched
  // Since we don't have a provider running, we test the state machine
  // transitions that an agent would trigger.

  it("Step 6a: queues the mission", async () => {
    const res = await post(`/missions/${missionId}/queue`, {});
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("queued");
  });

  // Note: dispatch requires either a provider or an agent endpoint_url.
  // For this test we manually transition through the state machine using
  // the DB directly, simulating what the orchestrator would do.

  it("Step 6b: transitions mission through gated → dispatched → streaming", async () => {
    // Import transition function directly for state machine testing
    const { transitionMission } = await import("../../src/db/repositories/mission-repo.js");
    transitionMission(missionId, "gated");
    transitionMission(missionId, "dispatched");
    transitionMission(missionId, "streaming");

    const res = await get(`/missions/${missionId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("streaming");
    expect(data.dispatched_at).toBeTruthy();
  });

  // ── Step 7: Agent submits a sitrep ───────────────────────────────

  it("Step 7a: agent submits a progress sitrep", async () => {
    const res = await post("/sitreps", {
      mission_id: missionId,
      agent_id: agentId,
      phase: "V",
      status: "green",
      summary: "Making progress on the E2E test mission. Phase V — validating approach.",
      objectives_complete: ["Initial analysis"],
      objectives_pending: ["Run test suite", "Generate report"],
      confidence: "medium",
      tokens_used: 1500,
    }, JSON_CT);

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toMatch(/^sit_/);
    expect(data.mission_id).toBe(missionId);
    expect(data.agent_id).toBe(agentId);
    expect(data.phase).toBe("V");
    expect(data.status).toBe("green");
  });

  it("Step 7b: agent submits a second sitrep for phase A", async () => {
    const res = await post("/sitreps", {
      mission_id: missionId,
      agent_id: agentId,
      phase: "A",
      status: "green",
      summary: "Phase A — all approach validated, executing deliverables.",
      objectives_complete: ["Initial analysis", "Run test suite"],
      objectives_pending: ["Generate report"],
      confidence: "high",
      tokens_used: 2000,
    }, JSON_CT);

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.phase).toBe("A");
  });

  // ── Step 8: Agent submits an artifact ────────────────────────────

  it("Step 8: agent submits an artifact", async () => {
    const res = await post("/artifacts", {
      title: "e2e-test-report.md",
      content_type: "markdown",
      content: "# E2E Test Report\n\nAll integration tests passed.\n\n## Summary\n- Agent onboarding: OK\n- Mission lifecycle: OK\n- Sitreps: OK\n- Artifacts: OK\n",
      summary: "E2E test report documenting full lifecycle validation",
      created_by: agentId,
      conversation_id: missionId,
    }, JSON_CT);

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toMatch(/^art_/);
    expect(data.title).toBe("e2e-test-report.md");
    expect(data.content_type).toBe("markdown");
    expect(data.created_by).toBe(agentId);
    expect(data.conversation_id).toBe(missionId);
    expect(data.version).toBe(1);
  });

  // ── Step 9: Complete the mission ─────────────────────────────────

  it("Step 9: mission completes through the state machine", async () => {
    const { transitionMission } = await import("../../src/db/repositories/mission-repo.js");

    // streaming → complete → aar_pending → aar_complete
    transitionMission(missionId, "complete");
    transitionMission(missionId, "aar_pending");
    transitionMission(missionId, "aar_complete");

    const res = await get(`/missions/${missionId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("aar_complete");
    expect(data.completed_at).toBeTruthy();
  });

  // ── Step 10: Verify everything is recorded ───────────────────────

  it("Step 10a: mission shows as aar_complete", async () => {
    const res = await get(`/missions/${missionId}`);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("aar_complete");
    expect(data.assigned_agent_id).toBe(agentId);
    expect(data.division_id).toBe(divisionId);
  });

  it("Step 10b: sitreps are recorded for the mission", async () => {
    const res = await get(`/sitreps?mission_id=${missionId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>[];
    expect(data.length).toBe(2);

    const phases = data.map((s) => s.phase);
    expect(phases).toContain("V");
    expect(phases).toContain("A");
  });

  it("Step 10c: artifacts are attached via conversation_id", async () => {
    const res = await get(`/artifacts/conversation/${missionId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>[];
    expect(data.length).toBe(1);
    expect(data[0].title).toBe("e2e-test-report.md");
    expect(data[0].created_by).toBe(agentId);
  });

  it("Step 10d: agent's mission list shows the completed mission", async () => {
    const res = await get(`/agents/${agentId}/missions`);
    const data = await res.json() as Record<string, unknown>[];
    const completed = data.find((m) => m.id === missionId);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("aar_complete");
  });
});

// =====================================================================
// Edge Cases
// =====================================================================

describe("Edge Cases", () => {
  let edgeMissionId: string;

  // Create a mission assigned to test-agent for edge-case tests
  it("setup: creates a second mission for edge-case tests", async () => {
    const res = await post("/missions", {
      title: "Edge Case Mission",
      objective: "Mission for testing edge cases.",
      priority: "normal",
      assigned_agent_id: agentId,
    });

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    edgeMissionId = data.id as string;
  });

  // ── Edge Case 1: Agent tries to accept (queue) a mission assigned to someone else

  it("other-agent cannot see mission assigned to test-agent in their list", async () => {
    const res = await get(`/agents/${otherAgentId}/missions`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>[];
    const found = data.find((m) => m.id === edgeMissionId);
    expect(found).toBeUndefined();
  });

  // ── Edge Case 2: Cannot complete a mission that hasn't been dispatched

  it("cannot complete a draft mission (invalid state transition)", async () => {
    const { transitionMission, InvalidTransitionError } = await import(
      "../../src/db/repositories/mission-repo.js"
    );

    // edgeMissionId is in "draft" state — try to transition to "complete"
    expect(() => transitionMission(edgeMissionId, "complete")).toThrow();
  });

  // ── Edge Case 3: Sitrep for non-existent mission

  it("rejects sitrep for non-existent mission", async () => {
    const res = await post("/sitreps", {
      mission_id: "mis_nonexistent_xyz",
      agent_id: agentId,
      phase: "V",
      status: "green",
      summary: "This should fail.",
    }, JSON_CT);

    expect(res.status).toBe(404);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toContain("Mission not found");
  });

  // ── Edge Case 4: Sitrep for non-existent agent

  it("rejects sitrep from non-existent agent", async () => {
    const res = await post("/sitreps", {
      mission_id: edgeMissionId,
      agent_id: "agt_nonexistent_xyz",
      phase: "V",
      status: "green",
      summary: "This should fail.",
    }, JSON_CT);

    expect(res.status).toBe(404);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toContain("Agent not found");
  });

  // ── Edge Case 5: Double-complete a mission

  it("cannot double-complete a mission (aar_complete has no valid transitions)", async () => {
    const { transitionMission } = await import("../../src/db/repositories/mission-repo.js");

    // missionId from the happy path is already in aar_complete state
    // Any transition attempt should throw
    expect(() => transitionMission(missionId, "queued")).toThrow();
    expect(() => transitionMission(missionId, "complete")).toThrow();
  });

  // ── Edge Case 6: Cannot queue a non-draft mission

  it("cannot queue a mission that is not in draft status", async () => {
    // First queue the edge mission normally
    const queueRes = await post(`/missions/${edgeMissionId}/queue`, {});
    expect(queueRes.status).toBe(200);

    // Try to queue it again — it's now in "queued" status
    const doubleRes = await post(`/missions/${edgeMissionId}/queue`, {});
    expect(doubleRes.status).toBe(400);
    const data = await doubleRes.json() as Record<string, unknown>;
    expect(data.error).toContain("queued");
  });

  // ── Edge Case 7: Duplicate agent card submission

  it("rejects duplicate agent card for same callsign", async () => {
    const res = await post("/agent-cards", {
      callsign: "test-agent",
      name: "Duplicate Agent",
      operator: "SIT",
      runtime: "claude_api",
      primary_skills: [],
      description: "Should be rejected.",
    }, JSON_CT);

    expect(res.status).toBe(409);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toContain("already registered");
  });

  // ── Edge Case 8: Approve an already-approved card

  it("cannot approve an already-approved card", async () => {
    const res = await post(`/agent-cards/${agentCardId}/approve`, {
      approved_by: "director",
    });

    expect(res.status).toBe(409);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toContain("Cannot approve");
  });

  // ── Edge Case 9: Artifact without required fields

  it("rejects artifact creation without required fields", async () => {
    const res = await post("/artifacts", {
      title: "incomplete.ts",
    }, JSON_CT);

    expect(res.status).toBe(400);
  });

  // ── Edge Case 10: Sitrep with invalid phase

  it("rejects sitrep with invalid phase", async () => {
    const res = await post("/sitreps", {
      mission_id: edgeMissionId,
      agent_id: agentId,
      phase: "X",
      status: "green",
      summary: "Invalid phase test.",
    }, JSON_CT);

    expect(res.status).toBe(400);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toContain("phase");
  });
});
