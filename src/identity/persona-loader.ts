import { PersonaSchema, type Persona } from "../types/index.js";
import { createPersona, getPersonaByCallsign, updatePersona } from "../db/index.js";
import { logger } from "../utils/logger.js";

/**
 * Raw persona definition — the input format for loading personas.
 * Can come from JSON files, API calls, or Soulsmith output.
 */
export interface PersonaDefinition {
  name: string;
  callsign: string;
  role: "lead" | "operative" | "analyst" | "specialist";
  division_id?: string | null;
  ssop_version?: string | null;
  core_identity: {
    mission: string;
    behavioral_directives: string[];
  };
  communication_style: {
    tone: string;
    formality: "formal" | "casual" | "adaptive";
    patterns: string[];
  };
  decision_framework: {
    priorities: string[];
    constraints: string[];
    escalation_triggers: string[];
  };
  knowledge_domains: string[];
  operational_constraints?: string[];
  personality_traits?: string[];
}

/**
 * Parse and validate a raw persona definition.
 * Returns the validated input or throws on invalid data.
 */
export function parsePersonaDefinition(raw: unknown): PersonaDefinition {
  if (!raw || typeof raw !== "object") {
    throw new Error("Persona definition must be an object");
  }

  const def = raw as Record<string, unknown>;

  // Validate required fields exist
  const required = ["name", "callsign", "role", "core_identity", "communication_style", "decision_framework", "knowledge_domains"];
  for (const field of required) {
    if (!(field in def)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return {
    name: def.name as string,
    callsign: def.callsign as string,
    role: def.role as PersonaDefinition["role"],
    division_id: (def.division_id as string) ?? null,
    ssop_version: (def.ssop_version as string) ?? null,
    core_identity: def.core_identity as PersonaDefinition["core_identity"],
    communication_style: def.communication_style as PersonaDefinition["communication_style"],
    decision_framework: def.decision_framework as PersonaDefinition["decision_framework"],
    knowledge_domains: def.knowledge_domains as string[],
    operational_constraints: (def.operational_constraints as string[]) ?? [],
    personality_traits: (def.personality_traits as string[]) ?? [],
  };
}

/**
 * Load a persona definition into the database.
 * If a persona with the same callsign already exists and is active, updates it.
 * Otherwise creates a new one.
 */
export function loadPersona(definition: PersonaDefinition): Persona {
  const existing = getPersonaByCallsign(definition.callsign);

  if (existing) {
    logger.info("Updating existing persona", { callsign: definition.callsign, id: existing.id });
    const updated = updatePersona(existing.id, {
      name: definition.name,
      role: definition.role,
      division_id: definition.division_id ?? null,
      ssop_version: definition.ssop_version ?? null,
      core_identity: definition.core_identity,
      communication_style: definition.communication_style,
      decision_framework: definition.decision_framework,
      knowledge_domains: definition.knowledge_domains,
      operational_constraints: definition.operational_constraints ?? [],
      personality_traits: definition.personality_traits ?? [],
    });
    return updated!;
  }

  logger.info("Creating new persona", { callsign: definition.callsign });
  return createPersona({
    name: definition.name,
    callsign: definition.callsign,
    role: definition.role,
    division_id: definition.division_id ?? null,
    ssop_version: definition.ssop_version ?? null,
    core_identity: definition.core_identity,
    communication_style: definition.communication_style,
    decision_framework: definition.decision_framework,
    knowledge_domains: definition.knowledge_domains,
    operational_constraints: definition.operational_constraints ?? [],
    personality_traits: definition.personality_traits ?? [],
    active: true,
  });
}

/**
 * Load multiple persona definitions. Returns all loaded personas.
 */
export function loadPersonas(definitions: PersonaDefinition[]): Persona[] {
  return definitions.map((def) => loadPersona(def));
}
