import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  createDivision,
  getDivision,
  listDivisions,
  updateDivision,
  deleteDivision,
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  updateHeartbeat,
  deleteAgent,
  createMission,
  getMission,
  listMissions,
  transitionMission,
  updateMission,
  InvalidTransitionError,
  appendEvent,
  queryEvents,
  getEvent,
  appendAuditEntry,
  queryAuditLog,
} from "../../src/db/repositories/index.js";

beforeEach(() => freshDb());
afterEach(() => cleanupDb());

describe("Division Repository", () => {
  const divInput = {
    name: "Code Division",
    lead_agent_id: null,
    autonomy_policy: {
      max_cost_autonomous_usd: 10,
      approval_required_actions: ["deploy"],
      auto_dispatch_enabled: true,
    },
    escalation_policy: {
      escalate_to: "director",
      escalate_after_failures: 3,
      escalate_on_budget_breach: true,
    },
    namespace: "code",
  };

  it("creates and retrieves a division", () => {
    const div = createDivision(divInput);
    expect(div.id).toMatch(/^div_/);
    expect(div.name).toBe("Code Division");
    expect(div.autonomy_policy.auto_dispatch_enabled).toBe(true);

    const retrieved = getDivision(div.id);
    expect(retrieved).toEqual(div);
  });

  it("lists all divisions", () => {
    createDivision(divInput);
    createDivision({ ...divInput, name: "Ranch Division", namespace: "ranch" });
    const all = listDivisions();
    expect(all).toHaveLength(2);
  });

  it("updates a division", () => {
    const div = createDivision(divInput);
    const updated = updateDivision(div.id, { name: "Engineering" });
    expect(updated!.name).toBe("Engineering");
    expect(updated!.namespace).toBe("code");
  });

  it("returns null updating non-existent", () => {
    expect(updateDivision("div_nope", { name: "x" })).toBeNull();
  });

  it("deletes a division", () => {
    const div = createDivision(divInput);
    expect(deleteDivision(div.id)).toBe(true);
    expect(getDivision(div.id)).toBeNull();
  });
});

describe("Agent Repository", () => {
  const agentInput = {
    callsign: "Mira",
    division_id: null,
    runtime: "openclaw" as const,
    endpoint_url: "http://localhost:3000",
    model: "claude-sonnet-4-20250514",
    health_status: "registered" as const,
    last_heartbeat: null,
    persona_id: null,
    capabilities: ["chat", "code"],
  };

  it("creates and retrieves an agent", () => {
    const agent = createAgent(agentInput);
    expect(agent.id).toMatch(/^agt_/);
    expect(agent.callsign).toBe("Mira");
    expect(agent.capabilities).toEqual(["chat", "code"]);

    const retrieved = getAgent(agent.id);
    expect(retrieved).toEqual(agent);
  });

  it("filters agents by health status", () => {
    createAgent(agentInput);
    createAgent({ ...agentInput, callsign: "Gage", health_status: "healthy" });
    expect(listAgents({ health_status: "registered" })).toHaveLength(1);
    expect(listAgents({ health_status: "healthy" })).toHaveLength(1);
  });

  it("updates heartbeat", () => {
    const agent = createAgent(agentInput);
    const updated = updateHeartbeat(agent.id);
    expect(updated!.health_status).toBe("healthy");
    expect(updated!.last_heartbeat).toBeTruthy();
  });

  it("deletes an agent", () => {
    const agent = createAgent(agentInput);
    expect(deleteAgent(agent.id)).toBe(true);
    expect(getAgent(agent.id)).toBeNull();
  });
});

