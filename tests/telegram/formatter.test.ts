import { describe, it, expect } from "vitest";
import {
  escapeMarkdown,
  formatEngineHealth,
  formatMissionList,
  formatAgentList,
  formatSitrep,
  formatApprovalRequest,
  formatMissionComplete,
  formatMissionFailed,
  formatMissionDispatched,
} from "../../src/telegram/formatter.js";
import type { Mission, Sitrep, Agent } from "../../src/types/index.js";
import type { Approval } from "../../src/db/repositories/approval-repo.js";

describe("escapeMarkdown", () => {
  it("escapes all MarkdownV2 special characters", () => {
    const input = "hello_world *bold* [link](url) ~strike~ `code` >quote #tag +plus -minus =eq |pipe {brace} .dot !bang \\slash";
    const escaped = escapeMarkdown(input);

    // Every special char should be preceded by a backslash
    expect(escaped).toContain("\\_");
    expect(escaped).toContain("\\*");
    expect(escaped).toContain("\\[");
    expect(escaped).toContain("\\]");
    expect(escaped).toContain("\\(");
    expect(escaped).toContain("\\)");
    expect(escaped).toContain("\\~");
    expect(escaped).toContain("\\`");
    expect(escaped).toContain("\\>");
    expect(escaped).toContain("\\#");
    expect(escaped).toContain("\\+");
    expect(escaped).toContain("\\-");
    expect(escaped).toContain("\\=");
    expect(escaped).toContain("\\|");
    expect(escaped).toContain("\\{");
    expect(escaped).toContain("\\}");
    expect(escaped).toContain("\\.");
    expect(escaped).toContain("\\!");
    expect(escaped).toContain("\\\\");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeMarkdown("hello world 123")).toBe("hello world 123");
  });

  it("handles empty string", () => {
    expect(escapeMarkdown("")).toBe("");
  });
});

describe("formatEngineHealth", () => {
  it("produces valid MarkdownV2 health message", () => {
    const msg = formatEngineHealth({
      uptime_s: 3661,
      bus_subscribers: 5,
      active_streams: 2,
      activeMissionCount: 3,
      agentCount: 7,
    });

    expect(msg).toContain("*VALOR Engine Status*");
    expect(msg).toContain("Uptime:");
    expect(msg).toContain("1h 1m 1s");
    expect(msg).toContain("Active missions: 3");
    expect(msg).toContain("Agents: 7");
  });
});

describe("formatMissionList", () => {
  it("returns no-missions message for empty array", () => {
    expect(formatMissionList([])).toBe("*No active missions*");
  });

  it("lists missions with status icons", () => {
    const missions: Mission[] = [
      makeMission({ id: "mis_abc", title: "Test mission", status: "streaming" }),
    ];
    const msg = formatMissionList(missions);
    expect(msg).toContain("*Active Missions*");
    expect(msg).toContain("mis\\_abc");
    expect(msg).toContain("Test mission");
    expect(msg).toContain("streaming");
  });

  it("truncates long lists", () => {
    const missions = Array.from({ length: 20 }, (_, i) =>
      makeMission({ id: `mis_${i}`, title: `Mission ${i}`, status: "queued" }),
    );
    const msg = formatMissionList(missions);
    expect(msg).toContain("and 5 more");
  });
});

describe("formatAgentList", () => {
  it("returns no-agents message for empty array", () => {
    expect(formatAgentList([])).toBe("*No registered agents*");
  });

  it("lists agents with health icons", () => {
    const agents: Agent[] = [
      makeAgent({ callsign: "Gage", health_status: "healthy", runtime: "claude_api" }),
    ];
    const msg = formatAgentList(agents);
    expect(msg).toContain("*Registered Agents*");
    expect(msg).toContain("*Gage*");
    expect(msg).toContain("claude\\_api");
  });
});

