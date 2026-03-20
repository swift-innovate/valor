import { Hono } from "hono";
import {
  submitCard,
  getCard,
  listCards,
  updateCard,
  approveCard,
  rejectCard,
  revokeCard,
} from "../db/repositories/agent-card-repo.js";
import { AgentRuntime } from "../types/index.js";

export const agentCardRoutes = new Hono();

// List all cards (filterable by ?status=pending&callsign=Alpha&operator=MyOrg)
agentCardRoutes.get("/", (c) => {
  const approval_status = c.req.query("status") || undefined;
  const callsign = c.req.query("callsign") || undefined;
  const operator = c.req.query("operator") || undefined;
  const cards = listCards({ approval_status, callsign, operator });
  return c.json(cards);
});

// Get single card
agentCardRoutes.get("/:id", (c) => {
  const card = getCard(c.req.param("id"));
  if (!card) return c.json({ error: "Agent card not found" }, 404);
  return c.json(card);
});

// Submit a new card
agentCardRoutes.post("/", async (c) => {
  const body = await c.req.json();

  if (!body.callsign || !body.name || !body.operator || !body.runtime) {
    return c.json({ error: "callsign, name, operator, and runtime are required" }, 400);
  }

  const parseResult = AgentRuntime.safeParse(body.runtime);
  if (!parseResult.success) {
    return c.json({ error: `Invalid runtime. Must be one of: ${AgentRuntime.options.join(", ")}` }, 400);
  }

  try {
    const card = submitCard({
      callsign: body.callsign,
      name: body.name,
      operator: body.operator,
      version: body.version,
      primary_skills: body.primary_skills ?? [],
      runtime: body.runtime,
      model: body.model ?? null,
      endpoint_url: body.endpoint_url ?? null,
      description: body.description ?? "",
    });
    return c.json(card, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("already registered") || message.includes("already has a pending")) {
      return c.json({ error: message }, 409);
    }
    throw err;
  }
});

// Update a pending card
agentCardRoutes.put("/:id", async (c) => {
  const body = await c.req.json();
  const card = updateCard(c.req.param("id"), body);
  if (!card) {
    // Distinguish between not found and not-pending
    const existing = getCard(c.req.param("id"));
    if (!existing) return c.json({ error: "Agent card not found" }, 404);
    return c.json({ error: "Can only update pending cards" }, 409);
  }
  return c.json(card);
});

// Approve a card
agentCardRoutes.post("/:id/approve", async (c) => {
  const body = await c.req.json();
  const approvedBy = body.approved_by ?? "director";

  const card = approveCard(c.req.param("id"), approvedBy);
  if (!card) {
    const existing = getCard(c.req.param("id"));
    if (!existing) return c.json({ error: "Agent card not found" }, 404);
    return c.json({ error: `Cannot approve card with status: ${existing.approval_status}` }, 409);
  }
  return c.json(card);
});

// Reject a card
agentCardRoutes.post("/:id/reject", async (c) => {
  const body = await c.req.json();
  if (!body.reason) {
    return c.json({ error: "reason is required" }, 400);
  }

  const card = rejectCard(c.req.param("id"), body.reason);
  if (!card) {
    const existing = getCard(c.req.param("id"));
    if (!existing) return c.json({ error: "Agent card not found" }, 404);
    return c.json({ error: `Cannot reject card with status: ${existing.approval_status}` }, 409);
  }
  return c.json(card);
});

// Revoke a previously approved card
agentCardRoutes.post("/:id/revoke", (c) => {
  const card = revokeCard(c.req.param("id"));
  if (!card) {
    const existing = getCard(c.req.param("id"));
    if (!existing) return c.json({ error: "Agent card not found" }, 404);
    return c.json({ error: `Cannot revoke card with status: ${existing.approval_status}` }, 409);
  }
  return c.json(card);
});
