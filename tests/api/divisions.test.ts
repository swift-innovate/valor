import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { Hono } from "hono";
import { divisionRoutes } from "../../src/api/divisions.js";
import { agentRoutes } from "../../src/api/agents.js";
import {
  createDivision,
  createAgent,
  createMission,
} from "../../src/db/repositories/index.js";
import {
  addMember,
  transferLead,
} from "../../src/db/repositories/division-member-repo.js";

const app = new Hono();
app.route("/divisions", divisionRoutes);
app.route("/agents", agentRoutes);

const DIRECTOR = { "X-VALOR-Role": "director" };
const JSON_HEADERS = { "Content-Type": "application/json" };
const DIRECTOR_JSON = { ...DIRECTOR, ...JSON_HEADERS };

beforeEach(() => freshDb());
afterEach(() => cleanupDb());

// ---- helpers ----------------------------------------------------------------

let _divCounter = 0;
let _agentCounter = 0;

function makeDiv(overrides: Record<string, unknown> = {}) {
  _divCounter++;
  return createDivision({
    name: `Test Division ${_divCounter}`,
    namespace: `test_${_divCounter}`,
    lead_agent_id: null,
    autonomy_policy: {
      max_cost_autonomous_usd: 10,
      approval_required_actions: [],
      auto_dispatch_enabled: true,
    },
    escalation_policy: {
      escalate_to: "director",
      escalate_after_failures: 3,
      escalate_on_budget_breach: true,
    },
    ...overrides,
  });
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  _agentCounter++;
  return createAgent({
    callsign: `agent_${_agentCounter}_${Math.random().toString(36).slice(2)}`,
    runtime: "claude_api" as const,
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "registered" as const,
    last_heartbeat: null,
    ...overrides,
  });
}

// ---- GET /divisions/:id/roster ----------------------------------------------

describe("GET /divisions/:id/roster", () => {
  it("returns roster for an existing division with members", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "operative", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}/roster`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    const entry = body[0] as Record<string, unknown>;
    expect(entry.agent_id).toBe(agent.id);
    expect(entry.role).toBe("operative");
  });

  it("returns 404 for missing division", async () => {
    const res = await app.request("/divisions/div_nonexistent/roster");
    expect(res.status).toBe(404);
  });
});

// ---- POST /divisions/:id/members --------------------------------------------

describe("POST /divisions/:id/members", () => {
  it("returns 201 and the new member", async () => {
    const div = makeDiv();
    const agent = makeAgent();

    const res = await app.request(`/divisions/${div.id}/members`, {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: agent.id, role: "operative" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toMatch(/^dmbr_/);
    expect(body.agent_id).toBe(agent.id);
    expect(body.division_id).toBe(div.id);
    expect(body.role).toBe("operative");
  });

  it("returns 403 without director header", async () => {
    const div = makeDiv();
    const agent = makeAgent();

    const res = await app.request(`/divisions/${div.id}/members`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ agent_id: agent.id, role: "member" }),
    });

    expect(res.status).toBe(403);
  });

  it("returns 409 for duplicate membership", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}/members`, {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: agent.id, role: "member" }),
    });

    expect(res.status).toBe(409);
  });

  it("returns 404 for missing division", async () => {
    const agent = makeAgent();

    const res = await app.request("/divisions/div_nonexistent/members", {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: agent.id, role: "member" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 for missing agent", async () => {
    const div = makeDiv();

    const res = await app.request(`/divisions/${div.id}/members`, {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: "agt_nonexistent", role: "member" }),
    });

    expect(res.status).toBe(404);
  });

  it("defaults role to 'member' when not specified", async () => {
    const div = makeDiv();
    const agent = makeAgent();

    const res = await app.request(`/divisions/${div.id}/members`, {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: agent.id }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.role).toBe("member");
  });
});

// ---- DELETE /divisions/:id/members/:agentId ---------------------------------

