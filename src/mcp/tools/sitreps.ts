import {
  createSitrep,
  createArtifact,
  getMission,
} from "../../db/index.js";
import { publish } from "../../bus/event-bus.js";
import type { MissionPhase, SitrepStatus } from "../../types/index.js";

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

export function handleSubmitSitrep(
  args: {
    mission_id: string;
    phase: string;
    status: string;
    summary: string;
    objectives_complete?: string[];
    objectives_pending?: string[];
    blockers?: string[];
    artifacts?: Array<{ title: string; type: string; content: string }>;
  },
  agentId: string,
): CallToolResult {
  if (!args.mission_id) return err("mission_id is required");
  if (!args.phase) return err("phase is required");
  if (!args.status) return err("status is required");
  if (!args.summary) return err("summary is required");

  const validPhases = ["V", "A", "L", "O", "R"];
  if (!validPhases.includes(args.phase)) {
    return err(`Invalid phase '${args.phase}'. Must be one of: ${validPhases.join(", ")}`);
  }

  const validStatuses = ["green", "yellow", "red", "hold", "escalated"];
  if (!validStatuses.includes(args.status)) {
    return err(`Invalid status '${args.status}'. Must be one of: ${validStatuses.join(", ")}`);
  }

  const mission = getMission(args.mission_id);
  if (!mission) return err("Mission not found");

  const sitrep = createSitrep({
    mission_id: args.mission_id,
    agent_id: agentId,
    phase: args.phase as MissionPhase,
    status: args.status as SitrepStatus,
    summary: args.summary,
    objectives_complete: args.objectives_complete ?? [],
    objectives_pending: args.objectives_pending ?? [],
    blockers: args.blockers ?? [],
    learnings: [],
    confidence: "medium",
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
    type: "sitrep.received",
    source: { id: agentId, type: "agent" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      sitrep_id: sitrep.id,
      mission_id: args.mission_id,
      phase: args.phase,
      status: args.status,
      summary: args.summary,
    },
    metadata: null,
  });

  const needsEscalation = args.status === "red" || args.status === "escalated";

  return ok({
    sitrep_id: sitrep.id,
    ...(needsEscalation && {
      escalation: {
        triggered: true,
        reason: `Sitrep status is '${args.status}'`,
      },
    }),
    artifact_ids: artifactIds,
  });
}
