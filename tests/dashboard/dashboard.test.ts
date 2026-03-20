import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";
import { dashboardRoutes } from "../../src/dashboard/index.js";
import {
  createMission,
  createDivision,
  createAgent,
  createApproval,
  createDecision,
} from "../../src/db/index.js";
import { createArtifact } from "../../src/db/repositories/artifact-repo.js";
import { sendMessage, generateConversationId } from "../../src/db/repositories/comms-repo.js";
import { analyzeDecision } from "../../src/vector/index.js";

// Mount dashboard routes at /dashboard like the real server
const app = new Hono();
app.route("/dashboard", dashboardRoutes);

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

// ── Helper: make a request to the test app ──────────────────────────

async function get(path: string): Promise<Response> {
  const req = new Request(`http://localhost${path}`);
  return app.fetch(req);
}

// ── Overview page ───────────────────────────────────────────────────

describe("Overview page", () => {
  it("renders with no data", async () => {
    const res = await get("/dashboard");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Mission Control");
    expect(html).toContain("No divisions registered");
  });

  it("renders division cards", async () => {
    const div = createDivision({
      name: "Code Division",
      lead_agent_id: null,
      autonomy_policy: { max_cost_autonomous_usd: 5.0, approval_required_actions: [], auto_dispatch_enabled: true },
      escalation_policy: { escalate_to: "director", escalate_after_failures: 3, escalate_on_budget_breach: true },
      namespace: "code",
    });

    createMission({
      division_id: div.id,
      title: "Test Mission",
      objective: "Test",
      status: "draft",
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
      dispatched_at: null,
      completed_at: null,
    });

    const res = await get("/dashboard");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Code Division");
    expect(html).toContain("code"); // namespace
  });

  it("shows global stats", async () => {
    const res = await get("/dashboard");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Divisions");
    expect(html).toContain("Agents");
    expect(html).toContain("Active Missions");
    expect(html).toContain("Total Cost");
  });
});

// ── Missions page ───────────────────────────────────────────────────

