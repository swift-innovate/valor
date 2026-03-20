import {
  getPersona,
  updatePersona,
  createAgent,
  getAgent,
  updateAgent,
  getDivision,
  updateDivision,
} from "../db/index.js";
import { publish } from "../bus/index.js";
import { logger } from "../utils/logger.js";
import type { Agent } from "../types/index.js";
import type { AgentRuntime } from "../types/index.js";

export interface LeadInstantiationRequest {
  persona_id: string;
  division_id: string;
  runtime: AgentRuntime;
  endpoint_url?: string | null;
  model?: string | null;
}

export interface LeadInstantiationResult {
  success: boolean;
  agent?: Agent;
  reason?: string;
}

/**
 * Instantiate a Division Lead by connecting a persona to an agent and assigning to a division.
 *
 * Steps:
 * 1. Validate persona exists and has role "lead"
 * 2. Validate division exists
 * 3. Create agent from persona (or update existing if persona already assigned)
 * 4. Set division's lead_agent_id
 * 5. Emit agent.registered event
 */
export function instantiateLead(req: LeadInstantiationRequest): LeadInstantiationResult {
  const persona = getPersona(req.persona_id);
  if (!persona) {
    return { success: false, reason: `Persona not found: ${req.persona_id}` };
  }
  if (persona.role !== "lead") {
    return { success: false, reason: `Persona "${persona.callsign}" has role "${persona.role}", expected "lead"` };
  }

  const division = getDivision(req.division_id);
  if (!division) {
    return { success: false, reason: `Division not found: ${req.division_id}` };
  }

  // Check if division already has a lead
  if (division.lead_agent_id) {
    const existingLead = getAgent(division.lead_agent_id);
    if (existingLead && existingLead.health_status !== "offline" && existingLead.health_status !== "deregistered") {
      return {
        success: false,
        reason: `Division "${division.name}" already has an active lead: ${existingLead.callsign}`,
      };
    }
  }

  // Create agent from persona
  const agent = createAgent({
    callsign: persona.callsign,
    division_id: req.division_id,
    runtime: req.runtime,
    endpoint_url: req.endpoint_url ?? null,
    model: req.model ?? null,
    health_status: "registered",
    last_heartbeat: null,
    persona_id: persona.id,
    capabilities: persona.knowledge_domains,
  });

  // Assign as division lead
  updateDivision(req.division_id, { lead_agent_id: agent.id });

  // Update persona's division_id if not set
  if (!persona.division_id) {
    updatePersona(persona.id, { division_id: req.division_id });
  }

  publish({
    type: "agent.registered",
    source: { id: "identity", type: "system" },
    target: { id: agent.id, type: "agent" },
    conversation_id: null,
    in_reply_to: null,
    payload: {
      agent_id: agent.id,
      callsign: agent.callsign,
      division_id: req.division_id,
      division_name: division.name,
      role: "lead",
      persona_id: persona.id,
    },
    metadata: null,
  });

  logger.info("Division lead instantiated", {
    agent_id: agent.id,
    callsign: agent.callsign,
    division: division.name,
  });

  return { success: true, agent };
}

/**
 * Instantiate an operative agent from a persona within a division.
 * Unlike leads, operatives don't become the division's lead_agent_id.
 */
export function instantiateOperative(req: {
  persona_id: string;
  division_id: string;
  runtime: AgentRuntime;
  endpoint_url?: string | null;
  model?: string | null;
}): LeadInstantiationResult {
  const persona = getPersona(req.persona_id);
  if (!persona) {
    return { success: false, reason: `Persona not found: ${req.persona_id}` };
  }

  const division = getDivision(req.division_id);
  if (!division) {
    return { success: false, reason: `Division not found: ${req.division_id}` };
  }

  const agent = createAgent({
    callsign: persona.callsign,
    division_id: req.division_id,
    runtime: req.runtime,
    endpoint_url: req.endpoint_url ?? null,
    model: req.model ?? null,
    health_status: "registered",
    last_heartbeat: null,
    persona_id: persona.id,
    capabilities: persona.knowledge_domains,
  });

  publish({
    type: "agent.registered",
    source: { id: "identity", type: "system" },
    target: { id: agent.id, type: "agent" },
    conversation_id: null,
    in_reply_to: null,
    payload: {
      agent_id: agent.id,
      callsign: agent.callsign,
      division_id: req.division_id,
      role: persona.role,
      persona_id: persona.id,
    },
    metadata: null,
  });

  logger.info("Operative instantiated", {
    agent_id: agent.id,
    callsign: agent.callsign,
    division: division.name,
    role: persona.role,
  });

  return { success: true, agent };
}
