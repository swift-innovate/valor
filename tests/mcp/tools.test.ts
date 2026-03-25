import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  createAgent,
  createMission,
  createDivision,
  addMember,
  getMission,
  listSitreps,
  listArtifacts,
  getAgentInbox,
  listApprovals,
} from "../../src/db/repositories/index.js";
import { handleCheckInbox } from "../../src/mcp/tools/inbox.js";
import { handleAcceptMission, handleGetMissionBrief, handleCompleteMission } from "../../src/mcp/tools/missions.js";
import { handleSubmitSitrep } from "../../src/mcp/tools/sitreps.js";
import { handleSendMessage } from "../../src/mcp/tools/comms.js";
import { handleGetStatus } from "../../src/mcp/tools/status.js";
import { handleSubmitArtifacts } from "../../src/mcp/tools/artifacts.js";
import { handleRequestEscalation } from "../../src/mcp/tools/escalation.js";
import { handleAcknowledgeDirective } from "../../src/mcp/tools/directives.js";

let agent1Id: string;
let agent2Id: string;
let divisionId: string;
let missionId: string;

beforeEach(() => {
  freshDb();

  const div = createDivision({
    name: "Code Division",
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
    namespace: "code",
  });
  divisionId = div.id;

  const agent1 = createAgent({
    callsign: "Gage",
    runtime: "claude_api",
    division_id: divisionId,
    endpoint_url: null,
    model: "claude-3-5-sonnet",
    persona_id: null,
    capabilities: ["code_review"],
    health_status: "healthy",
    last_heartbeat: null,
  });
  agent1Id = agent1.id;

  addMember({ division_id: divisionId, agent_id: agent1Id, role: "member", assigned_by: "director" });

  const agent2 = createAgent({
    callsign: "Mira",
    runtime: "claude_api",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "healthy",
    last_heartbeat: null,
  });
  agent2Id = agent2.id;

  const mission = createMission({
    title: "Fix auth bug",
    objective: "Fix the authentication bypass in login flow",
    status: "queued",
    phase: null,
    priority: "high",
    division_id: divisionId,
    assigned_agent_id: agent1Id,
    constraints: [],
    deliverables: [],
    success_criteria: [],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: 5,
    parent_mission_id: null,
    initiative_id: null,
    dispatched_at: null,
    completed_at: null,
  });
  missionId = mission.id;
});

afterEach(() => cleanupDb());

describe("check_inbox", () => {
  it("returns heartbeat and inbox contents", () => {
    const result = handleCheckInbox({}, agent1Id);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.heartbeat_at).toBeTruthy();
    expect(Array.isArray(data.pending_missions)).toBe(true);
    expect(Array.isArray(data.directives)).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("returns error for unknown agent", () => {
    const result = handleCheckInbox({}, "nonexistent");
    expect(result.isError).toBe(true);
  });
});

describe("accept_mission", () => {
  it("transitions mission to dispatched", () => {
    const result = handleAcceptMission({ mission_id: missionId }, agent1Id);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe("dispatched");
  });

  it("rejects unassigned agent", () => {
    const result = handleAcceptMission({ mission_id: missionId }, agent2Id);
    expect(result.isError).toBe(true);
  });

  it("rejects unknown mission", () => {
    const result = handleAcceptMission({ mission_id: "nonexistent" }, agent1Id);
    expect(result.isError).toBe(true);
  });
});

describe("get_mission_brief", () => {
  it("returns mission for assigned agent", () => {
    const result = handleGetMissionBrief({ mission_id: missionId }, agent1Id);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.title).toBe("Fix auth bug");
    expect(data.objective).toContain("authentication");
  });

  it("denies access to unrelated agent", () => {
    const result = handleGetMissionBrief({ mission_id: missionId }, agent2Id);
    expect(result.isError).toBe(true);
  });
});

