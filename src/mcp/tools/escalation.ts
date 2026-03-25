import {
  getMission,
  createApproval,
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

export function handleRequestEscalation(
  args: {
    mission_id: string;
    reason: string;
    options?: string[];
    urgency?: string;
  },
  agentId: string,
): CallToolResult {
  if (!args.mission_id) return err("mission_id is required");
  if (!args.reason) return err("reason is required");

  const mission = getMission(args.mission_id);
  if (!mission) return err("Mission not found");

  const isAssigned = mission.assigned_agent_id === agentId;
  const inDivision = mission.division_id
    ? getAgentDivisions(agentId).some((d) => d.division_id === mission.division_id)
    : false;

  if (!isAssigned && !inDivision) {
    return err("Access denied: mission not assigned to this agent or division");
  }

  const approval = createApproval({
    mission_id: args.mission_id,
    gate: "escalation",
    requested_by: agentId,
  });

  publish({
    type: "mission.approval.requested",
    source: { id: agentId, type: "agent" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      approval_id: approval.id,
      mission_id: args.mission_id,
      reason: args.reason,
      options: args.options ?? [],
      urgency: args.urgency ?? "normal",
    },
    metadata: null,
  });

  return ok({
    escalation_id: approval.id,
    status: "pending",
    mission_id: args.mission_id,
  });
}
