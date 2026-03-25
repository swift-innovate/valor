import { listAgents } from "../db/repositories/agent-repo.js";
import type { Agent } from "../types/agent.js";
import { logger } from "../utils/logger.js";

/**
 * Resolve agent identity from MCP initialize params.
 * Validates agent_key against VALOR_AGENT_KEY env var,
 * then looks up the agent record by callsign.
 */
export function resolveAgentIdentity(
  callsign: string,
  agentKey?: string,
): Agent | null {
  const configuredKey = process.env.VALOR_AGENT_KEY;

  // If VALOR_AGENT_KEY is set, require matching key
  if (configuredKey) {
    if (agentKey !== configuredKey) {
      logger.warn("MCP auth rejected: invalid agent_key", { callsign });
      return null;
    }
  }
  // If no key configured, allow open access (matches REST API behavior)

  // Look up agent by callsign
  const agents = listAgents({});
  const agent = agents.find((a) => a.callsign === callsign);

  if (!agent) {
    logger.warn("MCP auth rejected: agent not found", { callsign });
    return null;
  }

  if (agent.health_status === "deregistered") {
    logger.warn("MCP auth rejected: agent deregistered", { callsign });
    return null;
  }

  return agent;
}
