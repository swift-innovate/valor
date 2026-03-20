import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import {
  createMission,
  getMission,
  transitionMission,
  createApproval,
  resolveApproval,
  getPendingApproval,
} from "../../src/db/index.js";
import {
  dispatchMission,
  processAAR,
  abortMission,
} from "../../src/orchestrator/index.js";
import {
  registerProvider,
  clearProviders,
} from "../../src/providers/registry.js";
import { clearSessions } from "../../src/stream/supervisor.js";
import type { EventEnvelope } from "../../src/types/index.js";
import type { ProviderAdapter, ProviderHealth } from "../../src/providers/types.js";
import type { StreamEvent } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
  clearProviders();
  clearSessions();
});

afterEach(() => {
  clearSessions();
  clearSubscriptions();
  clearProviders();
  cleanupDb();
});

function mockProvider(): ProviderAdapter {
  return {
    id: "mock_provider",
    name: "Mock",
    type: "claude_api",
    capabilities: {
      streaming: true,
      toolUse: false,
      vision: false,
      maxContextTokens: 200000,
      models: ["claude-sonnet-4-20250514"],
    },
    async healthCheck(): Promise<ProviderHealth> {
      return { status: "healthy", latency_ms: 1, last_check: new Date().toISOString() };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { session_id: "s1", sequence: 0, event_type: "heartbeat", data: {}, timestamp: new Date().toISOString() };
      yield { session_id: "s1", sequence: 1, event_type: "token", data: { text: "hello" }, timestamp: new Date().toISOString() };
      yield { session_id: "s1", sequence: 2, event_type: "completion", data: { stop_reason: "end_turn" }, timestamp: new Date().toISOString() };
    },
    async complete() {
      return { content: "test", model: "mock", usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" as const };
    },
  };
}

function createTestMission() {
  return createMission({
    division_id: null,
    title: "Test Mission",
    objective: "Test objective",
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
  });
}

describe("Orchestrator", () => {
  it("rejects dispatch of draft missions", async () => {
    const mission = createTestMission();
    const result = await dispatchMission(mission.id);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toContain("draft");
  });

  it("dispatches a queued mission through gates", async () => {
    registerProvider(mockProvider());
    const mission = createTestMission();
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);
    expect(result.dispatched).toBe(true);

    const updated = getMission(mission.id);
    expect(updated!.status).toBe("streaming");
  });

  it("blocks when no provider available", async () => {
    // No providers registered
    const mission = createTestMission();
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toContain("No agent endpoint and no provider");
  });

  it("blocks when revision cap reached", async () => {
    registerProvider(mockProvider());
    const mission = createMission({
      division_id: null,
      title: "Capped",
      objective: "Test",
      status: "draft",
      phase: null,
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 3,
      max_revisions: 3,
      parent_mission_id: null,
      dispatched_at: null,
      completed_at: null,
    });
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toContain("revision_cap");
  });

  it("emits dispatch events", async () => {
    registerProvider(mockProvider());
    const events: EventEnvelope[] = [];
    subscribe("mission.*", (e) => events.push(e));

    const mission = createTestMission();
    transitionMission(mission.id, "queued");
    await dispatchMission(mission.id);

    expect(events.some((e) => e.type === "mission.dispatched")).toBe(true);
  });
});

describe("AAR Processing", () => {
  it("approves AAR and completes mission", () => {
    registerProvider(mockProvider());
    const mission = createTestMission();
    transitionMission(mission.id, "queued");
    transitionMission(mission.id, "gated");
    transitionMission(mission.id, "dispatched");
    transitionMission(mission.id, "streaming");
    transitionMission(mission.id, "complete");
    transitionMission(mission.id, "aar_pending");

    const result = processAAR(mission.id, true);
    expect(result.status).toBe("aar_complete");
  });

  it("rejects AAR and requeues mission", () => {
    const mission = createTestMission();
    transitionMission(mission.id, "queued");
    transitionMission(mission.id, "gated");
    transitionMission(mission.id, "dispatched");
    transitionMission(mission.id, "streaming");
    transitionMission(mission.id, "complete");
    transitionMission(mission.id, "aar_pending");

    const result = processAAR(mission.id, false);
    expect(result.status).toBe("queued");

    const updated = getMission(mission.id)!;
    expect(updated.revision_count).toBe(1);
  });
});

describe("Mission Abort", () => {
  it("aborts a draft mission", () => {
    const mission = createTestMission();
    transitionMission(mission.id, "queued");

    const aborted = abortMission(mission.id, "Testing");
    expect(aborted.status).toBe("aborted");
  });

  it("emits abort event", () => {
    const events: EventEnvelope[] = [];
    subscribe("mission.*", (e) => events.push(e));

    const mission = createTestMission();
    transitionMission(mission.id, "queued");
    abortMission(mission.id, "Testing");

    expect(events.some((e) => e.type === "mission.aborted")).toBe(true);
  });
});

describe("Approval Queue", () => {
  it("creates and resolves approvals", () => {
    const mission = createTestMission();
    const approval = createApproval({
      mission_id: mission.id,
      gate: "hil",
      requested_by: "gate_runner",
    });

    expect(approval.status).toBe("pending");

    const resolved = resolveApproval(approval.id, {
      status: "approved",
      resolved_by: "director",
      reason: "Approved",
    });

    expect(resolved!.status).toBe("approved");
    expect(resolved!.resolved_by).toBe("director");
  });

  it("finds pending approval for a mission", () => {
    const mission = createTestMission();
    createApproval({
      mission_id: mission.id,
      gate: "hil",
      requested_by: "gate_runner",
    });

    const pending = getPendingApproval(mission.id);
    expect(pending).toBeTruthy();
    expect(pending!.status).toBe("pending");
  });
});
