import { Hono } from "hono";
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  updateHeartbeat,
  deleteAgent,
  listMissions,
} from "../db/index.js";
import type { AgentRuntime } from "../types/index.js";

const VALID_RUNTIMES: AgentRuntime[] = [
  "openclaw",
  "herd",
  "claude_api",
  "ollama",
  "custom",
];

export const agentRoutes = new Hono();

// List agents with optional filters
agentRoutes.get("/", (c) => {
  const division_id = c.req.query("division_id");
  const health_status = c.req.query("health_status");

  const agents = listAgents({ division_id, health_status });
  return c.json(agents);
});

// Get single agent
agentRoutes.get("/:id", (c) => {
  const agent = getAgent(c.req.param("id"));
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json(agent);
});

// Register a new agent
agentRoutes.post("/", async (c) => {
  const body = await c.req.json();

  if (!body.callsign || !body.runtime) {
    return c.json({ error: "callsign and runtime are required" }, 400);
  }

  if (!VALID_RUNTIMES.includes(body.runtime)) {
    return c.json(
      { error: `Invalid runtime. Must be one of: ${VALID_RUNTIMES.join(", ")}` },
      400,
    );
  }

  const agent = createAgent({
    callsign: body.callsign,
    runtime: body.runtime,
    division_id: body.division_id ?? null,
    endpoint_url: body.endpoint_url ?? null,
    model: body.model ?? null,
    persona_id: body.persona_id ?? null,
    capabilities: body.capabilities ?? [],
    health_status: "registered",
    last_heartbeat: null,
  });

  return c.json(agent, 201);
});

// Update agent
agentRoutes.put("/:id", async (c) => {
  const body = await c.req.json();
  const agent = updateAgent(c.req.param("id"), body);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json(agent);
});

// Delete/deregister agent
agentRoutes.delete("/:id", (c) => {
  const deleted = deleteAgent(c.req.param("id"));
  if (!deleted) return c.json({ error: "Agent not found" }, 404);
  return c.json({ ok: true });
});

// Update heartbeat
agentRoutes.post("/:id/heartbeat", (c) => {
  const agent = updateHeartbeat(c.req.param("id"));
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json(agent);
});

// List missions assigned to this agent
agentRoutes.get("/:id/missions", (c) => {
  const id = c.req.param("id");
  const agent = getAgent(id);
  if (!agent) return c.json({ error: "Agent not found" }, 404);

  const missions = listMissions({ assigned_agent_id: id });
  return c.json(missions);
});

// Assign persona to agent
agentRoutes.put("/:id/persona", async (c) => {
  const body = await c.req.json();
  const agent = updateAgent(c.req.param("id"), {
    persona_id: body.persona_id,
  });
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json(agent);
});