describe("submit_sitrep", () => {
  it("creates a sitrep for active mission", () => {
    const result = handleSubmitSitrep(
      {
        mission_id: missionId,
        phase: "V",
        status: "green",
        summary: "Validating requirements",
      },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.sitrep_id).toBeTruthy();

    const sitreps = listSitreps({ mission_id: missionId });
    expect(sitreps).toHaveLength(1);
    expect(sitreps[0].summary).toBe("Validating requirements");
  });

  it("flags escalation for red status", () => {
    const result = handleSubmitSitrep(
      {
        mission_id: missionId,
        phase: "A",
        status: "red",
        summary: "Blocked on database access",
        blockers: ["No DB credentials"],
      },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.escalation?.triggered).toBe(true);
  });

  it("rejects invalid phase", () => {
    const result = handleSubmitSitrep(
      { mission_id: missionId, phase: "X", status: "green", summary: "test" },
      agent1Id,
    );
    expect(result.isError).toBe(true);
  });
});

describe("send_message", () => {
  it("sends a message to another agent", () => {
    const result = handleSendMessage(
      { to_agent_id: agent2Id, body: "Hello Mira", subject: "Coordination" },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.message_id).toBeTruthy();
    expect(data.delivered).toBe(true);

    const inbox = getAgentInbox(agent2Id, {});
    expect(inbox.length).toBeGreaterThan(0);
  });

  it("requires target", () => {
    const result = handleSendMessage({ body: "Hello" }, agent1Id);
    expect(result.isError).toBe(true);
  });
});

describe("get_status", () => {
  it("returns agent and engine status", () => {
    const result = handleGetStatus({}, agent1Id);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.agent.callsign).toBe("Gage");
    expect(data.active_missions).toBeGreaterThanOrEqual(0);
    expect(data.engine.version).toBe("0.1.0");
  });

  it("includes missions when requested", () => {
    const result = handleGetStatus({ include: ["missions"] }, agent1Id);
    const data = JSON.parse(result.content[0].text);
    expect(data.missions).toBeDefined();
  });
});

describe("complete_mission", () => {
  it("transitions mission to complete with artifacts", () => {
    // First accept the mission
    handleAcceptMission({ mission_id: missionId }, agent1Id);

    const result = handleCompleteMission(
      {
        mission_id: missionId,
        summary: "Fixed the auth bypass by adding input validation",
        artifacts: [{ title: "fix.patch", type: "code", content: "diff --git..." }],
        learnings: ["Always validate session tokens"],
      },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe("complete");
    expect(data.artifact_ids).toHaveLength(1);

    const mission = getMission(missionId);
    expect(mission!.status).toBe("complete");
  });
});

describe("submit_artifacts", () => {
  it("creates artifacts for a mission", () => {
    const result = handleSubmitArtifacts(
      {
        mission_id: missionId,
        artifacts: [
          { title: "analysis.md", type: "markdown", content: "# Analysis\n..." },
          { title: "data.json", type: "data", content: '{"results": []}' },
        ],
      },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.artifact_ids).toHaveLength(2);
  });

  it("denies access to unrelated agent", () => {
    const result = handleSubmitArtifacts(
      {
        mission_id: missionId,
        artifacts: [{ title: "x", type: "code", content: "y" }],
      },
      agent2Id,
    );
    expect(result.isError).toBe(true);
  });
});

describe("request_escalation", () => {
  it("creates an escalation approval", () => {
    const result = handleRequestEscalation(
      {
        mission_id: missionId,
        reason: "Need Director approval for schema migration",
        options: ["Proceed", "Abort", "Defer"],
        urgency: "urgent",
      },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.escalation_id).toBeTruthy();
    expect(data.status).toBe("pending");

    const approvals = listApprovals(missionId);
    expect(approvals.length).toBeGreaterThan(0);
  });
});

describe("acknowledge_directive", () => {
  it("publishes acknowledgment event", () => {
    const result = handleAcknowledgeDirective(
      {
        directive_type: "abort",
        mission_id: missionId,
        acknowledged: true,
        note: "Stopping work immediately",
      },
      agent1Id,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.acknowledged).toBe(true);
    expect(data.directive_type).toBe("abort");
  });
});
