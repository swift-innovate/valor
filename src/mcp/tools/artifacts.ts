import {
  getMission,
  createArtifact,
  getAgentDivisions,
} from "../../db/index.js";

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

export function handleSubmitArtifacts(
  args: {
    mission_id: string;
    artifacts: Array<{ title: string; type: string; content: string; filename?: string }>;
  },
  agentId: string,
): CallToolResult {
  if (!args.mission_id) return err("mission_id is required");
  if (!args.artifacts?.length) return err("At least one artifact is required");

  const mission = getMission(args.mission_id);
  if (!mission) return err("Mission not found");

  const isAssigned = mission.assigned_agent_id === agentId;
  const inDivision = mission.division_id
    ? getAgentDivisions(agentId).some((d) => d.division_id === mission.division_id)
    : false;

  if (!isAssigned && !inDivision) {
    return err("Access denied: mission not assigned to this agent or division");
  }

  const ids: string[] = [];
  for (const art of args.artifacts) {
    const created = createArtifact({
      title: art.title,
      content_type: art.type,
      content: art.content,
      summary: art.filename ?? null,
      created_by: agentId,
    });
    ids.push(created.id);
  }

  return ok({ artifact_ids: ids });
}
