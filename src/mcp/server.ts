import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";
import { resolveAgentIdentity } from "./auth.js";
import {
  createSession,
  touchSession,
  destroySession,
  getSessionByAgentId,
  startSessionCleanup,
  stopSessionCleanup,
  sessionCount,
} from "./session-manager.js";
import { setNotificationSender, startNotificationBridge, stopNotificationBridge } from "./notifications.js";
import { handleCheckInbox } from "./tools/inbox.js";
import { handleAcceptMission, handleGetMissionBrief, handleCompleteMission } from "./tools/missions.js";
import { handleSubmitSitrep } from "./tools/sitreps.js";
import { handleSendMessage } from "./tools/comms.js";
import { handleGetStatus } from "./tools/status.js";
import { handleSubmitArtifacts } from "./tools/artifacts.js";
import { handleRequestEscalation } from "./tools/escalation.js";
import { handleAcknowledgeDirective } from "./tools/directives.js";

// Map sessionId → { transport, agentId }
const transports = new Map<string, { transport: WebStandardStreamableHTTPServerTransport; agentId: string }>();

function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "valor-engine", version: "0.1.0" },
    { capabilities: { tools: {}, logging: {} } },
  );

  // ── check_inbox ──────────────────────────────────────────────────
  mcp.tool(
    "check_inbox",
    "Check your inbox for pending missions, directives, and messages. Also serves as heartbeat confirmation.",
    {
      since: z.string().optional().describe("Only return items newer than this ISO timestamp"),
      categories: z.array(z.string()).optional().describe("Filter to: missions, directives, messages"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleCheckInbox(args, agentId);
    },
  );

  // ── accept_mission ───────────────────────────────────────────────
  mcp.tool(
    "accept_mission",
    "Accept a pending mission from your inbox and begin execution.",
    {
      mission_id: z.string().describe("The mission ID to accept"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleAcceptMission(args, agentId);
    },
  );

  // ── submit_sitrep ────────────────────────────────────────────────
  mcp.tool(
    "submit_sitrep",
    "Submit a situation report for an active mission.",
    {
      mission_id: z.string().describe("The mission this sitrep is for"),
      phase: z.enum(["V", "A", "L", "O", "R"]).describe("Current VALOR phase"),
      status: z.enum(["green", "yellow", "red", "hold", "escalated"]).describe("Current mission health"),
      summary: z.string().describe("Brief status summary"),
      objectives_complete: z.array(z.string()).optional().describe("Completed objectives"),
      objectives_pending: z.array(z.string()).optional().describe("Remaining objectives"),
      blockers: z.array(z.string()).optional().describe("Current blockers"),
      artifacts: z.array(z.object({
        title: z.string(),
        type: z.string(),
        content: z.string(),
      })).optional().describe("Artifacts to attach"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleSubmitSitrep(args, agentId);
    },
  );

  // ── send_message ─────────────────────────────────────────────────
  mcp.tool(
    "send_message",
    "Send a message to another agent or division.",
    {
      to_agent_id: z.string().optional().describe("Target agent ID"),
      to_division_id: z.string().optional().describe("Target division ID"),
      subject: z.string().optional().describe("Message subject"),
      body: z.string().describe("Message body"),
      priority: z.enum(["routine", "priority", "flash"]).optional().describe("Message priority"),
      conversation_id: z.string().optional().describe("Thread ID to continue an existing conversation"),
      category: z.enum(["task_handoff", "status_update", "request", "response", "escalation", "advisory", "coordination"]).optional(),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleSendMessage(args, agentId);
    },
  );

  // ── get_status ───────────────────────────────────────────────────
  mcp.tool(
    "get_status",
    "Get current engine status including your agent health, division status, and active mission counts.",
    {
      include: z.array(z.string()).optional().describe("What sections to include: agent, division, missions, engine"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleGetStatus(args, agentId);
    },
  );

  // ── get_mission_brief ────────────────────────────────────────────
  mcp.tool(
    "get_mission_brief",
    "Get the full brief for a specific mission.",
    {
      mission_id: z.string().describe("The mission ID to retrieve"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleGetMissionBrief(args, agentId);
    },
  );

  // ── complete_mission ─────────────────────────────────────────────
  mcp.tool(
    "complete_mission",
    "Mark a mission as complete with final deliverables.",
    {
      mission_id: z.string().describe("The mission to complete"),
      summary: z.string().describe("Final completion summary"),
      artifacts: z.array(z.object({
        title: z.string(),
        type: z.string(),
        content: z.string(),
      })).optional().describe("Final deliverable artifacts"),
      learnings: z.array(z.string()).optional().describe("Lessons learned"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleCompleteMission(args, agentId);
    },
  );

  // ── submit_artifacts ─────────────────────────────────────────────
  mcp.tool(
    "submit_artifacts",
    "Submit artifacts (code, documents, analysis) for a mission without changing mission status.",
    {
      mission_id: z.string().describe("The mission these artifacts belong to"),
      artifacts: z.array(z.object({
        title: z.string(),
        type: z.string(),
        content: z.string(),
        filename: z.string().optional(),
      })).min(1).describe("Artifacts to submit"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleSubmitArtifacts(args, agentId);
    },
  );

  // ── request_escalation ───────────────────────────────────────────
  mcp.tool(
    "request_escalation",
    "Escalate a decision or blocker to the Director for approval.",
    {
      mission_id: z.string().describe("The mission requiring escalation"),
      reason: z.string().describe("Why this needs Director attention"),
      options: z.array(z.string()).optional().describe("Proposed options for the Director"),
      urgency: z.enum(["routine", "urgent", "critical"]).optional().describe("Urgency level"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleRequestEscalation(args, agentId);
    },
  );

  // ── acknowledge_directive ────────────────────────────────────────
  mcp.tool(
    "acknowledge_directive",
    "Acknowledge receipt of an abort, pause, or reassign directive.",
    {
      directive_type: z.enum(["abort", "pause", "reassign"]).describe("Type of directive"),
      mission_id: z.string().describe("The mission the directive is for"),
      acknowledged: z.boolean().describe("Whether the agent has acted on the directive"),
      note: z.string().optional().describe("Optional note about directive handling"),
    },
    (args, extra) => {
      const agentId = resolveAgentFromExtra(extra);
      if (!agentId) return errResult("Not authenticated");
      return handleAcknowledgeDirective(args, agentId);
    },
  );

  return mcp;
}

function errResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function resolveAgentFromExtra(extra: unknown): string | null {
  // The extra object contains sessionId from the transport
  const e = extra as { sessionId?: string };
  if (!e.sessionId) return null;
  const entry = transports.get(e.sessionId);
  return entry?.agentId ?? null;
}

export function createMcpRoutes(): Hono {
  const app = new Hono();

  // Handle all MCP requests (POST for JSON-RPC, GET for SSE, DELETE for session close)
  app.all("/", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    // Existing session — route directly to transport
    if (sessionId && transports.has(sessionId)) {
      const entry = transports.get(sessionId)!;
      touchSession(sessionId);

      // Parse body once, pass to transport via parsedBody to avoid double-read
      let parsedBody: unknown;
      if (c.req.method === "POST") {
        parsedBody = await c.req.json();
      }

      const response = await entry.transport.handleRequest(c.req.raw, { parsedBody });
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }

    // New session — must be a POST with initialize
    if (c.req.method !== "POST") {
      return c.json({ error: "No valid session. Send initialize first." }, 400);
    }

    const body = await c.req.json();

    // Check if this is an initialize request
    const messages = Array.isArray(body) ? body : [body];
    const initMsg = messages.find((m: { method?: string }) => m.method === "initialize");

    if (!initMsg) {
      return c.json({ error: "No valid session. Send initialize first." }, 400);
    }

    const params = initMsg.params ?? {};
    const clientInfo = params.clientInfo ?? {};
    const meta = params._meta ?? {};

    const callsign = clientInfo.name ?? "unknown";
    const agentKey = meta.agent_key as string | undefined;

    const agent = resolveAgentIdentity(callsign, agentKey);
    if (!agent) {
      return c.json({ error: "Authentication failed: agent not found or deregistered" }, 401);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => nanoid(21),
      onsessioninitialized: (sid) => {
        createSession(agent.id, agent.callsign);
        transports.set(sid, { transport, agentId: agent.id });
        logger.info("MCP session initialized", {
          session_id: sid,
          agent_id: agent.id,
          callsign: agent.callsign,
        });
      },
      onsessionclosed: (sid) => {
        transports.delete(sid);
        logger.info("MCP session closed", { session_id: sid });
      },
    });

    const mcp = createMcpServer();
    await mcp.connect(transport);

    // Pass parsedBody so transport doesn't try to re-read the consumed stream
    const response = await transport.handleRequest(c.req.raw, { parsedBody: body });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  });

  return app;
}

export function startMcp(): void {
  startSessionCleanup();

  // Wire notification sender
  setNotificationSender((agentId, method, params) => {
    const session = getSessionByAgentId(agentId);
    if (!session) return;
    const entry = transports.get(session.session_id);
    if (!entry) return;

    // Send via the underlying Server's notification mechanism
    // The transport will relay to the connected client
    logger.debug("MCP notification queued", { agent_id: agentId, method });
  });

  startNotificationBridge();

  logger.info("MCP server started", {
    tools: 10,
    transport: "streamable-http",
  });
}

export function stopMcp(): void {
  stopNotificationBridge();
  stopSessionCleanup();

  for (const [sid, entry] of transports) {
    entry.transport.close();
  }
  transports.clear();

  logger.info("MCP server stopped");
}

export function mcpStatus(): { sessions: number; transport: string } {
  return {
    sessions: sessionCount(),
    transport: "streamable-http",
  };
}
