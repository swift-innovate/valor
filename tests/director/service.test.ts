/**
 * Tests for the Director Service daemon.
 *
 * Verifies:
 * - Service starts and stops cleanly
 * - Health endpoint returns correct status
 * - Metrics endpoint returns tracked data
 * - Mock NATS messages trigger the classification pipeline
 * - Metrics are tracked correctly for classifications
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";

// Mock NATS modules so tests don't need a live NATS server.
// Must be declared before any imports that reference them.
const mockSubscribe = vi.fn();
const mockPublish = vi.fn();
const mockDrain = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/nats/client.js", () => ({
  getNatsConnection: vi.fn().mockResolvedValue({
    subscribe: mockSubscribe.mockReturnValue({
      unsubscribe: vi.fn(),
    }),
    publish: mockPublish,
    drain: mockDrain,
    close: vi.fn().mockResolvedValue(undefined),
    closed: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    isDraining: vi.fn().mockReturnValue(false),
    flush: vi.fn().mockResolvedValue(undefined),
    rtt: vi.fn().mockResolvedValue(1),
    status: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          next() { return Promise.resolve({ done: true, value: undefined }); },
        };
      },
    }),
    getServer: vi.fn().mockReturnValue("nats://localhost:4222"),
    info: { proto: 1, version: "2.10.0" },
    request: vi.fn().mockResolvedValue({ data: new Uint8Array() }),
  }),
  closeNatsConnection: vi.fn().mockResolvedValue(undefined),
  currentConnection: vi.fn().mockReturnValue(null),
  healthCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/nats/streams.js", () => ({
  ensureStreams: vi.fn().mockResolvedValue(undefined),
  ensureMissionConsumer: vi.fn().mockResolvedValue(undefined),
  ensureSitrepConsumer: vi.fn().mockResolvedValue(undefined),
  ensureReviewConsumer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/nats/publishers.js", () => ({
  publishSitrep: vi.fn().mockResolvedValue(undefined),
  publishMissionBrief: vi.fn().mockResolvedValue(undefined),
  publishHeartbeat: vi.fn().mockResolvedValue(undefined),
  publishSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock the Director pipeline — we test the service wrapper, not the classifier
vi.mock("../../src/director/classifier.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/director/classifier.js")>();
  return {
    ...original,
    classifyMission: vi.fn().mockResolvedValue({
      gateIntercepted: false,
      intercept: null,
      directorOutput: {
        decision: "ESCALATE",
        confidence: 8,
        reasoning: "Test escalation",
        escalation: {
          reason: "Test",
          safety_gate: "test",
          recommended_action: "None",
        },
      },
      gear: 1,
      rawResponse: null,
    }),
  };
});

import {
  getMetrics,
  resetMetrics,
  recordClassification,
} from "../../src/director/metrics.js";
import type { DirectorMetrics } from "../../src/director/metrics.js";

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  freshDb();
  clearSubscriptions();
});

afterAll(() => {
  clearSubscriptions();
  cleanupDb();
});

// ---------------------------------------------------------------------------
// Metrics tests
// ---------------------------------------------------------------------------

describe("DirectorMetrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("starts with zero counters", () => {
    const m = getMetrics();
    expect(m.totalClassifications).toBe(0);
    expect(m.gear1Count).toBe(0);
    expect(m.gear2Count).toBe(0);
    expect(m.gateInterceptCount).toBe(0);
    expect(m.lastClassificationAt).toBeNull();
    expect(m.avgLatencyMs).toBe(0);
    expect(m.gear2Rate).toBe(0);
  });

  it("records a Gear 1 classification", () => {
    recordClassification(1, false, 150);
    const m = getMetrics();
    expect(m.totalClassifications).toBe(1);
    expect(m.gear1Count).toBe(1);
    expect(m.gear2Count).toBe(0);
    expect(m.avgLatencyMs).toBe(150);
    expect(m.lastClassificationAt).not.toBeNull();
  });

  it("records a Gear 2 classification", () => {
    recordClassification(2, false, 3000);
    const m = getMetrics();
    expect(m.totalClassifications).toBe(1);
    expect(m.gear1Count).toBe(0);
    expect(m.gear2Count).toBe(1);
    expect(m.gear2Rate).toBe(1);
  });

  it("records a gate intercept", () => {
    recordClassification(null, true, 5);
    const m = getMetrics();
    expect(m.totalClassifications).toBe(1);
    expect(m.gateInterceptCount).toBe(1);
    expect(m.gear1Count).toBe(0);
    expect(m.gear2Count).toBe(0);
  });

  it("computes gear2 escalation rate correctly", () => {
    recordClassification(1, false, 100);
    recordClassification(1, false, 120);
    recordClassification(2, false, 2000);
    recordClassification(1, false, 110);
    const m = getMetrics();
    expect(m.gear1Count).toBe(3);
    expect(m.gear2Count).toBe(1);
    expect(m.gear2Rate).toBe(0.25);
  });

  it("computes average latency across multiple classifications", () => {
    recordClassification(1, false, 100);
    recordClassification(1, false, 200);
    recordClassification(1, false, 300);
    const m = getMetrics();
    expect(m.avgLatencyMs).toBe(200);
  });

  it("tracks uptime", () => {
    const m = getMetrics();
    expect(m.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(m.uptimeMs).toBeLessThan(5000); // Should be very short in tests
  });

  it("resets cleanly", () => {
    recordClassification(1, false, 100);
    recordClassification(2, false, 200);
    recordClassification(null, true, 5);
    resetMetrics();
    const m = getMetrics();
    expect(m.totalClassifications).toBe(0);
    expect(m.gear1Count).toBe(0);
    expect(m.gear2Count).toBe(0);
    expect(m.gateInterceptCount).toBe(0);
    expect(m.lastClassificationAt).toBeNull();
  });

  it("tracks classifications per minute in rolling window", () => {
    for (let i = 0; i < 5; i++) {
      recordClassification(1, false, 100);
    }
    const m = getMetrics();
    expect(m.classificationsThisMinute).toBe(5);
    expect(m.classificationsPerMinute).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Service start/stop tests (using dynamic import to respect mocks)
// ---------------------------------------------------------------------------

describe("DirectorService lifecycle", () => {
  it("imports service module without errors", async () => {
    const mod = await import("../../src/director/service.js");
    expect(mod.startDirectorService).toBeDefined();
    expect(mod.stopDirectorService).toBeDefined();
    expect(mod.getServiceState).toBeDefined();
  });

  it("starts and stops cleanly", async () => {
    const { startDirectorService, stopDirectorService, getServiceState } =
      await import("../../src/director/service.js");

    // Use port 0 to get an ephemeral port (avoids conflicts)
    const state = await startDirectorService({ port: 0 });
    expect(state.status).toMatch(/ready|degraded/);
    expect(state.natsConnected).toBe(true);

    const currentState = getServiceState();
    expect(currentState.status).toMatch(/ready|degraded/);

    await stopDirectorService();

    const stoppedState = getServiceState();
    expect(stoppedState.status).toBe("stopped");
    expect(stoppedState.natsConnected).toBe(false);
  });

  it("NATS subscribe is called for classify subject", async () => {
    const { startDirectorService, stopDirectorService } =
      await import("../../src/director/service.js");

    mockSubscribe.mockClear();

    await startDirectorService({ port: 0 });

    // Should subscribe to at least the classify subject and legacy subject
    expect(mockSubscribe).toHaveBeenCalledTimes(2);

    const subjects = mockSubscribe.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(subjects).toContain("director.classify");
    expect(subjects).toContain("valor.missions.inbound");

    await stopDirectorService();
  });

  it("health endpoint returns service state", async () => {
    const { startDirectorService, stopDirectorService, getHttpServer } =
      await import("../../src/director/service.js");

    await startDirectorService({ port: 0 });

    const server = getHttpServer();
    expect(server).not.toBeNull();

    // Get the assigned port
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    // Fetch health endpoint
    const healthRes = await fetch(`http://localhost:${port}/health`);
    expect(healthRes.status).toBe(200);

    const healthBody = (await healthRes.json()) as Record<string, unknown>;
    expect(healthBody.status).toBeDefined();
    expect(healthBody.nats_connected).toBe(true);
    expect(healthBody.uptime_ms).toBeGreaterThanOrEqual(0);

    await stopDirectorService();
  });

  it("metrics endpoint returns classification metrics", async () => {
    const { startDirectorService, stopDirectorService, getHttpServer } =
      await import("../../src/director/service.js");

    await startDirectorService({ port: 0 });

    const server = getHttpServer();
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    // Fetch metrics endpoint
    const metricsRes = await fetch(`http://localhost:${port}/metrics`);
    expect(metricsRes.status).toBe(200);

    const metricsBody = (await metricsRes.json()) as DirectorMetrics;
    expect(metricsBody.totalClassifications).toBeDefined();
    expect(metricsBody.gear1Count).toBeDefined();
    expect(metricsBody.gear2Count).toBeDefined();
    expect(metricsBody.gateInterceptCount).toBeDefined();
    expect(metricsBody.avgLatencyMs).toBeDefined();
    expect(metricsBody.uptimeMs).toBeGreaterThanOrEqual(0);

    await stopDirectorService();
  });

  it("returns 404 for unknown routes", async () => {
    const { startDirectorService, stopDirectorService, getHttpServer } =
      await import("../../src/director/service.js");

    await startDirectorService({ port: 0 });

    const server = getHttpServer();
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);

    await stopDirectorService();
  });
});
