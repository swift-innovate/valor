import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  createMission,
  createAgent,
  createApproval,
  createSitrep,
} from "../../src/db/repositories/index.js";
import { clearSubscriptions } from "../../src/bus/index.js";
import {
  handleStatus,
  handleMissions,
  handleApprove,
  handleReject,
  handleDispatch,
  handleAgents,
  handleSitrep,
} from "../../src/telegram/commands.js";
import type { Context } from "grammy";

function makeCtx(text: string): Context & { replies: Array<{ text: string; opts?: unknown }> } {
  const replies: Array<{ text: string; opts?: unknown }> = [];
  return {
    message: { text },
    chat: { id: 12345 },
    reply: vi.fn(async (text: string, opts?: unknown) => {
      replies.push({ text, opts });
    }),
    replies,
  } as unknown as Context & { replies: Array<{ text: string; opts?: unknown }> };
}

beforeEach(() => {
  freshDb();
  clearSubscriptions();
  (globalThis as Record<string, unknown>).__valor_start_time = Date.now() - 60_000;
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

describe("handleStatus", () => {
  it("replies with engine health info", async () => {
    const ctx = makeCtx("/status");
    await handleStatus(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = ctx.replies[0].text;
    expect(text).toContain("VALOR Engine Status");
    expect(text).toContain("Active missions:");
    expect(text).toContain("Agents:");
  });
});

describe("handleMissions", () => {
  it("replies with no missions when empty", async () => {
    const ctx = makeCtx("/missions");
    await handleMissions(ctx);

    expect(ctx.replies[0].text).toContain("No active missions");
  });

  it("lists active missions", async () => {
    createMission({
      division_id: null,
      title: "Test task",
      objective: "Do the thing",
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
      dispatched_at: null,
      completed_at: null,
    });

    const ctx = makeCtx("/missions");
    await handleMissions(ctx);

    expect(ctx.replies[0].text).toContain("Active Missions");
    expect(ctx.replies[0].text).toContain("Test task");
  });
});

describe("handleAgents", () => {
  it("replies with no agents when empty", async () => {
    const ctx = makeCtx("/agents");
    await handleAgents(ctx);

    expect(ctx.replies[0].text).toContain("No registered agents");
  });

  it("lists registered agents", async () => {
    createAgent({
      callsign: "Gage",
      division_id: null,
      runtime: "claude_api",
      endpoint_url: null,
      model: "claude-3-opus",
      health_status: "healthy",
      last_heartbeat: new Date().toISOString(),
      persona_id: null,
      capabilities: ["code_review"],
    });

    const ctx = makeCtx("/agents");
    await handleAgents(ctx);

    expect(ctx.replies[0].text).toContain("Gage");
    expect(ctx.replies[0].text).toContain("claude\\_api");
  });
});

describe("handleApprove", () => {
  it("replies with usage when no mission_id provided", async () => {
    const ctx = makeCtx("/approve");
    await handleApprove(ctx);

    expect(ctx.replies[0].text).toContain("Usage:");
  });

  it("replies when no pending approvals", async () => {
    const ctx = makeCtx("/approve mis_nonexistent");
    await handleApprove(ctx);

    expect(ctx.replies[0].text).toContain("No pending approvals");
  });

  it("approves a pending approval", async () => {
    const mission = createMission({
      division_id: null,
      title: "Gated mission",
      objective: "Needs approval",
      status: "gated",
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
      dispatched_at: null,
      completed_at: null,
    });

    createApproval({
      mission_id: mission.id,
      gate: "director_review",
      requested_by: "agt_test",
    });

    const ctx = makeCtx(`/approve ${mission.id}`);
    await handleApprove(ctx);

    expect(ctx.replies[0].text).toContain("Approved mission");
  });
});

describe("handleReject", () => {
  it("replies with usage when no mission_id provided", async () => {
    const ctx = makeCtx("/reject");
    await handleReject(ctx);

    expect(ctx.replies[0].text).toContain("Usage:");
  });

  it("rejects with reason", async () => {
    const mission = createMission({
      division_id: null,
      title: "Reject me",
      objective: "Should be rejected",
      status: "gated",
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
      dispatched_at: null,
      completed_at: null,
    });

    createApproval({
      mission_id: mission.id,
      gate: "director_review",
      requested_by: "agt_test",
    });

    const ctx = makeCtx(`/reject ${mission.id} Not ready yet`);
    await handleReject(ctx);

    expect(ctx.replies[0].text).toContain("Rejected mission");
    expect(ctx.replies[0].text).toContain("Not ready yet");
  });
});

describe("handleDispatch", () => {
  it("replies with usage when missing args", async () => {
    const ctx = makeCtx("/dispatch");
    await handleDispatch(ctx);

    expect(ctx.replies[0].text).toContain("Usage:");
  });

  it("creates a mission for known agent", async () => {
    createAgent({
      callsign: "Gage",
      division_id: null,
      runtime: "claude_api",
      endpoint_url: null,
      model: null,
      health_status: "healthy",
      last_heartbeat: null,
      persona_id: null,
      capabilities: [],
    });

    const ctx = makeCtx("/dispatch Gage Review the API module");
    await handleDispatch(ctx);

    expect(ctx.replies[0].text).toContain("Mission Created");
    expect(ctx.replies[0].text).toContain("Gage");
  });

  it("creates unassigned mission for unknown agent", async () => {
    const ctx = makeCtx("/dispatch UnknownBot Fix the thing");
    await handleDispatch(ctx);

    expect(ctx.replies[0].text).toContain("Mission Created");
    expect(ctx.replies[0].text).toContain("not found");
  });
});

describe("handleSitrep", () => {
  it("replies with no sitreps message", async () => {
    const ctx = makeCtx("/sitrep mis_nonexistent");
    await handleSitrep(ctx);

    expect(ctx.replies[0].text).toContain("No sitreps");
  });

  it("shows sitrep for specific mission", async () => {
    const agent = createAgent({
      callsign: "SitrepAgent",
      division_id: null,
      runtime: "custom",
      endpoint_url: null,
      model: null,
      health_status: "registered",
      last_heartbeat: null,
      persona_id: null,
      capabilities: [],
    });

    const mission = createMission({
      division_id: null,
      title: "Sitrep test",
      objective: "Test sitrep retrieval",
      status: "streaming",
      phase: "V",
      assigned_agent_id: agent.id,
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
      dispatched_at: null,
      completed_at: null,
    });

    createSitrep({
      mission_id: mission.id,
      agent_id: agent.id,
      phase: "V",
      status: "green",
      summary: "Everything is on track",
      objectives_complete: ["task 1"],
      objectives_pending: ["task 2"],
      blockers: [],
      learnings: [],
      confidence: "high",
      tokens_used: 500,
      delivered_to: [],
    });

    const ctx = makeCtx(`/sitrep ${mission.id}`);
    await handleSitrep(ctx);

    expect(ctx.replies[0].text).toContain("Sitrep");
    expect(ctx.replies[0].text).toContain("Everything is on track");
  });

  it("lists all active mission sitreps when no id given", async () => {
    const ctx = makeCtx("/sitrep");
    await handleSitrep(ctx);

    // With no active missions, should say no active missions
    expect(ctx.replies[0].text).toContain("No active missions");
  });
});
