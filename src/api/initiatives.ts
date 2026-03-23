import { Hono } from "hono";
import {
  createInitiative,
  getInitiative,
  listInitiatives,
  updateInitiative,
  getInitiativeProgress,
  assignMissionToInitiative,
  getMission,
} from "../db/index.js";
import { requireDirector } from "../auth/index.js";
import type { InitiativeStatus, InitiativePriority } from "../db/repositories/initiative-repo.js";

export const initiativeRoutes = new Hono();

const VALID_STATUSES = new Set<InitiativeStatus>(["active", "paused", "complete", "cancelled"]);
const VALID_PRIORITIES = new Set<InitiativePriority>(["critical", "high", "normal", "low"]);

// ── POST /initiatives — Create (Director only) ────────────────────────

initiativeRoutes.post("/", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();

  if (!body.title || typeof body.title !== "string") {
    return c.json({ error: "title is required" }, 400);
  }
  if (!body.objective || typeof body.objective !== "string") {
    return c.json({ error: "objective is required" }, 400);
  }
  if (body.status && !VALID_STATUSES.has(body.status)) {
    return c.json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
  }
  if (body.priority && !VALID_PRIORITIES.has(body.priority)) {
    return c.json({ error: `Invalid priority. Must be one of: ${[...VALID_PRIORITIES].join(", ")}` }, 400);
  }

  const initiative = createInitiative({
    title: body.title,
    objective: body.objective,
    status: body.status,
    owner: body.owner ?? null,
    priority: body.priority,
    target_date: body.target_date ?? null,
  });

  return c.json(initiative, 201);
});

// ── GET /initiatives — List ───────────────────────────────────────────

initiativeRoutes.get("/", (c) => {
  const status = c.req.query("status") as InitiativeStatus | undefined;
  const owner = c.req.query("owner");
  const priority = c.req.query("priority") as InitiativePriority | undefined;

  if (status && !VALID_STATUSES.has(status)) {
    return c.json({ error: "Invalid status filter" }, 400);
  }

  const initiatives = listInitiatives({
    status,
    owner: owner || undefined,
    priority,
  });

  return c.json(initiatives);
});

// ── GET /initiatives/:id — Get with progress ─────────────────────────

initiativeRoutes.get("/:id", (c) => {
  const initiative = getInitiative(c.req.param("id"));
  if (!initiative) return c.json({ error: "Initiative not found" }, 404);

  const progress = getInitiativeProgress(initiative.id);
  return c.json({ ...initiative, progress });
});

// ── PUT /initiatives/:id — Update (Director only) ────────────────────

initiativeRoutes.put("/:id", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const initiative = getInitiative(c.req.param("id"));
  if (!initiative) return c.json({ error: "Initiative not found" }, 404);

  const body = await c.req.json();

  if (body.status && !VALID_STATUSES.has(body.status)) {
    return c.json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
  }
  if (body.priority && !VALID_PRIORITIES.has(body.priority)) {
    return c.json({ error: `Invalid priority. Must be one of: ${[...VALID_PRIORITIES].join(", ")}` }, 400);
  }

  const updated = updateInitiative(c.req.param("id"), {
    title: body.title,
    objective: body.objective,
    status: body.status,
    owner: body.owner,
    priority: body.priority,
    target_date: body.target_date,
  });

  return c.json(updated);
});

// ── POST /initiatives/:id/missions — Assign mission ──────────────────

initiativeRoutes.post("/:id/missions", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const initiative = getInitiative(c.req.param("id"));
  if (!initiative) return c.json({ error: "Initiative not found" }, 404);

  const body = await c.req.json();
  if (!body.mission_id) return c.json({ error: "mission_id is required" }, 400);

  const mission = getMission(body.mission_id);
  if (!mission) return c.json({ error: "Mission not found" }, 404);

  const ok = assignMissionToInitiative(body.mission_id, c.req.param("id"));
  if (!ok) return c.json({ error: "Assignment failed" }, 500);

  return c.json({ initiative_id: c.req.param("id"), mission_id: body.mission_id }, 200);
});

// ── DELETE /initiatives/:id — Cancel (Director only) ─────────────────

initiativeRoutes.delete("/:id", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const initiative = getInitiative(c.req.param("id"));
  if (!initiative) return c.json({ error: "Initiative not found" }, 404);

  updateInitiative(c.req.param("id"), { status: "cancelled" });
  return c.json({ cancelled: true }, 200);
});