describe("DELETE /divisions/:id/members/:agentId", () => {
  it("removes member and returns 200", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}/members/${agent.id}`, {
      method: "DELETE",
      headers: DIRECTOR,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("returns 409 when trying to remove a lead", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    transferLead(div.id, agent.id, "director");

    const res = await app.request(`/divisions/${div.id}/members/${agent.id}`, {
      method: "DELETE",
      headers: DIRECTOR,
    });

    expect(res.status).toBe(409);
  });

  it("returns 404 when member not found", async () => {
    const div = makeDiv();
    const agent = makeAgent();

    const res = await app.request(`/divisions/${div.id}/members/${agent.id}`, {
      method: "DELETE",
      headers: DIRECTOR,
    });

    expect(res.status).toBe(404);
  });

  it("returns 403 without director auth", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}/members/${agent.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);
  });
});

// ---- PUT /divisions/:id/members/:agentId/role -------------------------------

describe("PUT /divisions/:id/members/:agentId/role", () => {
  it("changes role from member to operative", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}/members/${agent.id}/role`, {
      method: "PUT",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ role: "operative" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.role).toBe("operative");
  });

  it("returns 400 when role is 'lead'", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}/members/${agent.id}/role`, {
      method: "PUT",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ role: "lead" }),
    });

    expect(res.status).toBe(400);
  });
});

// ---- POST /divisions/:id/lead -----------------------------------------------

describe("POST /divisions/:id/lead", () => {
  it("transfers leadership to a new agent", async () => {
    const div = makeDiv();
    const agentA = makeAgent();
    const agentB = makeAgent();
    transferLead(div.id, agentA.id, "director");

    const res = await app.request(`/divisions/${div.id}/lead`, {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: agentB.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.agent_id).toBe(agentB.id);
    expect(body.role).toBe("lead");
  });

  it("returns 404 for missing division", async () => {
    const agent = makeAgent();

    const res = await app.request("/divisions/div_nonexistent/lead", {
      method: "POST",
      headers: DIRECTOR_JSON,
      body: JSON.stringify({ agent_id: agent.id }),
    });

    expect(res.status).toBe(404);
  });
});

// ---- GET /divisions/:id/lead ------------------------------------------------

describe("GET /divisions/:id/lead", () => {
  it("returns the current lead", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    transferLead(div.id, agent.id, "director");

    const res = await app.request(`/divisions/${div.id}/lead`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.agent_id).toBe(agent.id);
    expect(body.role).toBe("lead");
  });

  it("returns 404 when no lead is set", async () => {
    const div = makeDiv();

    const res = await app.request(`/divisions/${div.id}/lead`);
    expect(res.status).toBe(404);
  });
});

// ---- GET /agents/:agentId/divisions -----------------------------------------

describe("GET /agents/:agentId/divisions", () => {
  it("returns all division memberships for an agent", async () => {
    const div1 = makeDiv();
    const div2 = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div1.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    addMember({ division_id: div2.id, agent_id: agent.id, role: "operative", assigned_by: "director" });

    const res = await app.request(`/agents/${agent.id}/divisions`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    const divIds = (body as Record<string, unknown>[]).map((e) => e.division_id);
    expect(divIds).toContain(div1.id);
    expect(divIds).toContain(div2.id);
  });

  it("returns 404 for missing agent", async () => {
    const res = await app.request("/agents/agt_nonexistent/divisions");
    expect(res.status).toBe(404);
  });
});

// ---- DELETE /divisions/:id (guards) -----------------------------------------

describe("DELETE /divisions/:id with guards", () => {
  it("returns 409 when division has members", async () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const res = await app.request(`/divisions/${div.id}`, {
      method: "DELETE",
      headers: DIRECTOR,
    });

    expect(res.status).toBe(409);
  });

  it("returns 409 when division has active missions", async () => {
    const div = makeDiv();
    createMission({
      division_id: div.id,
      title: "Active Mission",
      objective: "Do something",
      status: "queued" as const,
      phase: null,
      assigned_agent_id: null,
      priority: "normal" as const,
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

    const res = await app.request(`/divisions/${div.id}`, {
      method: "DELETE",
      headers: DIRECTOR,
    });

    expect(res.status).toBe(409);
  });
});
