import {
  getAgent,
  listMissions,
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

const startTime = Date.now();

export function handleGetStatus(
  args: { include?: string[] },
  agentId: string,
): CallToolResult {
  const agent = getAgent(agentId);
  if (!agent) return err("Agent not found");

  const divisions = getAgentDivisions(agentId);

  const activeMissions = listMissions({ assigned_agent_id: agentId }).filter(
    (m) =>
      m.status !== "complete" &&
      m.status !== "aar_complete" &&
      m.status !== "failed" &&
      m.status !== "aborted",
  );

  const result: Record<string, unknown> = {
    agent: {
      id: agent.id,
      callsign: agent.callsign,
      health_status: agent.health_status,
      last_heartbeat: agent.last_heartbeat,
      runtime: agent.runtime,
      model: agent.model,
    },
    divisions,
    active_missions: activeMissions.length,
    engine: {
      uptime_ms: Date.now() - startTime,
      version: "0.1.0",
    },
  };

  if (args.include?.includes("missions")) {
    result.missions = activeMissions;
  }

  return ok(result);
}
