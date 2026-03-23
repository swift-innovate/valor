/**
 * Live Mission Management API — NATS-backed
 *
 * Endpoints for creating, cancelling, retrying, reassigning, and
 * archiving missions via the NATS live state.
 *
 * All mutations publish through NATS — the dashboard never writes
 * directly to the DB. State is maintained in nats-state.ts.
 *
 * Mission: VM-025
 * Operative: Mira
 */

import { Hono } from "hono";
import { natsState } from "../dashboard/nats-state.js";
import { currentConnection } from "../nats/client.js";
import {
  publishMissionBrief,
  publishSitrep,
} from "../nats/publishers.js";
import type { MissionBrief, NatsSitrep, SitrepArtifact } from "../nats/types.js";
import type { MissionBrief as NatsMissionBrief } from "../types/nats.js";
import { createArtifact } from "../db/index.js";

export const missionsLiveRoutes = new Hono();

// ── Helpers ──────────────────────────────────────────────────────────

function generateMissionId(): string {
  const num = Math.floor(Math.random() * 900) + 100;
  return `VM-${num}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── POST /api/missions-live — Create mission ─────────────────────────

missionsLiveRoutes.post("/", async (c) => {
  const body = await c.req.json();

  if (!body.title || !body.description) {
    return c.json({ error: "Title and description are required" }, 400);
  }

  const assigned_to: string = body.assigned_to || "";
  const routeThroughDirector = !assigned_to || assigned_to.toLowerCase() === "director";

  const nc = currentConnection();

  // ── Path A: no operative specified → route through Director for classification
  if (routeThroughDirector) {
    if (!nc) {
      return c.json({ error: "NATS not connected — cannot route to Director" }, 503);
    }
    const mission_id = generateMissionId();
    const created = now();
    const missionText = `${body.title}\n\n${body.description}`;
    const envelope = JSON.stringify({
      id: mission_id,
      timestamp: created,
      source: "dashboard",
      type: "mission.inbound",
      payload: { text: missionText },
    });
    try {
      nc.publish("valor.missions.inbound", new TextEncoder().encode(envelope));
    } catch (err) {
      return c.json({ error: "Failed to route to Director" }, 500);
    }

    // Pre-seed nats-state so the parent appears on the board with correct
    // title/description while the Director classifies. The Director will use
    // this same ID as its mission prefix (VM-NNN → VM-NNN-1, VM-NNN-2, etc).
    const brief: MissionBrief = {
      mission_id,
      title: body.title,
      description: body.description || "",
      priority: (body.priority || "P2") as MissionBrief["priority"],
      assigned_to: "director",
      depends_on: [],
      parent_mission: null,
      model_tier: "balanced" as MissionBrief["model_tier"],
      acceptance_criteria: [],
      context_refs: [],
      deadline: null,
      created_at: created,
    };
    natsState.handleMissionBrief({
      id: mission_id,
      timestamp: created,
      source: "dashboard",
      type: "mission.brief",
      payload: brief as unknown as NatsMissionBrief,
    });

    return c.json({
      mission_id,
      status: "routed",
      assigned_to: "director",
      message: "Mission sent to Director for classification and routing",
    }, 202);
  }

  // ── Path B: operative specified → publish directly to their queue
  const mission_id = generateMissionId();
  const priority = body.priority || "P2";
  const model_tier = body.model_tier || "balanced";

  const brief: MissionBrief = {
    mission_id,
    title: body.title,
    description: body.description,
    priority,
    assigned_to,
    depends_on: body.depends_on || [],
    parent_mission: body.parent_mission || null,
    model_tier,
    acceptance_criteria: body.acceptance_criteria || [],
    context_refs: body.context_refs || [],
    deadline: body.deadline || null,
    created_at: now(),
  };

  if (nc) {
    try {
      await publishMissionBrief(nc, "dashboard", brief);
    } catch (err) {
      console.error("[missions-live] NATS publish failed:", err);
    }
  }

  natsState.handleMissionBrief({
    id: mission_id,
    timestamp: now(),
    source: "dashboard",
    type: "mission.brief",
    payload: brief as unknown as NatsMissionBrief,
  });

  return c.json({
    mission_id,
    status: "pending",
    assigned_to,
    message: `Mission ${mission_id} dispatched to ${assigned_to}`,
  }, 201);
});

// ── POST /api/missions-live/:id/cancel ───────────────────────────────

missionsLiveRoutes.post("/:id/cancel", async (c) => {
  const mission_id = c.req.param("id");
  const mission = natsState.getMission(mission_id);

  if (!mission) {
    return c.json({ error: `Mission ${mission_id} not found` }, 404);
  }

  if (mission.status === "complete" || mission.status === "failed") {
    return c.json({ error: `Cannot cancel mission in "${mission.status}" state` }, 400);
  }

  // Publish cancel sitrep via NATS
  const nc = currentConnection();
  if (nc) {
    const sitrep: NatsSitrep = {
      mission_id,
      operative: mission.assigned_to,
      status: "FAILED",
      progress_pct: mission.progress_pct ?? 0,
      summary: "Mission cancelled by Principal",
      artifacts: [],
      blockers: [],
      next_steps: [],
      tokens_used: null,
      timestamp: now(),
    };
    try {
      await publishSitrep(nc, "dashboard", sitrep);
    } catch (err) {
      console.error("[missions-live] NATS cancel sitrep failed:", err);
    }
  }

  // Update local state and queue abort directive for the operative
  natsState.updateMissionStatus(mission_id, "failed");
  natsState.pushDirective(mission.assigned_to, {
    type: "abort",
    mission_id,
    reason: "Mission cancelled by Principal",
    issued_at: now(),
  });

  return c.json({
    mission_id,
    status: "failed",
    message: `Mission ${mission_id} cancelled`,
  });
});

// ── POST /api/missions-live/:id/retry ────────────────────────────────

missionsLiveRoutes.post("/:id/retry", async (c) => {
  const mission_id = c.req.param("id");
  const mission = natsState.getMission(mission_id);

  if (!mission) {
    return c.json({ error: `Mission ${mission_id} not found` }, 404);
  }

  if (mission.status !== "failed") {
    return c.json({ error: `Can only retry FAILED missions (current: ${mission.status})` }, 400);
  }

  // Re-publish the mission brief via NATS
  const nc = currentConnection();
  if (nc) {
    const brief: MissionBrief = {
      mission_id,
      title: mission.title,
      description: mission.description,
      priority: mission.priority,
      assigned_to: mission.assigned_to,
      depends_on: [],
      parent_mission: null,
      model_tier: "balanced",
      acceptance_criteria: [],
      context_refs: [],
      deadline: null,
      created_at: mission.created_at,
    };
    try {
      await publishMissionBrief(nc, "dashboard", brief);
    } catch (err) {
      console.error("[missions-live] NATS retry publish failed:", err);
    }

    // Also publish a sitrep noting the retry
    const sitrep: NatsSitrep = {
      mission_id,
      operative: mission.assigned_to,
      status: "ACCEPTED",
      progress_pct: 0,
      summary: `Mission retried by Principal at ${now()}`,
      artifacts: [],
      blockers: [],
      next_steps: [],
      tokens_used: null,
      timestamp: now(),
    };
    try {
      await publishSitrep(nc, "dashboard", sitrep);
    } catch (err) {
      console.error("[missions-live] NATS retry sitrep failed:", err);
    }
  }

  // Update local state
  natsState.retryMission(mission_id);

  return c.json({
    mission_id,
    status: "pending",
    message: `Mission ${mission_id} queued for retry`,
  });
});

// ── POST /api/missions-live/:id/reassign ─────────────────────────────

missionsLiveRoutes.post("/:id/reassign", async (c) => {
  const mission_id = c.req.param("id");
  const body = await c.req.json();
  const new_operative = body.operative;

  if (!new_operative) {
    return c.json({ error: "operative field is required" }, 400);
  }

  const mission = natsState.getMission(mission_id);
  if (!mission) {
    return c.json({ error: `Mission ${mission_id} not found` }, 404);
  }

  if (mission.status === "complete" || mission.status === "failed") {
    return c.json({ error: `Cannot reassign mission in "${mission.status}" state` }, 400);
  }

  const old_operative = mission.assigned_to;

  // Publish cancel sitrep for old operative
  const nc = currentConnection();
  if (nc) {
    const cancelSitrep: NatsSitrep = {
      mission_id,
      operative: old_operative,
      status: "FAILED",
      progress_pct: mission.progress_pct ?? 0,
      summary: `Mission reassigned from ${old_operative} to ${new_operative} by Principal`,
      artifacts: [],
      blockers: [],
      next_steps: [],
      tokens_used: null,
      timestamp: now(),
    };
    try {
      await publishSitrep(nc, "dashboard", cancelSitrep);
    } catch (err) {
      console.error("[missions-live] NATS reassign cancel sitrep failed:", err);
    }

    // Re-publish brief to new operative
    const brief: MissionBrief = {
      mission_id,
      title: mission.title,
      description: mission.description,
      priority: mission.priority,
      assigned_to: new_operative,
      depends_on: [],
      parent_mission: null,
      model_tier: "balanced",
      acceptance_criteria: [],
      context_refs: [],
      deadline: null,
      created_at: mission.created_at,
    };
    try {
      await publishMissionBrief(nc, "dashboard", brief);
    } catch (err) {
      console.error("[missions-live] NATS reassign brief failed:", err);
    }
  }

  // Update local state; abort directive for old operative, none for new (brief handles pickup)
  natsState.reassignMission(mission_id, new_operative);
  natsState.pushDirective(old_operative, {
    type: "abort",
    mission_id,
    reason: `Mission reassigned to ${new_operative} by Principal`,
    issued_at: now(),
  });

  return c.json({
    mission_id,
    status: "pending",
    old_operative,
    new_operative,
    message: `Mission ${mission_id} reassigned from ${old_operative} to ${new_operative}`,
  });
});

// ── POST /api/missions-live/:id/sitrep ───────────────────────────────
// NATS-native sitrep submission. Agents that speak the NATS format use this.
// Simpler path: callsign + status + summary (no agent_id / phase / DB lookup needed).

missionsLiveRoutes.post("/:id/sitrep", async (c) => {
  const mission_id = c.req.param("id");
  const body = await c.req.json();

  const { operative, status, summary, progress_pct, blockers, next_steps, tokens_used } = body;

  if (!operative || !status || !summary) {
    return c.json({ error: "operative, status, and summary are required" }, 400);
  }

  const validStatuses = ["ACCEPTED", "IN_PROGRESS", "BLOCKED", "COMPLETE", "FAILED"];
  if (!validStatuses.includes(status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(", ")}` }, 400);
  }

  // Auto-create artifacts from inline deliverable content.
  // Agents may pass either:
  //   artifacts: [{type, label, ref}]          — references to external work
  //   deliverables: [{title, content_type, content, language?, summary?}]  — inline content
  const artifactRefs: SitrepArtifact[] = body.artifacts ?? [];
  const createdArtifactIds: string[] = [];

  if (Array.isArray(body.deliverables)) {
    for (const d of body.deliverables) {
      if (!d.title || !d.content_type || !d.content) continue;
      try {
        const artifact = createArtifact({
          title: d.title,
          content_type: d.content_type,
          language: d.language ?? null,
          content: d.content,
          summary: d.summary ?? null,
          created_by: operative,
          conversation_id: mission_id,
        });
        createdArtifactIds.push(artifact.id);
        artifactRefs.push({ type: "note", label: d.title, ref: artifact.id });
      } catch {
        // Non-fatal — continue with remaining deliverables
      }
    }
  }

  const nc = currentConnection();
  const sitrep: NatsSitrep = {
    mission_id,
    operative,
    status,
    progress_pct: progress_pct ?? (status === "COMPLETE" ? 100 : null),
    summary,
    artifacts: artifactRefs,
    blockers: blockers ?? [],
    next_steps: next_steps ?? [],
    tokens_used: tokens_used ?? null,
    timestamp: new Date().toISOString(),
  };

  if (nc) {
    try {
      await publishSitrep(nc, operative, sitrep);
    } catch (err) {
      console.error("[missions-live] sitrep publish failed:", err);
    }
  }

  // Also update local state directly for immediate dashboard refresh
  natsState.handleSitrep({
    id: `${mission_id}-${Date.now()}`,
    timestamp: sitrep.timestamp,
    source: operative,
    type: "sitrep",
    payload: sitrep,
  });

  return c.json({
    mission_id,
    status,
    message: "Sitrep accepted",
    artifacts_created: createdArtifactIds,
  }, 201);
});