describe("Mission Repository", () => {
  const missionInput = {
    division_id: null,
    title: "Test Mission",
    objective: "Do the thing",
    status: "draft" as const,
    phase: null,
    assigned_agent_id: null,
    priority: "normal" as const,
    constraints: ["budget < $5"],
    deliverables: ["report.md"],
    success_criteria: ["report exists"],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: 3,
    parent_mission_id: null,
    dispatched_at: null,
    completed_at: null,
  };

  it("creates and retrieves a mission", () => {
    const mission = createMission(missionInput);
    expect(mission.id).toMatch(/^mis_/);
    expect(mission.constraints).toEqual(["budget < $5"]);

    const retrieved = getMission(mission.id);
    expect(retrieved).toEqual(mission);
  });

  it("filters missions by status", () => {
    createMission(missionInput);
    createMission({ ...missionInput, title: "M2", status: "draft" });
    expect(listMissions({ status: "draft" })).toHaveLength(2);
    expect(listMissions({ status: "queued" })).toHaveLength(0);
  });

  it("transitions mission status", () => {
    const mission = createMission(missionInput);
    const queued = transitionMission(mission.id, "queued");
    expect(queued.status).toBe("queued");
  });

  it("rejects invalid transitions", () => {
    const mission = createMission(missionInput);
    expect(() => transitionMission(mission.id, "complete")).toThrow(InvalidTransitionError);
  });

  it("sets dispatched_at on dispatch", () => {
    const mission = createMission(missionInput);
    transitionMission(mission.id, "queued");
    transitionMission(mission.id, "gated");
    const dispatched = transitionMission(mission.id, "dispatched");
    expect(dispatched.dispatched_at).toBeTruthy();
  });

  it("sets completed_at on complete", () => {
    const mission = createMission(missionInput);
    transitionMission(mission.id, "queued");
    transitionMission(mission.id, "gated");
    transitionMission(mission.id, "dispatched");
    transitionMission(mission.id, "streaming");
    const completed = transitionMission(mission.id, "complete");
    expect(completed.completed_at).toBeTruthy();
  });

  it("updates non-status fields", () => {
    const mission = createMission(missionInput);
    const updated = updateMission(mission.id, { title: "Updated Title", cost_usd: 1.5 });
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.cost_usd).toBe(1.5);
    expect(updated!.status).toBe("draft");
  });
});

describe("Event Repository", () => {
  const eventInput = {
    type: "mission.created",
    source: { id: "system", type: "system" as const },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: "mis_abc" },
    metadata: null,
  };

  it("appends and retrieves an event", () => {
    const event = appendEvent(eventInput);
    expect(event.id).toMatch(/^evt_/);
    expect(event.timestamp).toBeTruthy();
    expect(event.payload).toEqual({ mission_id: "mis_abc" });

    const retrieved = getEvent(event.id);
    expect(retrieved).toEqual(event);
  });

  it("queries by type glob", () => {
    appendEvent(eventInput);
    appendEvent({ ...eventInput, type: "mission.status.changed" });
    appendEvent({ ...eventInput, type: "agent.heartbeat" });

    expect(queryEvents({ type: "mission.*" })).toHaveLength(2);
    expect(queryEvents({ type: "agent.*" })).toHaveLength(1);
  });

  it("queries by time range", () => {
    const e1 = appendEvent(eventInput);
    const results = queryEvents({ from: e1.timestamp });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("respects limit", () => {
    appendEvent(eventInput);
    appendEvent({ ...eventInput, type: "mission.updated" });
    appendEvent({ ...eventInput, type: "mission.deleted" });
    expect(queryEvents({ limit: 2 })).toHaveLength(2);
  });
});

describe("Audit Repository", () => {
  it("appends and queries audit entries", () => {
    const entry = appendAuditEntry({
      entity_type: "mission",
      entity_id: "mis_abc",
      operation: "create",
      before_state: null,
      after_state: '{"status":"draft"}',
      actor_id: "system",
    });

    expect(entry.id).toMatch(/^wal_/);
    expect(entry.timestamp).toBeTruthy();

    const results = queryAuditLog({ entity_type: "mission" });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(entry);
  });

  it("filters by entity_id", () => {
    appendAuditEntry({
      entity_type: "mission",
      entity_id: "mis_abc",
      operation: "create",
      before_state: null,
      after_state: "{}",
      actor_id: "system",
    });
    appendAuditEntry({
      entity_type: "mission",
      entity_id: "mis_xyz",
      operation: "create",
      before_state: null,
      after_state: "{}",
      actor_id: "system",
    });

    expect(queryAuditLog({ entity_id: "mis_abc" })).toHaveLength(1);
    expect(queryAuditLog({ entity_id: "mis_xyz" })).toHaveLength(1);
  });
});
