import { Hono } from "hono";
import {
  createDivision,
  getDivision,
  listDivisions,
  updateDivision,
  deleteDivision,
  listAgents,
} from "../db/index.js";

export const divisionRoutes = new Hono();

// List all divisions
divisionRoutes.get("/", (c) => {
  const divisions = listDivisions();
  return c.json(divisions);
});

// Get single division
divisionRoutes.get("/:id", (c) => {
  const division = getDivision(c.req.param("id"));
  if (!division) return c.json({ error: "Division not found" }, 404);
  return c.json(division);
});

// Create division
divisionRoutes.post("/", async (c) => {
  const body = await c.req.json();

  if (!body.name || !body.namespace) {
    return c.json({ error: "name and namespace are required" }, 400);
  }

  const division = createDivision({
    name: body.name,
    namespace: body.namespace,
    lead_agent_id: body.lead_agent_id ?? null,
    autonomy_policy: body.autonomy_policy ?? {
      max_cost_autonomous_usd: 10,
      approval_required_actions: [],
      auto_dispatch_enabled: true,
    },
    escalation_policy: body.escalation_policy ?? {
      escalate_to: "director",
      escalate_after_failures: 3,
      escalate_on_budget_breach: true,
    },
  });

  return c.json(division, 201);
});

// Update division
divisionRoutes.put("/:id", async (c) => {
  const body = await c.req.json();
  const division = updateDivision(c.req.param("id"), body);
  if (!division) return c.json({ error: "Division not found" }, 404);
  return c.json(division);
});

// Delete division
divisionRoutes.delete("/:id", (c) => {
  const deleted = deleteDivision(c.req.param("id"));
  if (!deleted) return c.json({ error: "Division not found" }, 404);
  return c.json({ ok: true });
});

// List agents belonging to this division
divisionRoutes.get("/:id/agents", (c) => {
  const division_id = c.req.param("id");
  const division = getDivision(division_id);
  if (!division) return c.json({ error: "Division not found" }, 404);

  const agents = listAgents({ division_id });
  return c.json(agents);
});

// Update autonomy policy for a division
divisionRoutes.put("/:id/autonomy", async (c) => {
  const body = await c.req.json();
  const division = updateDivision(c.req.param("id"), {
    autonomy_policy: body,
  });
  if (!division) return c.json({ error: "Division not found" }, 404);
  return c.json(division);
});
