import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { createAgent, getAgent, updateAgent } from "../../src/db/repositories/index.js";
import { AgentHealthMonitor } from "../../src/monitors/agent-health.js";

beforeEach(() => freshDb());
afterEach(() => cleanupDb());

function createTestAgent(callsign: string, lastHeartbeat: string | null, status = "healthy" as const) {
  return createAgent({
    callsign,
    runtime: "claude_api",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: status,
    last_heartbeat: lastHeartbeat,
  });
}

describe("AgentHealthMonitor", () => {
  it("marks healthy agent as degraded after threshold", () => {
    const monitor = new AgentHealthMonitor({
      degradedAfterMs: 1000,
      offlineAfterMs: 60000,
    });

    const fiveSecsAgo = new Date(Date.now() - 5000).toISOString();
    const agent = createTestAgent("Stale", fiveSecsAgo);

    (monitor as any).sweep();

    const updated = getAgent(agent.id);
    expect(updated!.health_status).toBe("degraded");
  });

  it("marks agent as offline after longer threshold", () => {
    const monitor = new AgentHealthMonitor({
      degradedAfterMs: 1000,
      offlineAfterMs: 2000,
    });

    const tenSecsAgo = new Date(Date.now() - 10000).toISOString();
    const agent = createTestAgent("Gone", tenSecsAgo);

    (monitor as any).sweep();

    const updated = getAgent(agent.id);
    expect(updated!.health_status).toBe("offline");
  });

  it("does not touch recently-active agents", () => {
    const monitor = new AgentHealthMonitor({
      degradedAfterMs: 60000,
      offlineAfterMs: 120000,
    });

    const oneSecAgo = new Date(Date.now() - 1000).toISOString();
    const agent = createTestAgent("Fresh", oneSecAgo);

    (monitor as any).sweep();

    const updated = getAgent(agent.id);
    expect(updated!.health_status).toBe("healthy");
  });

  it("skips deregistered agents", () => {
    const monitor = new AgentHealthMonitor({
      degradedAfterMs: 1,
      offlineAfterMs: 2,
    });

    const oldTime = new Date(Date.now() - 999999999).toISOString();
    const agent = createTestAgent("Dead", oldTime, "deregistered" as any);

    (monitor as any).sweep();

    const updated = getAgent(agent.id);
    expect(updated!.health_status).toBe("deregistered");
  });

  it("skips agents with no heartbeat (registered state)", () => {
    const monitor = new AgentHealthMonitor({
      degradedAfterMs: 1,
      offlineAfterMs: 2,
    });

    const agent = createTestAgent("New", null, "registered" as any);

    (monitor as any).sweep();

    const updated = getAgent(agent.id);
    expect(updated!.health_status).toBe("registered");
  });

  it("does not double-degrade already degraded agents within offline window", () => {
    const monitor = new AgentHealthMonitor({
      degradedAfterMs: 1000,
      offlineAfterMs: 60000,
    });

    const fiveSecsAgo = new Date(Date.now() - 5000).toISOString();
    const agent = createTestAgent("SlowAgent", fiveSecsAgo);
    updateAgent(agent.id, { health_status: "degraded" });

    (monitor as any).sweep();

    const updated = getAgent(agent.id);
    expect(updated!.health_status).toBe("degraded");
  });
});
