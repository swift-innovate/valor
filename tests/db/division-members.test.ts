import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  createDivision,
  createAgent,
  createMission,
  deleteDivision,
} from "../../src/db/repositories/index.js";
import {
  addMember,
  removeMember,
  getMember,
  updateMemberRole,
  getRoster,
  getAgentDivisions,
  getDivisionLead,
  transferLead,
} from "../../src/db/repositories/division-member-repo.js";
import {
  subscribe,
  clearSubscriptions,
} from "../../src/bus/event-bus.js";
import type { EventEnvelope } from "../../src/types/index.js";
import { getDb } from "../../src/db/database.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

// ---- helpers ----------------------------------------------------------------

let _divCounter = 0;
let _agentCounter = 0;

function makeDiv(overrides: Record<string, unknown> = {}) {
  _divCounter++;
  return createDivision({
    name: `Test Division ${_divCounter}`,
    namespace: `test_${_divCounter}`,
    lead_agent_id: null,
    autonomy_policy: {
      max_cost_autonomous_usd: 10,
      approval_required_actions: [],
      auto_dispatch_enabled: true,
    },
    escalation_policy: {
      escalate_to: "director",
      escalate_after_failures: 3,
      escalate_on_budget_breach: true,
    },
    ...overrides,
  });
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  _agentCounter++;
  return createAgent({
    callsign: `agent_${_agentCounter}_${Math.random().toString(36).slice(2)}`,
    runtime: "claude_api" as const,
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "registered" as const,
    last_heartbeat: null,
    ...overrides,
  });
}

// ---- addMember --------------------------------------------------------------

describe("addMember", () => {
  it("creates member with dmbr_ prefix ID", () => {
    const div = makeDiv();
    const agent = makeAgent();
    const member = addMember({
      division_id: div.id,
      agent_id: agent.id,
      role: "member",
      assigned_by: "director",
    });
    expect(member.id).toMatch(/^dmbr_/);
    expect(member.division_id).toBe(div.id);
    expect(member.agent_id).toBe(agent.id);
    expect(member.role).toBe("member");
  });

  it("sets agent division_id if null (backward compat)", () => {
    const div = makeDiv();
    const agent = makeAgent(); // division_id: null
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    const row = getDb()
      .prepare("SELECT division_id FROM agents WHERE id = @id")
      .get({ id: agent.id }) as { division_id: string | null };
    expect(row.division_id).toBe(div.id);
  });

  it("does NOT overwrite agent division_id if already set", () => {
    const div1 = makeDiv();
    const div2 = makeDiv();
    const agent = makeAgent({ division_id: div1.id });
    addMember({ division_id: div2.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    const row = getDb()
      .prepare("SELECT division_id FROM agents WHERE id = @id")
      .get({ id: agent.id }) as { division_id: string | null };
    // Should remain div1, not overwritten to div2
    expect(row.division_id).toBe(div1.id);
  });

  it("rejects duplicate (same division + agent)", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    expect(() =>
      addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" })
    ).toThrow();
  });

  it("rejects role 'lead' (must use transferLead)", () => {
    const div = makeDiv();
    const agent = makeAgent();
    expect(() =>
      addMember({ division_id: div.id, agent_id: agent.id, role: "lead", assigned_by: "director" })
    ).toThrow();
  });

  it("throws if division not found", () => {
    const agent = makeAgent();
    expect(() =>
      addMember({ division_id: "div_nonexistent", agent_id: agent.id, role: "member", assigned_by: "director" })
    ).toThrow();
  });

  it("throws if agent not found", () => {
    const div = makeDiv();
    expect(() =>
      addMember({ division_id: div.id, agent_id: "agt_nonexistent", role: "member", assigned_by: "director" })
    ).toThrow();
  });
});

// ---- removeMember -----------------------------------------------------------

describe("removeMember", () => {
  it("removes member and returns true", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    const result = removeMember(div.id, agent.id, "director");
    expect(result).toBe(true);
    expect(getMember(div.id, agent.id)).toBeNull();
  });

  it("sets agent division_id to null if matched (backward compat)", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    removeMember(div.id, agent.id, "director");
    const row = getDb()
      .prepare("SELECT division_id FROM agents WHERE id = @id")
      .get({ id: agent.id }) as { division_id: string | null };
    expect(row.division_id).toBeNull();
  });

  it("returns false if membership not found", () => {
    const div = makeDiv();
    const agent = makeAgent();
    const result = removeMember(div.id, agent.id, "director");
    expect(result).toBe(false);
  });

  it("throws if target is lead", () => {
    const div = makeDiv();
    const agent = makeAgent();
    transferLead(div.id, agent.id, "director");
    expect(() => removeMember(div.id, agent.id, "director")).toThrow();
  });
});

