import { Hono } from "hono";
import { ZodError } from "zod";
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  updateHeartbeat,
  deleteAgent,
  listMissions,
} from "../db/index.js";
import { AgentRuntime } from "../types/index.js";

const VALID_RUNTIMES: AgentRuntime[] = [
  "openclaw",
  "ollama",
  "claude_api",
  "openai_api",
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

  // Validate runtime if provided
  if (body.runtime !== undefined) {
    const result = AgentRuntime.safeParse(body.runtime);
    if (!result.success) {
      return c.json({ error: `Invalid runtime. Must be one of: ${AgentRuntime.options.join(", ")}` }, 400);
    }
  }

  // Whitelist updatable fields — prevent unknown keys from reaching the repo
  const allowed: Record<string, unknown> = {};
  const updatable = ["callsign", "runtime", "division_id", "endpoint_url", "model", "persona_id", "capabilities", "health_status"] as const;
  for (const key of updatable) {
    if (key in body) allowed[key] = body[key];
  }

  try {
    const agent = updateAgent(c.req.param("id"), allowed);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "Invalid agent data", details: err.errors }, 400);
    }
    throw err;
  }
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