describe("Missions page", () => {
  it("renders empty state", async () => {
    const res = await get("/dashboard/missions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Mission Pipeline");
    expect(html).toContain("No missions found");
  });

  it("renders mission list", async () => {
    createMission({
      division_id: null,
      title: "Alpha Mission",
      objective: "Test objective",
      status: "draft",
      phase: null,
      assigned_agent_id: null,
      priority: "high",
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

    const res = await get("/dashboard/missions");
    const html = await res.text();
    expect(html).toContain("Alpha Mission");
    expect(html).toContain("draft");
    expect(html).toContain("high");
  });

  it("filters by status", async () => {
    createMission({
      division_id: null,
      title: "Draft Mission",
      objective: "Test",
      status: "draft",
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
      dispatched_at: null,
      completed_at: null,
    });

    const res = await get("/dashboard/missions?status=complete");
    const html = await res.text();
    expect(html).toContain("No missions found");
  });
});

// ── Approvals page ──────────────────────────────────────────────────

describe("Approvals page", () => {
  it("renders empty state", async () => {
    const res = await get("/dashboard/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Approval Queue");
    expect(html).toContain("No");
  });

  it("renders pending approvals", async () => {
    const mission = createMission({
      division_id: null,
      title: "Gated Mission",
      objective: "Needs approval",
      status: "gated",
      phase: null,
      assigned_agent_id: null,
      priority: "high",
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

    createApproval({
      mission_id: mission.id,
      gate: "hil",
      requested_by: "system",
    });

    const res = await get("/dashboard/approvals");
    const html = await res.text();
    expect(html).toContain("Gated Mission");
    expect(html).toContain("hil");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });
});

// ── Agents page ─────────────────────────────────────────────────────

describe("Agents page", () => {
  it("renders empty state", async () => {
    const res = await get("/dashboard/agents");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Roster");
    expect(html).toContain("No agents found");
  });

  it("renders agent cards", async () => {
    createAgent({
      callsign: "Gage",
      division_id: null,
      runtime: "claude_api",
      endpoint_url: null,
      model: "claude-sonnet-4-20250514",
      health_status: "healthy",
      last_heartbeat: new Date().toISOString(),
      persona_id: null,
      capabilities: ["code_review", "architecture"],
    });

    const res = await get("/dashboard/agents");
    const html = await res.text();
    expect(html).toContain("Gage");
    expect(html).toContain("claude_api");
    expect(html).toContain("healthy");
    expect(html).toContain("code_review");
  });

  it("filters by health status", async () => {
    createAgent({
      callsign: "Offline-Agent",
      division_id: null,
      runtime: "custom",
      endpoint_url: null,
      model: null,
      health_status: "offline",
      last_heartbeat: null,
      persona_id: null,
      capabilities: [],
    });

    const res = await get("/dashboard/agents?health=healthy");
    const html = await res.text();
    expect(html).toContain("No agents found");
  });
});

// ── Decisions page ──────────────────────────────────────────────────

describe("Decisions page", () => {
  it("renders empty state", async () => {
    const res = await get("/dashboard/decisions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("VECTOR Decisions");
    expect(html).toContain("No decisions recorded");
  });

  it("renders decision cards with analysis", async () => {
    const decision = createDecision({
      mission_id: null,
      title: "Refactor auth layer",
      context: "Tech debt accumulated",
      constraints: ["No downtime"],
      time_horizon: "2 weeks",
      stakes: "medium",
      confidence_level: 7,
    });

    analyzeDecision(decision.id);

    const res = await get("/dashboard/decisions");
    const html = await res.text();
    expect(html).toContain("Refactor auth layer");
    expect(html).toContain("medium"); // stakes
    expect(html).toContain("Risk Score"); // analysis section present
  });

  it("shows analyze button for unanalyzed decisions", async () => {
    createDecision({
      mission_id: null,
      title: "New feature decision",
      context: "Should we build it?",
      constraints: [],
      time_horizon: "1 month",
      stakes: "low",
      confidence_level: 5,
    });

    const res = await get("/dashboard/decisions");
    const html = await res.text();
    expect(html).toContain("New feature decision");
    expect(html).toContain("Analyze"); // analyze button
  });
});

// ── Artifacts page ───────────────────────────────────────────────────

describe("Artifacts page", () => {
  it("renders empty state", async () => {
    const res = await get("/dashboard/artifacts");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Artifacts");
    expect(html).toContain("No artifacts yet");
  });

  it("renders artifact list", async () => {
    createArtifact({
      title: "bridge.ts",
      content_type: "code",
      language: "typescript",
      content: "export function bridge() {}\n",
      summary: "Bridge module",
      created_by: "director",
      conversation_id: null,
    });

    const res = await get("/dashboard/artifacts");
    const html = await res.text();
    expect(html).toContain("bridge.ts");
    expect(html).toContain("code");
    expect(html).toContain("typescript");
    expect(html).toContain("Bridge module");
  });

  it("renders artifact content in detail panel", async () => {
    const artifact = createArtifact({
      title: "script.py",
      content_type: "code",
      language: "python",
      content: "def hello():\n    return 'world'\n",
      summary: null,
      created_by: "director",
      conversation_id: null,
    });

    const res = await get(`/dashboard/artifacts?id=${artifact.id}`);
    const html = await res.text();
    expect(html).toContain("script.py");
    expect(html).toContain("hello()");
  });
});

// ── Comms: artifact rendering inline ────────────────────────────────

describe("Comms page: artifact rendering", () => {
  it("renders artifact inline when message has attachment", async () => {
    const gage = createAgent({
      callsign: "Gage",
      runtime: "claude_api",
      division_id: null,
      endpoint_url: null,
      model: null,
      persona_id: null,
      capabilities: [],
      health_status: "registered",
      last_heartbeat: null,
    });
    const mira = createAgent({
      callsign: "Mira",
      runtime: "claude_api",
      division_id: null,
      endpoint_url: null,
      model: null,
      persona_id: null,
      capabilities: [],
      health_status: "registered",
      last_heartbeat: null,
    });

    const artifact = createArtifact({
      title: "fix.ts",
      content_type: "code",
      language: "typescript",
      content: "const x = 42;\n",
      summary: "Quick fix",
      created_by: gage.id,
      conversation_id: null,
    });

    const convId = generateConversationId();
    sendMessage({
      from_agent_id: gage.id,
      to_agent_id: mira.id,
      subject: "Check this fix",
      body: "See attached.",
      priority: "routine",
      category: "request",
      conversation_id: convId,
      in_reply_to: null,
      attachments: [artifact.id],
    });

    const res = await get(`/dashboard/comms?conv=${convId}`);
    const html = await res.text();
    expect(html).toContain("fix.ts");
    expect(html).toContain("const x = 42;");
    expect(html).toContain("Quick fix");
  });
});

// ── WebSocket server module ─────────────────────────────────────────

describe("WebSocket module", () => {
  it("exports required functions", async () => {
    const ws = await import("../../src/ws/index.js");
    expect(typeof ws.attachWebSocket).toBe("function");
    expect(typeof ws.getConnectedClients).toBe("function");
    expect(typeof ws.closeWebSocket).toBe("function");
  });

  it("getConnectedClients returns 0 before attach", async () => {
    const { getConnectedClients } = await import("../../src/ws/index.js");
    expect(getConnectedClients()).toBe(0);
  });
});
