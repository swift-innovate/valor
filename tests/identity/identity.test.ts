import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import {
  createPersona,
  getPersona,
  getPersonaByCallsign,
  listPersonas,
  updatePersona,
  deletePersona,
  createDivision,
  getDivision,
  getAgent,
  listAgents,
} from "../../src/db/index.js";
import {
  parsePersonaDefinition,
  loadPersona,
  instantiateLead,
  instantiateOperative,
} from "../../src/identity/index.js";
import type { EventEnvelope } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
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

describe("Lead Instantiation", () => {
  it("instantiates a division lead from persona", () => {
    const events: EventEnvelope[] = [];
    subscribe("agent.*", (e) => events.push(e));

    const persona = createPersona(samplePersonaInput());
    const division = createDivision({
      name: "Code Division",
      lead_agent_id: null,
      autonomy_policy: { max_cost_autonomous_usd: 10, approval_required_actions: [], auto_dispatch_enabled: true },
      escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
      namespace: "code",
    });

    const result = instantiateLead({
      persona_id: persona.id,
      division_id: division.id,
      runtime: "claude_api",
      model: "claude-sonnet-4-20250514",
    });

    expect(result.success).toBe(true);
    expect(result.agent).toBeTruthy();
    expect(result.agent!.callsign).toBe("Gage");
    expect(result.agent!.persona_id).toBe(persona.id);
    expect(result.agent!.division_id).toBe(division.id);

    // Division should have lead_agent_id set
    const updatedDiv = getDivision(division.id);
    expect(updatedDiv!.lead_agent_id).toBe(result.agent!.id);

    // Should emit agent.registered event
    expect(events.some((e) => e.type === "agent.registered")).toBe(true);
  });

  it("rejects non-lead persona for lead instantiation", () => {
    const persona = createPersona({ ...samplePersonaInput(), role: "analyst" });
    const division = createDivision({
      name: "Code Division",
      lead_agent_id: null,
      autonomy_policy: { max_cost_autonomous_usd: 10, approval_required_actions: [], auto_dispatch_enabled: true },
      escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
      namespace: "code",
    });

    const result = instantiateLead({
      persona_id: persona.id,
      division_id: division.id,
      runtime: "claude_api",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain("analyst");
  });

  it("rejects if division already has active lead", () => {
    const persona1 = createPersona(samplePersonaInput());
    const persona2 = createPersona({ ...samplePersonaInput(), name: "Rook", callsign: "Rook" });
    const division = createDivision({
      name: "Code Division",
      lead_agent_id: null,
      autonomy_policy: { max_cost_autonomous_usd: 10, approval_required_actions: [], auto_dispatch_enabled: true },
      escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
      namespace: "code",
    });

    instantiateLead({ persona_id: persona1.id, division_id: division.id, runtime: "claude_api" });
    const result = instantiateLead({ persona_id: persona2.id, division_id: division.id, runtime: "claude_api" });

    expect(result.success).toBe(false);
    expect(result.reason).toContain("already has an active lead");
  });

  it("instantiates an operative", () => {
    const persona = createPersona({ ...samplePersonaInput(), role: "operative", callsign: "Op-1" });
    const division = createDivision({
      name: "Code Division",
      lead_agent_id: null,
      autonomy_policy: { max_cost_autonomous_usd: 10, approval_required_actions: [], auto_dispatch_enabled: true },
      escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
      namespace: "code",
    });

    const result = instantiateOperative({
      persona_id: persona.id,
      division_id: division.id,
      runtime: "herd",
      model: "llama3",
    });

    expect(result.success).toBe(true);
    expect(result.agent!.callsign).toBe("Op-1");

    // Division lead should NOT be set (operative, not lead)
    const updatedDiv = getDivision(division.id);
    expect(updatedDiv!.lead_agent_id).toBeNull();
  });
});
