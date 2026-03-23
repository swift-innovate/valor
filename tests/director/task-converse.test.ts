/**
 * Tests for TASK and CONVERSE decision types in the Director dispatcher.
 *
 * The dispatcher calls publishSitrep (NATS) and nc.publish() directly.
 * We mock the NATS publishers module so tests don't need a live NATS server.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";
import { createAgent } from "../../src/db/repositories/agent-repo.js";

// Mock publishSitrep and publishMissionBrief so we don't need a live NATS server.
vi.mock("../../src/nats/publishers.js", () => ({
  publishSitrep: vi.fn().mockResolvedValue(undefined),
  publishMissionBrief: vi.fn().mockResolvedValue(undefined),
  publishHeartbeat: vi.fn().mockResolvedValue(undefined),
}));

import {
  dispatchMission,
  resetMissionCounter,
} from "../../src/director/dispatcher.js";
import type { ClassifierResult } from "../../src/director/classifier.js";
import type { NatsConnection } from "@nats-io/nats-core";

// ── Mock NatsConnection ───────────────────────────────────────────────
// nc.publish() is called directly for TASK fire-and-forget messages.
// All jetstream calls go through publishSitrep which is mocked above.

interface MockNc {
  published: Array<{ subject: string; payload: string }>;
}

function makeMockNc(): MockNc & NatsConnection {
  const mock: MockNc = { published: [] };
  const nc = {
    publish(subject: string, data: Uint8Array | string) {
      const payload = typeof data === "string" ? data : new TextDecoder().decode(data);
      mock.published.push({ subject, payload });
    },
    // Stubs for unused NatsConnection methods
    subscribe() { return { unsubscribe() {} } as any; },
    drain() { return Promise.resolve(); },
    close() { return Promise.resolve(); },
    closed() { return Promise.resolve(); },
    isClosed() { return false; },
    isDraining() { return false; },
    flush() { return Promise.resolve(); },
    stats() { return {} as any; },
    status() { return { [Symbol.asyncIterator]() { return { next() { return Promise.resolve({ done: true, value: undefined }); } }; } }; },
    info: {} as any,
    options: {} as any,
    protocol: {} as any,
    listeners: new Map() as any,
    on() {},
    off() {},
    rtt() { return Promise.resolve(0); },
    reconnect() {},
    request() { return Promise.resolve({ data: new Uint8Array(), subject: "" }) as any; },
    servers: { getCurrentServer() { return { server: { hostport: () => "" } } as any; } } as any,
    getServer() { return "" },
    jetstream() { return {} as any; },
    jetstreamManager() { return {} as any; },
  };
  Object.assign(mock, nc);
  return mock as unknown as MockNc & NatsConnection;
}

// ── Helpers ───────────────────────────────────────────────────────────

function taskResult(operative: string, query: string): ClassifierResult {
  return {
    gateIntercepted: false,
    intercept: null,
    gear: 1,
    rawResponse: null,
    directorOutput: {
      decision: "TASK",
      confidence: 8,
      reasoning: "Lightweight query, no mission board entry needed",
      task: { operative, query, model_tier: "local" },
    },
  };
}

function converseResult(targetAgent: string, summary: string): ClassifierResult {
  return {
    gateIntercepted: false,
    intercept: null,
    gear: 1,
    rawResponse: null,
    directorOutput: {
      decision: "CONVERSE",
      confidence: 8,
      reasoning: "Director wants to communicate with an agent",
      conversation: { target_agent: targetAgent, summary },
    },
  };
}

// ── Suite setup ───────────────────────────────────────────────────────

beforeAll(() => {
  freshDb();
  clearSubscriptions();
  resetMissionCounter();

  createAgent({
    callsign: "eddie",
    runtime: "openclaw",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "registered",
    last_heartbeat: null,
  });

  createAgent({
    callsign: "mira",
    runtime: "openclaw",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "registered",
    last_heartbeat: null,
  });
});

afterAll(() => {
  clearSubscriptions();
  cleanupDb();
});

// ── TASK Dispatcher ───────────────────────────────────────────────────

describe("TASK dispatch", () => {
  it("returns taskDispatched=true and empty missionIds", async () => {
    const nc = makeMockNc();
    const result = await dispatchMission(nc, taskResult("eddie", "what is 2+2"), "VM-T01", "what is 2+2");
    expect(result.taskDispatched).toBe(true);
    expect(result.missionIds).toHaveLength(0);
    expect(result.dispatched).toBe(true);
    expect(result.escalated).toBe(false);
  });

  it("publishes to valor.tasks.<operative> (lowercase)", async () => {
    const nc = makeMockNc();
    await dispatchMission(nc, taskResult("eddie", "status check"), "VM-T02", "status check");
    const taskPub = nc.published.find((p) => p.subject.startsWith("valor.tasks."));
    expect(taskPub).toBeDefined();
    expect(taskPub!.subject).toBe("valor.tasks.eddie");
  });

  it("does NOT create a mission brief (no board entry)", async () => {
    const { publishMissionBrief } = await import("../../src/nats/publishers.js");
    const missionBriefMock = publishMissionBrief as ReturnType<typeof vi.fn>;
    missionBriefMock.mockClear();

    const nc = makeMockNc();
    await dispatchMission(nc, taskResult("eddie", "quick lookup"), "VM-T03", "quick lookup");
    expect(missionBriefMock).not.toHaveBeenCalled();
  });

  it("includes query and model_tier in published payload", async () => {
    const nc = makeMockNc();
    await dispatchMission(nc, taskResult("eddie", "define entropy"), "VM-T04", "define entropy");
    const taskPub = nc.published.find((p) => p.subject === "valor.tasks.eddie");
    expect(taskPub).toBeDefined();
    const payload = JSON.parse(taskPub!.payload);
    expect(payload.payload.query).toBe("define entropy");
    expect(payload.payload.model_tier).toBe("local");
    expect(payload.payload.operative).toBe("eddie");
  });

  it("returns undispatched when task field is missing", async () => {
    const nc = makeMockNc();
    const bad: ClassifierResult = {
      gateIntercepted: false, intercept: null, gear: 1, rawResponse: null,
      directorOutput: { decision: "TASK", confidence: 5, reasoning: "missing task" },
    };
    const result = await dispatchMission(nc, bad, "VM-T05", "bad task");
    expect(result.dispatched).toBe(false);
    expect(result.taskDispatched).toBeUndefined();
  });
});

// ── CONVERSE Dispatcher ───────────────────────────────────────────────

describe("CONVERSE dispatch", () => {
  it("returns conversationRouted=true", async () => {
    const nc = makeMockNc();
    const result = await dispatchMission(nc, converseResult("mira", "Check on project status"), "VM-C01", "Hey Mira, how's it going?");
    expect(result.conversationRouted).toBe(true);
    expect(result.missionIds).toHaveLength(0);
    expect(result.escalated).toBe(false);
  });

  it("routes to known agent via comms sendMessage", async () => {
    const nc = makeMockNc();
    // mira is registered — should route without error
    const result = await dispatchMission(nc, converseResult("mira", "Review Q1 targets"), "VM-C02", "Mira, let's review Q1.");
    expect(result.conversationRouted).toBe(true);
  });

  it("falls back gracefully when target agent is not found", async () => {
    const nc = makeMockNc();
    // nonexistent-agent is not in the DB — should log warning but still return routed
    const result = await dispatchMission(nc, converseResult("nonexistent-agent", "Hello?"), "VM-C03", "Hey, sup?");
    expect(result.conversationRouted).toBe(true);
    expect(result.escalated).toBe(false);
  });

  it("returns undispatched when conversation field is missing", async () => {
    const nc = makeMockNc();
    const bad: ClassifierResult = {
      gateIntercepted: false, intercept: null, gear: 1, rawResponse: null,
      directorOutput: { decision: "CONVERSE", confidence: 5, reasoning: "missing conversation" },
    };
    const result = await dispatchMission(nc, bad, "VM-C04", "bad converse");
    expect(result.dispatched).toBe(false);
    expect(result.conversationRouted).toBeUndefined();
  });
});