describe("formatSitrep", () => {
  it("formats sitrep with mission title", () => {
    const sitrep = makeSitrep({
      summary: "Progress is good",
      status: "green",
      phase: "V",
      confidence: "high",
    });
    const msg = formatSitrep(sitrep, "Test Mission");
    expect(msg).toContain("*Sitrep*");
    expect(msg).toContain("Test Mission");
    expect(msg).toContain("Progress is good");
  });

  it("shows blockers when present", () => {
    const sitrep = makeSitrep({ blockers: ["API rate limit", "Missing config"] });
    const msg = formatSitrep(sitrep);
    expect(msg).toContain("*Blockers:*");
    expect(msg).toContain("API rate limit");
    expect(msg).toContain("Missing config");
  });
});

describe("formatApprovalRequest", () => {
  it("formats approval with mission info", () => {
    const approval: Approval = {
      id: "apr_123",
      mission_id: "mis_456",
      gate: "director_review",
      requested_by: "agt_abc",
      status: "pending",
      resolved_by: null,
      reason: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      expires_at: null,
    };
    const mission = makeMission({ id: "mis_456", title: "Deploy to prod" });
    const msg = formatApprovalRequest(approval, mission);
    expect(msg).toContain("*Approval Required*");
    expect(msg).toContain("Deploy to prod");
    expect(msg).toContain("director\\_review");
    expect(msg).toContain("/approve");
    expect(msg).toContain("/reject");
  });
});

describe("formatMissionComplete", () => {
  it("formats completion message", () => {
    const mission = makeMission({ id: "mis_789", title: "Run tests" });
    const msg = formatMissionComplete(mission);
    expect(msg).toContain("*Mission Complete*");
    expect(msg).toContain("Run tests");
  });
});

describe("formatMissionFailed", () => {
  it("formats failure with reason", () => {
    const mission = makeMission({ id: "mis_fail", title: "Deploy" });
    const msg = formatMissionFailed(mission, "Timeout exceeded");
    expect(msg).toContain("*Mission Failed*");
    expect(msg).toContain("Deploy");
    expect(msg).toContain("Timeout exceeded");
  });

  it("formats failure without reason", () => {
    const mission = makeMission({ id: "mis_fail2", title: "Build" });
    const msg = formatMissionFailed(mission);
    expect(msg).toContain("*Mission Failed*");
    expect(msg).not.toContain("Reason:");
  });
});

describe("formatMissionDispatched", () => {
  it("formats dispatch with assigned agent", () => {
    const mission = makeMission({
      id: "mis_disp",
      title: "Analyze code",
      assigned_agent_id: "agt_gage",
    });
    const msg = formatMissionDispatched(mission);
    expect(msg).toContain("*Mission Dispatched*");
    expect(msg).toContain("agt\\_gage");
  });

  it("shows unassigned when no agent", () => {
    const mission = makeMission({ id: "mis_disp2", title: "Review" });
    const msg = formatMissionDispatched(mission);
    expect(msg).toContain("Unassigned");
  });
});

// Helper factories

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mis_test",
    division_id: null,
    title: "Test Mission",
    objective: "Test objective",
    status: "queued",
    phase: null,
    assigned_agent_id: null,
    priority: "normal",
    constraints: [],
    deliverables: [],
    success_criteria: [],
    token_usage: null,
    cost_usd: 0,
    revision_count: 0,
    max_revisions: 3,
    parent_mission_id: null,
    initiative_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dispatched_at: null,
    completed_at: null,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agt_test",
    callsign: "TestAgent",
    division_id: null,
    runtime: "custom",
    endpoint_url: null,
    model: null,
    health_status: "registered",
    last_heartbeat: null,
    persona_id: null,
    capabilities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSitrep(overrides: Partial<Sitrep> = {}): Sitrep {
  return {
    id: "sit_test",
    mission_id: "mis_test",
    agent_id: "agt_test",
    phase: "V",
    status: "green",
    summary: "All good",
    objectives_complete: [],
    objectives_pending: [],
    blockers: [],
    learnings: [],
    confidence: "high",
    tokens_used: 0,
    delivered_to: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}
