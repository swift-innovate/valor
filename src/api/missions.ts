import { Hono, type Context } from "hono";
import {
  createMission,
  getMission,
  listMissions,
  transitionMission,
  resolveApproval,
  getPendingApproval,
  listApprovals,
} from "../db/index.js";
import { getDb } from "../db/database.js";
import {
  dispatchMission,
  processAAR,
  abortMission,
} from "../orchestrator/index.js";
import type { MissionStatus } from "../types/index.js";

export const missionRoutes = new Hono();

// Only the Director or system can create and dispatch missions.
// Agents that need missions created must send an escalation message to the Director or their designated Chief of Staff agent.
// This will be replaced with proper auth when the engine gets authentication.
function requireDirector(c: Context): Response | null {
  const role = c.req.header("X-VALOR-Role");
  if (role !== "director" && role !== "system") {
    return c.json({ error: "Only the Director can create missions" }, 403) as unknown as Response;
  }
  return null;
}

// List missions with optional filters
missionRoutes.get("/", (c) => {
  const status = c.req.query("status") as MissionStatus | undefined;
  const division_id = c.req.query("division_id");
  const assigned_agent_id = c.req.query("assigned_agent_id");

  const missions = listMissions({ status, division_id, assigned_agent_id });
  return c.json(missions);
});

// Get single mission
missionRoutes.get("/:id", (c) => {
  const mission = getMission(c.req.param("id"));
  if (!mission) return c.json({ error: "Mission not found" }, 404);
  return c.json(mission);
});

// Create mission
missionRoutes.post("/", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();

  const mission = createMission({
    division_id: body.division_id ?? null,
    title: body.title,
    objective: body.objective,
    status: "draft",
    phase: null,
    assigned_agent_id: body.assigned_agent_id ?? null,
    priority: body.priority ?? "normal",
    constraints: body.constraints ?? [],
    deliverables: body.deliverables ?? [],
    success_criteria: body.success_criteria ?? [],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: body.max_revisions ?? 3,
    parent_mission_id: body.parent_mission_id ?? null,
    dispatched_at: null,
    completed_at: null,
  });

  return c.json(mission, 201);
});

// Create mission from SIGINT intercept
missionRoutes.post("/from-sigint", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json();

  // Validate required fields
  if (!body.title || !body.objective) {
    return c.json({ error: "Missing required fields: title, objective" }, 400);
  }
  if (!body.source || !body.source.intercept_id) {
    return c.json({ error: "Missing required field: source with intercept_id" }, 400);
  }

  // Create the mission
  const mission = createMission({
    division_id: body.division_id ?? null,
    title: body.title,
    objective: body.objective,
    status: "draft",
    phase: null,
    assigned_agent_id: body.assigned_agent_id ?? null,
    priority: body.priority ?? "normal",
    constraints: body.constraints ?? [],
    deliverables: body.deliverables ?? [],
    success_criteria: body.success_criteria ?? [],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: body.max_revisions ?? 3,
    parent_mission_id: null,
    dispatched_at: null,
    completed_at: null,
  });

  // Store source metadata
  getDb().execute("UPDATE missions SET source_metadata = @metadata WHERE id = @id", {
    id: mission.id,
    metadata: JSON.stringify(body.source),
  });

  // Determine which gates would be pending
  const gatesPending = ["hil"];

  return c.json(
    {
      mission_id: mission.id,
      status: mission.status,
      gates_pending: gatesPending,
    },
    201,
  );
});

// Queue a draft mission for dispatch
missionRoutes.post("/:id/queue", (c) => {
  const mission = getMission(c.req.param("id"));
  if (!mission) return c.json({ error: "Mission not found" }, 404);
  if (mission.status !== "draft") {
    return c.json({ error: `Cannot queue mission in "${mission.status}" status` }, 400);
  }

  transitionMission(mission.id, "queued");

  return c.json(getMission(mission.id));
});

// Dispatch a mission (evaluate gates + send to provider)
missionRoutes.post("/:id/dispatch", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  try {
    const result = dispatchMission(c.req.param("id"));
    const status = result.dispatched ? 200 : 202;
    return c.json(result, status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Approve a pending approval
missionRoutes.post("/:id/approve", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const missionId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const pending = getPendingApproval(missionId);
  if (!pending) return c.json({ error: "No pending approval for this mission" }, 404);

  const resolved = resolveApproval(pending.id, {
    status: "approved",
    resolved_by: body.resolved_by ?? "director",
    reason: body.reason,
  });

  return c.json(resolved);
});

// Reject a pending approval
missionRoutes.post("/:id/reject", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const missionId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const pending = getPendingApproval(missionId);
  if (!pending) return c.json({ error: "No pending approval for this mission" }, 404);

  const resolved = resolveApproval(pending.id, {
    status: "rejected",
    resolved_by: body.resolved_by ?? "director",
    reason: body.reason,
  });

  return c.json(resolved);
});

// Process AAR (approve or reject the after-action review)
missionRoutes.post("/:id/aar", async (c) => {
  const body = await c.req.json();
  try {
    const mission = processAAR(c.req.param("id"), body.approved === true);
    return c.json(mission);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Abort a mission
missionRoutes.post("/:id/abort", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  try {
    const mission = abortMission(c.req.param("id"), body.reason ?? "Aborted by Director");
    return c.json(mission);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// List approvals for a mission
missionRoutes.get("/:id/approvals", (c) => {
  const approvals = listApprovals({ mission_id: c.req.param("id") });
  return c.json(approvals);
});
