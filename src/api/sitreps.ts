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
import { currentConnection } from "../nats/client.js";
import { publishSitrep } from "../nats/publishers.js";

/** Map old-style DB sitrep status → NATS sitrep status */
function toNatsStatus(status: SitrepStatus, objectivesPending: string[]): "IN_PROGRESS" | "COMPLETE" | "BLOCKED" | "FAILED" {
  if (status === "green" && objectivesPending.length === 0) return "COMPLETE";
  if (status === "green") return "IN_PROGRESS";
  if (status === "yellow") return "IN_PROGRESS";
  if (status === "red") return "FAILED";
  if (status === "hold" || status === "escalated") return "BLOCKED";
  return "IN_PROGRESS";
}

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

  // Bridge to NATS for VM- prefixed missions so the live dashboard updates
  if (body.mission_id.startsWith("VM-")) {
    const nc = currentConnection();
    if (nc) {
      const natsStatus = toNatsStatus(body.status as SitrepStatus, body.objectives_pending ?? []);
      publishSitrep(nc, agent.callsign, {
        mission_id: body.mission_id,
        operative: agent.callsign,
        status: natsStatus,
        progress_pct: natsStatus === "COMPLETE" ? 100 : (body.confidence === "high" ? 80 : 50),
        summary: body.summary,
        artifacts: [],
        blockers: body.blockers ?? [],
        next_steps: body.objectives_pending ?? [],
        tokens_used: body.tokens_used ?? null,
        timestamp: new Date().toISOString(),
      }).catch(() => {}); // Non-fatal
    }
  }

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
