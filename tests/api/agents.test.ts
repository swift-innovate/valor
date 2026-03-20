import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";
import { agentRoutes } from "../../src/api/agents.js";
import { createAgent, getAgent } from "../../src/db/repositories/agent-repo.js";

const app = new Hono();
app.route("/agents", agentRoutes);

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

function seedAgent() {
  return createAgent({
    callsign: "Gage",
    runtime: "claude_api",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: ["code_review"],
    health_status: "registered",
    last_heartbeat: null,
  });
}

describe("PUT /agents/:id", () => {
  it("updates valid fields and returns the updated agent", async () => {
    const agent = seedAgent();

    const res = await app.request(`/agents/${agent.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { model: string };
    expect(data.model).toBe("claude-sonnet-4-20250514");
  });

  it("returns 400 for invalid runtime — DB unchanged", async () => {
    const agent = seedAgent();

    const res = await app.request(`/agents/${agent.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "invalid_runtime_xyz" }),
    });

    expect(res.status).toBe(400);

    // DB must be unchanged
    const unchanged = getAgent(agent.id);
    expect(unchanged?.runtime).toBe("claude_api");
  });

  it("returns 400 for malformed capabilities — DB unchanged", async () => {
    const agent = seedAgent();

    const res = await app.request(`/agents/${agent.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilities: "not-an-array" }),
    });

    expect(res.status).toBe(400);

    const unchanged = getAgent(agent.id);
    expect(unchanged?.capabilities).toEqual(["code_review"]);
  });

  it("returns 404 for non-existent agent", async () => {
    const res = await app.request("/agents/agt_nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test" }),
    });

    expect(res.status).toBe(404);
  });

  it("ignores unknown fields (whitelist enforcement)", async () => {
    const agent = seedAgent();

    const res = await app.request(`/agents/${agent.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callsign: "NewName", id: "hacked_id", created_at: "malicious" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { id: string; callsign: string };
    // id and created_at must be unchanged; callsign update is allowed
    expect(data.id).toBe(agent.id);
    expect(data.callsign).toBe("NewName");
  });
});
