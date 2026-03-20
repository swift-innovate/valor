import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import {
  createMission,
  createAgent,
  createSitrep,
  getSitrep,
  listSitreps,
  getLatestSitrep,
} from "../../src/db/index.js";
import { sitrepRoutes } from "../../src/api/sitreps.js";
import { dispatchWebhook, dispatchAbortWebhook } from "../../src/dispatch/index.js";
import type { EventEnvelope } from "../../src/types/index.js";

const app = new Hono();
app.route("/sitreps", sitrepRoutes);

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

async function post(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function get(path: string): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`));
}

// ── Sitrep Repository ───────────────────────────────────────────────

describe("Sitrep Repository", () => {
  it("creates and retrieves a sitrep", () => {
    const mission = createMission({
      division_id: null,
      title: "Test Mission",
      objective: "Test",
      status: "streaming",
      phase: "A",
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

    const agent = createAgent({
      callsign: "TestAgent",
      division_id: null,
      runtime: "custom",
      endpoint_url: null,
      model: null,
      health_status: "healthy",
      last_heartbeat: new Date().toISOString(),
      persona_id: null,
      capabilities: [],
    });

    const sitrep = createSitrep({
      mission_id: mission.id,
      agent_id: agent.id,
      phase: "A",
      status: "green",
      summary: "Making progress",
      objectives_complete: ["Phase V done"],
      objectives_pending: ["Implementation"],
      blockers: [],
      learnings: ["Found a shortcut"],
      confidence: "high",
      tokens_used: 500,
      delivered_to: [],
    });

    expect(sitrep.id).toMatch(/^sit_/);
    expect(sitrep.summary).toBe("Making progress");

    const retrieved = getSitrep(sitrep.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.objectives_complete).toEqual(["Phase V done"]);
    expect(retrieved!.learnings).toEqual(["Found a shortcut"]);
  });

  it("lists sitreps by mission", () => {
    const mission = createMission({
      division_id: null, title: "M1", objective: "T", status: "streaming",
      phase: "A", assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const agent = createAgent({
      callsign: "A1", division_id: null, runtime: "custom", endpoint_url: null,
      model: null, health_status: "healthy", last_heartbeat: null,
      persona_id: null, capabilities: [],
    });

    createSitrep({
      mission_id: mission.id, agent_id: agent.id, phase: "V", status: "green",
      summary: "First", objectives_complete: [], objectives_pending: [],
      blockers: [], learnings: [], confidence: "medium", tokens_used: 0,
      delivered_to: [],
    });
    createSitrep({
      mission_id: mission.id, agent_id: agent.id, phase: "A", status: "yellow",
      summary: "Second", objectives_complete: [], objectives_pending: [],
      blockers: ["API rate limit"], learnings: [], confidence: "low",
      tokens_used: 100, delivered_to: [],
    });

    const sitreps = listSitreps({ mission_id: mission.id });
    expect(sitreps).toHaveLength(2);

    const latest = getLatestSitrep(mission.id);
    expect(latest).toBeTruthy();
    expect(["V", "A"]).toContain(latest!.phase);
  });
});

// ── Sitrep API ──────────────────────────────────────────────────────

describe("Sitrep API", () => {
  it("ingests a sitrep and emits event", async () => {
    const events: EventEnvelope[] = [];
    subscribe("sitrep.*", (e) => events.push(e));

    const mission = createMission({
      division_id: null, title: "API Test", objective: "T", status: "streaming",
      phase: "A", assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const agent = createAgent({
      callsign: "API-Agent", division_id: null, runtime: "custom",
      endpoint_url: null, model: null, health_status: "healthy",
      last_heartbeat: null, persona_id: null, capabilities: [],
    });

    const res = await post("/sitreps", {
      mission_id: mission.id,
      agent_id: agent.id,
      phase: "A",
      status: "green",
      summary: "All systems go",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^sit_/);
    expect(body.summary).toBe("All systems go");
    expect(events.some((e) => e.type === "sitrep.received")).toBe(true);
  });

  it("emits escalation event for escalated status", async () => {
    const events: EventEnvelope[] = [];
    subscribe("sitrep.*", (e) => events.push(e));

    const mission = createMission({
      division_id: null, title: "Escalation Test", objective: "T",
      status: "streaming", phase: "A", assigned_agent_id: null,
      priority: "high", constraints: [], deliverables: [],
      success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const agent = createAgent({
      callsign: "Escalator", division_id: null, runtime: "custom",
      endpoint_url: null, model: null, health_status: "healthy",
      last_heartbeat: null, persona_id: null, capabilities: [],
    });

    const res = await post("/sitreps", {
      mission_id: mission.id,
      agent_id: agent.id,
      phase: "A",
      status: "escalated",
      summary: "Need Director approval for external API access",
      blockers: ["Requires external API key"],
    });

    expect(res.status).toBe(201);
    expect(events.some((e) => e.type === "sitrep.escalated")).toBe(true);
  });

  it("rejects sitrep with missing fields", async () => {
    const res = await post("/sitreps", { mission_id: "mis_xxx" });
    expect(res.status).toBe(400);
  });

  it("rejects sitrep for unknown agent", async () => {
    const mission = createMission({
      division_id: null, title: "T", objective: "T", status: "streaming",
      phase: "A", assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const res = await post("/sitreps", {
      mission_id: mission.id,
      agent_id: "agt_nonexistent",
      phase: "V",
      status: "green",
      summary: "Test",
    });
    expect(res.status).toBe(404);
  });

  it("lists sitreps via GET", async () => {
    const mission = createMission({
      division_id: null, title: "List Test", objective: "T", status: "streaming",
      phase: "A", assigned_agent_id: null, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const agent = createAgent({
      callsign: "Lister", division_id: null, runtime: "custom",
      endpoint_url: null, model: null, health_status: "healthy",
      last_heartbeat: null, persona_id: null, capabilities: [],
    });

    await post("/sitreps", {
      mission_id: mission.id, agent_id: agent.id,
      phase: "V", status: "green", summary: "First report",
    });

    const res = await get(`/sitreps?mission_id=${mission.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

// ── Webhook Dispatcher ──────────────────────────────────────────────

describe("Webhook Dispatcher", () => {
  it("returns error when agent not found", async () => {
    const result = await dispatchWebhook("mis_xxx", "agt_nonexistent", "http://localhost:3200");
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("Agent not found");
  });

  it("returns error when agent has no endpoint_url", async () => {
    const agent = createAgent({
      callsign: "NoEndpoint", division_id: null, runtime: "custom",
      endpoint_url: null, model: null, health_status: "healthy",
      last_heartbeat: null, persona_id: null, capabilities: [],
    });

    const mission = createMission({
      division_id: null, title: "Webhook Test", objective: "T", status: "dispatched",
      phase: null, assigned_agent_id: agent.id, priority: "normal", constraints: [],
      deliverables: [], success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const result = await dispatchWebhook(mission.id, agent.id, "http://localhost:3200");
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("no endpoint_url");
  });

  it("returns error when mission not found", async () => {
    const agent = createAgent({
      callsign: "HasEndpoint", division_id: null, runtime: "custom",
      endpoint_url: "http://localhost:19999/webhook", model: null,
      health_status: "healthy", last_heartbeat: null, persona_id: null,
      capabilities: [],
    });

    const result = await dispatchWebhook("mis_nonexistent", agent.id, "http://localhost:3200");
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("Mission not found");
  });

  it("handles unreachable endpoint gracefully", async () => {
    const agent = createAgent({
      callsign: "Unreachable", division_id: null, runtime: "custom",
      endpoint_url: "http://localhost:19999/webhook", model: null,
      health_status: "healthy", last_heartbeat: null, persona_id: null,
      capabilities: [],
    });

    const mission = createMission({
      division_id: null, title: "Unreachable Test", objective: "T",
      status: "dispatched", phase: null, assigned_agent_id: agent.id,
      priority: "normal", constraints: [], deliverables: [],
      success_criteria: [], token_usage: null, cost_usd: 0,
      revision_count: 0, max_revisions: 3, parent_mission_id: null,
      dispatched_at: null, completed_at: null,
    });

    const events: EventEnvelope[] = [];
    subscribe("dispatch.*", (e) => events.push(e));

    const result = await dispatchWebhook(mission.id, agent.id, "http://localhost:3200");
    expect(result.delivered).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(events.some((e) => e.type === "dispatch.webhook.failed")).toBe(true);
  });

  it("abort webhook handles missing endpoint gracefully", async () => {
    const agent = createAgent({
      callsign: "NoAbortEndpoint", division_id: null, runtime: "custom",
      endpoint_url: null, model: null, health_status: "healthy",
      last_heartbeat: null, persona_id: null, capabilities: [],
    });

    const result = await dispatchAbortWebhook("mis_xxx", agent.id, "Director abort");
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("No endpoint_url");
  });
});
