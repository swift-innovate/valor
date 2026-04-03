import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import {
  createMission,
  createAgent,
  getMission,
  transitionMission,
} from "../../src/db/index.js";
import {
  dispatchMission,
} from "../../src/orchestrator/index.js";
import {
  registerProvider,
  clearProviders,
} from "../../src/providers/registry.js";
import { clearSessions } from "../../src/stream/supervisor.js";
import type { EventEnvelope } from "../../src/types/index.js";
import type { ProviderAdapter, ProviderHealth } from "../../src/providers/types.js";
import type { StreamEvent } from "../../src/types/index.js";

/**
 * Track pending async internal missions so we can await them before cleanup.
 * Without this, the fire-and-forget executeInternalMission continues after
 * afterEach calls cleanupDb(), causing "no such table" errors.
 */
let pendingMissions: Promise<void>[] = [];

function waitForMissionDone(): Promise<void> {
  // Wait for a terminal execution event (completed, failed, escalated, iteration_limit)
  const terminalTypes = new Set([
    "mission.internal_execution.completed",
    "mission.internal_execution.failed",
    "mission.internal_execution.escalated",
    "mission.internal_execution.iteration_limit",
  ]);
  return new Promise<void>((resolve) => {
    const unsub = subscribe("mission.internal_execution.*", (event) => {
      if (terminalTypes.has(event.type)) {
        unsub();
        // Give a tick for any final DB writes
        setTimeout(resolve, 50);
      }
    });
    // Timeout fallback
    setTimeout(() => {
      unsub();
      resolve();
    }, 30_000);
  });
}

beforeEach(() => {
  freshDb();
  clearSubscriptions();
  clearProviders();
  clearSessions();
  pendingMissions = [];
});

afterEach(async () => {
  // Wait for any in-flight internal missions before tearing down DB
  await Promise.allSettled(pendingMissions);
  clearSessions();
  clearSubscriptions();
  clearProviders();
  cleanupDb();
});

/** Mock provider that returns "Mission complete: true" so the operative loop finishes. */
function mockCompletingProvider(): ProviderAdapter {
  return {
    id: "mock_provider",
    name: "Mock",
    type: "claude_api",
    capabilities: {
      streaming: true,
      toolUse: false,
      vision: false,
      maxContextTokens: 200000,
      models: ["mock-model"],
    },
    async healthCheck(): Promise<ProviderHealth> {
      return { status: "healthy", latency_ms: 1, last_check: new Date().toISOString() };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { session_id: "s1", sequence: 0, event_type: "completion", data: {}, timestamp: new Date().toISOString() };
    },
    async complete() {
      return {
        content: "Mission complete: true. All objectives achieved.",
        model: "mock-model",
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn" as const,
      };
    },
  };
}

/** Mock provider that never signals completion (for iteration limit testing). */
function mockNonCompletingProvider(): ProviderAdapter {
  return {
    ...mockCompletingProvider(),
    id: "mock_non_completing",
    async complete() {
      return {
        content: "Continuing analysis of the problem space.",
        model: "mock-model",
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn" as const,
      };
    },
  };
}

function createInternalAgent() {
  return createAgent({
    callsign: "gage",
    division_id: null,
    runtime: "internal",
    endpoint_url: null,
    model: "mock-model",
    health_status: "healthy",
    last_heartbeat: null,
    persona_id: null,
    capabilities: ["code", "research"],
  });
}

function createTestMission(agentId: string | null = null) {
  return createMission({
    division_id: null,
    title: "Test Internal Mission",
    objective: "Summarize the VALOR architecture",
    status: "draft",
    phase: null,
    assigned_agent_id: agentId,
    priority: "normal",
    constraints: [],
    deliverables: [],
    success_criteria: ["Summary is accurate"],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: 3,
    parent_mission_id: null,
    dispatched_at: null,
    completed_at: null,
  });
}

