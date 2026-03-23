import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  createPersona,
  getPersona,
  getPersonaByCallsign,
  listPersonas,
  updatePersona,
  deletePersona,
} from "../../src/db/index.js";
import {
  parsePersonaDefinition,
  loadPersona,
} from "../../src/identity/index.js";

beforeEach(() => {
  freshDb();
});

afterEach(() => {
  cleanupDb();
});

function samplePersonaInput() {
  return {
    name: "Gage",
    callsign: "Gage",
    role: "lead" as const,
    division_id: null,
    ssop_version: "2.3",
    core_identity: {
      mission: "Lead the Code Division with technical excellence",
      behavioral_directives: ["Write clean code", "Review all PRs"],
    },
    communication_style: {
      tone: "direct",
      formality: "adaptive" as const,
      patterns: ["Uses technical terminology", "Concise explanations"],
    },
    decision_framework: {
      priorities: ["Code quality", "Ship velocity"],
      constraints: ["No breaking changes without approval"],
      escalation_triggers: ["Architecture decisions", "Security concerns"],
    },
    knowledge_domains: ["typescript", "architecture", "devops"],
    operational_constraints: ["Cannot approve own PRs"],
    personality_traits: ["analytical", "thorough", "pragmatic"],
    active: true,
  };
}

describe("Persona Repository", () => {
  it("creates and retrieves a persona", () => {
    const persona = createPersona(samplePersonaInput());
    expect(persona.id).toMatch(/^per_/);
    expect(persona.callsign).toBe("Gage");
    expect(persona.role).toBe("lead");

    const retrieved = getPersona(persona.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.core_identity.mission).toContain("Code Division");
  });

  it("finds persona by callsign", () => {
    createPersona(samplePersonaInput());
    const found = getPersonaByCallsign("Gage");
    expect(found).toBeTruthy();
    expect(found!.name).toBe("Gage");
  });

  it("lists personas with filters", () => {
    createPersona(samplePersonaInput());
    createPersona({
      ...samplePersonaInput(),
      name: "Rook",
      callsign: "Rook",
      role: "lead",
      knowledge_domains: ["security", "red-team"],
    });
    createPersona({
      ...samplePersonaInput(),
      name: "Analyst",
      callsign: "Analyst-1",
      role: "analyst",
    });

    const all = listPersonas();
    expect(all).toHaveLength(3);

    const leads = listPersonas({ role: "lead" });
    expect(leads).toHaveLength(2);

    const analysts = listPersonas({ role: "analyst" });
    expect(analysts).toHaveLength(1);
  });

  it("updates a persona", () => {
    const persona = createPersona(samplePersonaInput());
    const updated = updatePersona(persona.id, {
      knowledge_domains: ["typescript", "architecture", "devops", "security"],
    });
    expect(updated!.knowledge_domains).toHaveLength(4);
    expect(updated!.knowledge_domains).toContain("security");
  });

  it("deletes a persona", () => {
    const persona = createPersona(samplePersonaInput());
    expect(deletePersona(persona.id)).toBe(true);
    expect(getPersona(persona.id)).toBeNull();
  });
});

describe("Persona Loader", () => {
  it("parses a valid persona definition", () => {
    const def = parsePersonaDefinition({
      name: "Gage",
      callsign: "Gage",
      role: "lead",
      core_identity: { mission: "Lead code", behavioral_directives: [] },
      communication_style: { tone: "direct", formality: "adaptive", patterns: [] },
      decision_framework: { priorities: [], constraints: [], escalation_triggers: [] },
      knowledge_domains: ["typescript"],
    });
    expect(def.callsign).toBe("Gage");
    expect(def.operational_constraints).toEqual([]);
  });

  it("rejects invalid definition (missing fields)", () => {
    expect(() => parsePersonaDefinition({ name: "Bad" })).toThrow("Missing required field");
  });

  it("loads persona (create new)", () => {
    const persona = loadPersona({
      name: "Gage",
      callsign: "Gage",
      role: "lead",
      core_identity: { mission: "Lead code", behavioral_directives: ["Ship it"] },
      communication_style: { tone: "direct", formality: "adaptive", patterns: [] },
      decision_framework: { priorities: ["quality"], constraints: [], escalation_triggers: [] },
      knowledge_domains: ["typescript"],
    });
    expect(persona.id).toMatch(/^per_/);
    expect(persona.callsign).toBe("Gage");
  });

  it("loads persona (update existing by callsign)", () => {
    loadPersona({
      name: "Gage",
      callsign: "Gage",
      role: "lead",
      core_identity: { mission: "v1", behavioral_directives: [] },
      communication_style: { tone: "direct", formality: "adaptive", patterns: [] },
      decision_framework: { priorities: [], constraints: [], escalation_triggers: [] },
      knowledge_domains: ["typescript"],
    });

    const updated = loadPersona({
      name: "Gage",
      callsign: "Gage",
      role: "lead",
      core_identity: { mission: "v2 updated", behavioral_directives: ["new directive"] },
      communication_style: { tone: "direct", formality: "formal", patterns: [] },
      decision_framework: { priorities: [], constraints: [], escalation_triggers: [] },
      knowledge_domains: ["typescript", "architecture"],
    });

    expect(updated.core_identity.mission).toBe("v2 updated");
    expect(updated.knowledge_domains).toHaveLength(2);

    // Should still be only 1 persona in DB
    const all = listPersonas();
    expect(all).toHaveLength(1);
  });
});

