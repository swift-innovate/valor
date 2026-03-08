import { Hono } from "hono";
import {
  createSitrep,
  listSitreps,
  getSitrep,
  getLatestSitrep,
  getAgent,
  getMission,
} from "../db/index.js";
import { publish } from "../bus/index.js";
import type { MissionPhase, SitrepStatus } from "../types/index.js";

const VALID_PHASES: MissionPhase[] = ["V", "A", "L", "O", "R"];
const VALID_STATUSES: SitrepStatus[] = ["green", "yellow", "red", "hold", "escalated"];

export const sitrepRoutes = new Hono();

// List sitreps with optional filters
sitrepRoutes.get("/", (c) => {
  const mission_id = c.req.query("mission_id");
  const agent_id = c.req.query("agent_id");
  return c.json(listSitreps({ mission_id, agent_id }));
});

// Get single sitrep
sitrepRoutes.get("/:id", (c) => {
  const sitrep = getSitrep(c.req.param("id"));
  if (!sitrep) return c.json({ error: "Sitrep not found" }, 404);
  return c.json(sitrep);
});

// Get latest sitrep for a mission
sitrepRoutes.get("/mission/:missionId/latest", (c) => {
  const sitrep = getLatestSitrep(c.req.param("missionId"));
  if (!sitrep) return c.json({ error: "No sitreps for this mission" }, 404);
  return c.json(sitrep);
});

// Ingest a sitrep from an agent
sitrepRoutes.post("/", async (c) => {
  const body = await c.req.json();

  // Validate required fields
  if (!body.mission_id || !body.agent_id || !body.phase || !body.status || !body.summary) {
    return c.json(
      { error: "mission_id, agent_id, phase, status, and summary are required" },
      400,
    );
  }

  if (!VALID_PHASES.includes(body.phase)) {
    return c.json({ error: `Invalid phase. Must be one of: ${VALID_PHASES.join(", ")}` }, 400);
  }

  if (!VALID_STATUSES.includes(body.status)) {
    return c.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }

  // Verify agent exists
  const agent = getAgent(body.agent_id);
  if (!agent) return c.json({ error: "Agent not found" }, 404);

  // Verify mission exists
  const mission = getMission(body.mission_id);
  if (!mission) return c.json({ error: "Mission not found" }, 404);

  const sitrep = createSitrep({
    mission_id: body.mission_id,
    agent_id: body.agent_id,
    phase: body.phase,
    status: body.status,
    summary: body.summary,
    objectives_complete: body.objectives_complete ?? [],
    objectives_pending: body.objectives_pending ?? [],
    blockers: body.blockers ?? [],
    learnings: body.learnings ?? [],
    confidence: body.confidence ?? "medium",
    tokens_used: body.tokens_used ?? 0,
    delivered_to: body.delivered_to ?? [],
  });

  // Publish sitrep event — broadcasts to dashboard via WebSocket
  publish({
    type: "sitrep.received",
    source: { id: body.agent_id, type: "agent" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { ...sitrep },
    metadata: null,
  });

  // If sitrep status is escalated, publish escalation event
  if (sitrep.status === "escalated") {
    publish({
      type: "sitrep.escalated",
      source: { id: body.agent_id, type: "agent" },
      target: { id: "director", type: "director" },
      conversation_id: null,
      in_reply_to: null,
      payload: {
        mission_id: body.mission_id,
        agent_id: body.agent_id,
        summary: body.summary,
        blockers: sitrep.blockers,
      },
      metadata: null,
    });
  }

  return c.json(sitrep, 201);
});
