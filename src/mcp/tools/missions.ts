import {
  getAgent,
  getMission,
  transitionMission,
  createSitrep,
  createArtifact,
  getAgentDivisions,
} from "../../db/index.js";
import { publish } from "../../bus/event-bus.js";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function agentHasAccess(agentId: string, mission: { assigned_agent_id?: string | null; division_id?: string | null }): boolean {
  if (mission.assigned_agent_id === agentId) return true;
  if (mission.division_id) {
    const divisions = getAgentDivisions(agentId);
    return divisions.some((d) => d.division_id === mission.division_id);
  }
  return false;
}

export function handleAcceptMission(
  args: { mission_id: string },
  agentId: string,
): CallToolResult {
  if (!args.mission_id) return err("mission_id is required");

  const agent = getAgent(agentId);
  if (!agent) return err("Agent not found");

  const mission = getMission(args.mission_id);
  if (!mission) return err("Mission not found");

  if (!agentHasAccess(agentId, mission)) {
    return err("Mission not assigned to this agent or division");
  }

  if (mission.status !== "queued" && mission.status !== "gated") {
    return err(`Cannot accept mission in status '${mission.status}'`);
  }

  try {
    // Walk through transitions to reach dispatched
    let current = mission.status;
    if (current === "queued") {
      transitionMission(args.mission_id, "gated");
      current = "gated";
    }
    if (current === "gated") {
      transitionMission(args.mission_id, "dispatched");
    }
  } catch (e) {
    return err(`Transition failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  publish({
    type: "mission.accepted",
    source: { id: agentId, type: "agent" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: args.mission_id, agent_id: agentId },
    metadata: null,
  });

  const updated = getMission(args.mission_id);
  return ok(updated);
}

export function handleGetMissionBrief(
  args: { mission_id: string },
  agentId: string,
): CallToolResult {
  if (!args.mission_id) return err("mission_id is required");

  const mission = getMission(args.mission_id);
  if (!mission) return err("Mission not found");

  if (!agentHasAccess(agentId, mission)) {
    return err("Access denied: mission not assigned to this agent or division");
  }

  return ok(mission);
}

export function handleCompleteMission(
  args: {
    mission_id: string;
    summary: string;
    artifacts?: Array<{ title: string; type: string; content: string }>;
    learnings?: string[];
  },
  agentId: string,
): CallToolResult {
  if (!args.mission_id) return err("mission_id is required");
  if (!args.summary) return err("summary is required");

  const mission = getMission(args.mission_id);
  if (!mission) return err("Mission not found");

  if (!agentHasAccess(agentId, mission)) {
    return err("Access denied: mission not assigned to this agent or division");
  }

  // Transition to complete (may need streaming first)
  try {
    if (mission.status === "dispatched") {
      transitionMission(args.mission_id, "streaming");
    }
    if (mission.status === "streaming" || getMission(args.mission_id)!.status === "streaming") {
      transitionMission(args.mission_id, "complete");
    }
  } catch (e) {
    return err(`Transition failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  createSitrep({
    mission_id: args.mission_id,
    agent_id: agentId,
    phase: "R",
    status: "green",
    summary: args.summary,
    objectives_complete: [],
    objectives_pending: [],
    blockers: [],
    learnings: args.learnings ?? [],
    confidence: "high",
    tokens_used: 0,
    delivered_to: [],
  });

  const artifactIds: string[] = [];
  if (args.artifacts?.length) {
    for (const art of args.artifacts) {
      const created = createArtifact({
        title: art.title,
        content_type: art.type,
        content: art.content,
        created_by: agentId,
      });
      artifactIds.push(created.id);
    }
  }

  publish({
    type: "mission.completed",
    source: { id: agentId, type: "agent" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      mission_id: args.mission_id,
      agent_id: agentId,
      summary: args.summary,
      artifact_ids: artifactIds,
    },
    metadata: null,
  });

  return ok({
    mission_id: args.mission_id,
    status: "complete",
    artifact_ids: artifactIds,
  });
}