// ---- getMember --------------------------------------------------------------

describe("getMember", () => {
  it("returns member when found", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "operative", assigned_by: "director" });
    const member = getMember(div.id, agent.id);
    expect(member).not.toBeNull();
    expect(member!.agent_id).toBe(agent.id);
    expect(member!.role).toBe("operative");
  });

  it("returns null when not found", () => {
    const div = makeDiv();
    const agent = makeAgent();
    expect(getMember(div.id, agent.id)).toBeNull();
  });
});

// ---- updateMemberRole -------------------------------------------------------

describe("updateMemberRole", () => {
  it("changes role successfully", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    const updated = updateMemberRole(div.id, agent.id, "operative", "director");
    expect(updated).not.toBeNull();
    expect(updated!.role).toBe("operative");
  });

  it("rejects promotion to lead (must use transferLead)", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    expect(() => updateMemberRole(div.id, agent.id, "lead", "director")).toThrow();
  });

  it("rejects demotion of lead", () => {
    const div = makeDiv();
    const agent = makeAgent();
    transferLead(div.id, agent.id, "director");
    expect(() => updateMemberRole(div.id, agent.id, "member", "director")).toThrow();
  });

  it("returns null for non-existent membership", () => {
    const div = makeDiv();
    const agent = makeAgent();
    const result = updateMemberRole(div.id, agent.id, "operative", "director");
    expect(result).toBeNull();
  });
});

// ---- getRoster --------------------------------------------------------------

describe("getRoster", () => {
  it("returns roster with agent details", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "operative", assigned_by: "director" });
    const roster = getRoster(div.id);
    expect(roster).toHaveLength(1);
    expect(roster[0].agent_id).toBe(agent.id);
    expect(roster[0].role).toBe("operative");
    // Should include agent details (callsign)
    expect(roster[0].callsign).toBe(agent.callsign);
  });

  it("lead sorts first in roster", () => {
    const div = makeDiv();
    const agentA = makeAgent();
    const agentB = makeAgent();
    addMember({ division_id: div.id, agent_id: agentA.id, role: "operative", assigned_by: "director" });
    transferLead(div.id, agentB.id, "director");
    const roster = getRoster(div.id);
    expect(roster[0].role).toBe("lead");
    expect(roster[0].agent_id).toBe(agentB.id);
  });

  it("returns empty array when no members", () => {
    const div = makeDiv();
    expect(getRoster(div.id)).toEqual([]);
  });
});

// ---- getAgentDivisions ------------------------------------------------------

describe("getAgentDivisions", () => {
  it("returns all divisions for agent", () => {
    const div1 = makeDiv();
    const div2 = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div1.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    addMember({ division_id: div2.id, agent_id: agent.id, role: "operative", assigned_by: "director" });
    const divisions = getAgentDivisions(agent.id);
    expect(divisions).toHaveLength(2);
    const ids = divisions.map((d) => d.division_id);
    expect(ids).toContain(div1.id);
    expect(ids).toContain(div2.id);
  });

  it("returns empty array when no memberships", () => {
    const agent = makeAgent();
    expect(getAgentDivisions(agent.id)).toEqual([]);
  });
});

// ---- getDivisionLead --------------------------------------------------------

describe("getDivisionLead", () => {
  it("returns lead member when lead exists", () => {
    const div = makeDiv();
    const agent = makeAgent();
    transferLead(div.id, agent.id, "director");
    const lead = getDivisionLead(div.id);
    expect(lead).not.toBeNull();
    expect(lead!.agent_id).toBe(agent.id);
    expect(lead!.role).toBe("lead");
  });

  it("returns null when no lead exists", () => {
    const div = makeDiv();
    expect(getDivisionLead(div.id)).toBeNull();
  });
});

// ---- transferLead -----------------------------------------------------------