describe("Orchestrator Path C — Internal Agent Routing", () => {
  it("dispatches to internal agent via Path C", async () => {
    registerProvider(mockCompletingProvider());
    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);

    expect(result.dispatched).toBe(true);
    expect(result.reason).toContain("internal agent");
    expect(result.reason).toContain("gage");

    await waiter;
  });

  it("emits mission.dispatched event with mode: internal", async () => {
    registerProvider(mockCompletingProvider());
    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const events: EventEnvelope[] = [];
    subscribe("mission.*", (e) => events.push(e));

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    await dispatchMission(mission.id);

    const dispatched = events.find((e) => e.type === "mission.dispatched");
    expect(dispatched).toBeDefined();
    expect(dispatched!.payload.mode).toBe("internal");
    expect(dispatched!.payload.agent_id).toBe(agent.id);

    await waiter;
  });

  it("mission transitions to dispatched immediately", async () => {
    registerProvider(mockCompletingProvider());
    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);
    // The mission should be at least dispatched (may have progressed further by now)
    const current = getMission(mission.id)!;
    expect(["dispatched", "streaming", "complete", "failed"]).toContain(current.status);

    await waiter;
  });

  it("does NOT route external agents to Path C", async () => {
    registerProvider(mockCompletingProvider());

    // Agent with endpoint_url should go to Path A (webhook), not Path C
    const agent = createAgent({
      callsign: "webhook-agent",
      division_id: null,
      runtime: "openclaw",
      endpoint_url: "http://localhost:9999/webhook",
      model: "mock-model",
      health_status: "healthy",
      last_heartbeat: null,
      persona_id: null,
      capabilities: [],
    });

    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);
    // Webhook dispatch may fail (no server), but it should NOT be "internal agent"
    expect(result.reason).not.toContain("internal agent");
  });

  it("routes non-internal agents without endpoint to Path B (direct stream)", async () => {
    registerProvider(mockCompletingProvider());

    const agent = createAgent({
      callsign: "ollama-agent",
      division_id: null,
      runtime: "ollama",
      endpoint_url: null,
      model: "mock-model",
      health_status: "healthy",
      last_heartbeat: null,
      persona_id: null,
      capabilities: [],
    });

    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    const result = await dispatchMission(mission.id);
    expect(result.dispatched).toBe(true);
    // Path B dispatches via provider, not internal agent
    expect(result.reason).toContain("provider");
  });
});

describe("E2E — Internal Mission Lifecycle", () => {
  it("mission completes end-to-end with sitreps", async () => {
    registerProvider(mockCompletingProvider());
    const events: EventEnvelope[] = [];
    subscribe("*", (e) => events.push(e));

    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    await dispatchMission(mission.id);
    await waiter;

    // Verify sitreps were published
    const sitreps = events.filter((e) => e.type === "sitrep.published");
    expect(sitreps.length).toBeGreaterThanOrEqual(5); // at least one full iteration

    // Verify phases in sitreps
    const phases = sitreps.map((e) => (e.payload as Record<string, unknown>).phase);
    expect(phases).toContain("observe");
    expect(phases).toContain("plan");
    expect(phases).toContain("act");
    expect(phases).toContain("validate");
    expect(phases).toContain("reflect");

    // Verify sitrep payloads have the expected shape
    const firstSitrep = sitreps[0]!;
    expect(firstSitrep.payload).toHaveProperty("mission_id", mission.id);
    expect(firstSitrep.payload).toHaveProperty("operative", "gage");
    expect(firstSitrep.payload).toHaveProperty("iteration");
    expect(firstSitrep.payload).toHaveProperty("progress_pct");

    // Verify mission reached complete state
    const finalMission = getMission(mission.id)!;
    expect(finalMission.status).toBe("complete");

    // Verify execution lifecycle events
    const started = events.find((e) => e.type === "mission.internal_execution.started");
    expect(started).toBeDefined();
    const completed = events.find((e) => e.type === "mission.internal_execution.completed");
    expect(completed).toBeDefined();
  });

  it("mission fails when provider returns failure signals", async () => {
    const failProvider: ProviderAdapter = {
      ...mockCompletingProvider(),
      id: "fail_provider",
      async complete() {
        return {
          content: "Mission failed. Unable to complete objectives.",
          model: "mock-model",
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn" as const,
        };
      },
    };
    registerProvider(failProvider);

    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    await dispatchMission(mission.id);
    await waiter;

    const finalMission = getMission(mission.id)!;
    expect(finalMission.status).toBe("failed");
  });

  it("mission escalates when autonomy budget exhausts", async () => {
    registerProvider(mockNonCompletingProvider());

    const events: EventEnvelope[] = [];
    subscribe("*", (e) => events.push(e));

    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    await dispatchMission(mission.id);
    await waiter;

    // Default config: budget=5, maxIterations=10 → budget exhausts first
    // Escalated missions stay in streaming (Director must intervene)
    const finalMission = getMission(mission.id)!;
    expect(finalMission.status).toBe("streaming");

    // Verify escalation was the outcome
    const escalationEvent = events.find(
      (e) => e.type === "mission.internal_execution.escalated"
    );
    expect(escalationEvent).toBeDefined();
    expect(escalationEvent!.payload).toHaveProperty("outcome", "escalated");
  }, 30_000);

  it("internal agent creates valid audit trail", async () => {
    registerProvider(mockCompletingProvider());
    const events: EventEnvelope[] = [];
    subscribe("*", (e) => events.push(e));

    const waiter = waitForMissionDone();
    pendingMissions.push(waiter);

    const agent = createInternalAgent();
    const mission = createTestMission(agent.id);
    transitionMission(mission.id, "queued");

    await dispatchMission(mission.id);
    await waiter;

    // Should have dispatch event
    const dispatchEvent = events.find(
      (e) => e.type === "mission.dispatched" && (e.payload as Record<string, unknown>).mode === "internal"
    );
    expect(dispatchEvent).toBeDefined();

    // Should have execution lifecycle events
    const lifecycleEvents = events.filter((e) =>
      e.type.startsWith("mission.internal_execution.")
    );
    expect(lifecycleEvents.length).toBeGreaterThanOrEqual(2); // started + completed/failed
  });
});
