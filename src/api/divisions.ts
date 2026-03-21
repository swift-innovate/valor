import { Hono } from "hono";
import {
  createDivision,
  getDivision,
  listDivisions,
  updateDivision,
  deleteDivision,
  listAgents,
  getRoster,
  addMember,
  removeMember,
  updateMemberRole,
  transferLead,
  getDivisionLead,
} from "../db/index.js";

import { requireDirector } from "../auth/index.js";

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
  const denied = requireDirector(c);
  if (denied) return denied;

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
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();
  const division = updateDivision(c.req.param("id"), body);
  if (!division) return c.json({ error: "Division not found" }, 404);
  return c.json(division);
});

// Delete division
divisionRoutes.delete("/:id", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  try {
    const deleted = deleteDivision(c.req.param("id"));
    if (!deleted) return c.json({ error: "Division not found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot delete division")) {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
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
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();
  const division = updateDivision(c.req.param("id"), {
    autonomy_policy: body,
  });
  if (!division) return c.json({ error: "Division not found" }, 404);
  return c.json(division);
});

// Get division roster
divisionRoutes.get("/:id/roster", (c) => {
  const division = getDivision(c.req.param("id"));
  if (!division) return c.json({ error: "Division not found" }, 404);
  return c.json(getRoster(c.req.param("id")));
});

// Add member to division
divisionRoutes.post("/:id/members", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();
  try {
    const member = addMember({
      division_id: c.req.param("id"),
      agent_id: body.agent_id,
      role: body.role ?? "member",
      assigned_by: c.req.header("X-VALOR-Role") ?? "director",
    });
    return c.json(member, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Division not found") || msg.includes("Agent not found")) {
      return c.json({ error: msg }, 404);
    }
    if (msg.includes("already a member")) {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
});

// Remove member from division
divisionRoutes.delete("/:id/members/:agentId", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  try {
    const removed = removeMember(c.req.param("id"), c.req.param("agentId"), "director");
    if (!removed) return c.json({ error: "Membership not found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot remove division lead")) {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
});

// Update member role
divisionRoutes.put("/:id/members/:agentId/role", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();
  try {
    const member = updateMemberRole(
      c.req.param("id"),
      c.req.param("agentId"),
      body.role,
      c.req.header("X-VALOR-Role") ?? "director",
    );
    if (!member) return c.json({ error: "Membership not found" }, 404);
    return c.json(member);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot promote") || msg.includes("Cannot demote")) {
      return c.json({ error: msg }, 400);
    }
    throw err;
  }
});

// Transfer division lead
divisionRoutes.post("/:id/lead", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();
  try {
    const lead = transferLead(
      c.req.param("id"),
      body.agent_id,
      c.req.header("X-VALOR-Role") ?? "director",
    );
    return c.json(lead);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Division not found") || msg.includes("Agent not found")) {
      return c.json({ error: msg }, 404);
    }
    throw err;
  }
});

// Get division lead
divisionRoutes.get("/:id/lead", (c) => {
  const division = getDivision(c.req.param("id"));
  if (!division) return c.json({ error: "Division not found" }, 404);
  const lead = getDivisionLead(c.req.param("id"));
  if (!lead) return c.json({ error: "No lead assigned" }, 404);
  return c.json(lead);
});