describe("transferLead", () => {
  it("demotes old lead and promotes new lead", () => {
    const div = makeDiv();
    const agentA = makeAgent();
    const agentB = makeAgent();
    transferLead(div.id, agentA.id, "director");
    transferLead(div.id, agentB.id, "director");

    const oldLead = getMember(div.id, agentA.id);
    expect(oldLead).not.toBeNull();
    expect(oldLead!.role).not.toBe("lead");

    const newLead = getDivisionLead(div.id);
    expect(newLead).not.toBeNull();
    expect(newLead!.agent_id).toBe(agentB.id);
    expect(newLead!.role).toBe("lead");
  });

  it("auto-adds new agent if not already a member", () => {
    const div = makeDiv();
    const agent = makeAgent();
    // Agent is not a member yet
    expect(getMember(div.id, agent.id)).toBeNull();
    transferLead(div.id, agent.id, "director");
    const lead = getDivisionLead(div.id);
    expect(lead).not.toBeNull();
    expect(lead!.agent_id).toBe(agent.id);
  });

  it("updates divisions.lead_agent_id (backward compat)", () => {
    const div = makeDiv();
    const agent = makeAgent();
    transferLead(div.id, agent.id, "director");
    const row = getDb()
      .prepare("SELECT lead_agent_id FROM divisions WHERE id = @id")
      .get({ id: div.id }) as { lead_agent_id: string | null };
    expect(row.lead_agent_id).toBe(agent.id);
  });

  it("works when no existing lead", () => {
    const div = makeDiv();
    const agent = makeAgent();
    expect(() => transferLead(div.id, agent.id, "director")).not.toThrow();
    const lead = getDivisionLead(div.id);
    expect(lead!.agent_id).toBe(agent.id);
  });

  it("throws if division not found", () => {
    const agent = makeAgent();
    expect(() => transferLead("div_nonexistent", agent.id, "director")).toThrow();
  });

  it("throws if agent not found", () => {
    const div = makeDiv();
    expect(() => transferLead(div.id, "agt_nonexistent", "director")).toThrow();
  });
});

// ---- deleteDivision guards --------------------------------------------------

describe("deleteDivision guards", () => {
  it("throws when division has active members", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });
    expect(() => deleteDivision(div.id)).toThrow();
  });

  it("throws when division has active missions", () => {
    const div = makeDiv();
    createMission({
      division_id: div.id,
      title: "Active Mission",
      objective: "Do something",
      status: "queued" as const,
      phase: null,
      assigned_agent_id: null,
      priority: "normal" as const,
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      dispatched_at: null,
      completed_at: null,
    });
    expect(() => deleteDivision(div.id)).toThrow();
  });

  it("succeeds when division is empty (no members, no missions)", () => {
    const div = makeDiv();
    let result: boolean | undefined;
    expect(() => {
      result = deleteDivision(div.id);
    }).not.toThrow();
    expect(result).toBe(true);
  });
});

// ---- event bus tests --------------------------------------------------------

describe("division membership events", () => {
  it("addMember publishes division.member.added", () => {
    const received: EventEnvelope[] = [];
    subscribe("division.member.*", (e) => received.push(e));

    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("division.member.added");
    expect((received[0].payload as Record<string, unknown>).division_id).toBe(div.id);
    expect((received[0].payload as Record<string, unknown>).agent_id).toBe(agent.id);
  });

  it("removeMember publishes division.member.removed", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const received: EventEnvelope[] = [];
    subscribe("division.member.*", (e) => received.push(e));

    removeMember(div.id, agent.id, "director");

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("division.member.removed");
    expect((received[0].payload as Record<string, unknown>).division_id).toBe(div.id);
    expect((received[0].payload as Record<string, unknown>).agent_id).toBe(agent.id);
  });

  it("updateMemberRole publishes division.member.role_changed", () => {
    const div = makeDiv();
    const agent = makeAgent();
    addMember({ division_id: div.id, agent_id: agent.id, role: "member", assigned_by: "director" });

    const received: EventEnvelope[] = [];
    subscribe("division.member.*", (e) => received.push(e));

    updateMemberRole(div.id, agent.id, "operative", "director");

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("division.member.role_changed");
    const payload = received[0].payload as Record<string, unknown>;
    expect(payload.division_id).toBe(div.id);
    expect(payload.agent_id).toBe(agent.id);
    expect(payload.new_role).toBe("operative");
  });

  it("transferLead publishes division.lead.transferred", () => {
    const div = makeDiv();
    const agent = makeAgent();

    const received: EventEnvelope[] = [];
    subscribe("division.lead.*", (e) => received.push(e));

    transferLead(div.id, agent.id, "director");

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("division.lead.transferred");
    const payload = received[0].payload as Record<string, unknown>;
    expect(payload.division_id).toBe(div.id);
    expect(payload.new_lead_agent_id).toBe(agent.id);
  });
});