// ── POST /api/missions-live/:id/archive ──────────────────────────────

missionsLiveRoutes.post("/:id/archive", (c) => {
  const mission_id = c.req.param("id");
  const success = natsState.archiveMission(mission_id);

  if (!success) {
    return c.json({ error: `Mission ${mission_id} not found` }, 404);
  }

  return c.json({
    mission_id,
    message: `Mission ${mission_id} archived`,
  });
});

// ── POST /api/missions-live/archive-completed ────────────────────────

missionsLiveRoutes.post("/archive-completed", (c) => {
  const count = natsState.archiveCompleted();
  return c.json({
    count,
    message: `Archived ${count} completed/failed missions`,
  });
});

// ── POST /api/missions-live/purge-tests ──────────────────────────────

missionsLiveRoutes.post("/purge-tests", (c) => {
  const count = natsState.purgeTestMissions();
  return c.json({
    count,
    message: `Purged ${count} test missions`,
  });
});

// ── GET /api/missions-live — List missions ───────────────────────────

missionsLiveRoutes.get("/", (c) => {
  const status = c.req.query("status") as any;
  const operative = c.req.query("operative");
  const archived = c.req.query("archived") === "true";

  if (archived) {
    return c.json(natsState.getArchivedMissions());
  }

  return c.json(natsState.getMissions({ status, operative }));
});

// ── GET /api/missions-live/directives/:callsign ──────────────────────
// Agents poll this to receive abort/pause directives. Drains on read.

missionsLiveRoutes.get("/directives/:callsign", (c) => {
  const callsign = c.req.param("callsign");
  const directives = natsState.drainDirectives(callsign);
  return c.json({ callsign, directives });
});

// ── GET /api/missions-live/:id — Get mission detail ──────────────────

missionsLiveRoutes.get("/:id", (c) => {
  const mission = natsState.getMission(c.req.param("id"));
  if (!mission) {
    return c.json({ error: "Mission not found" }, 404);
  }

  return c.json({
    ...mission,
    sitreps: natsState.getSitrepHistory(mission.mission_id),
  });
});
