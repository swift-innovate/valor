# MCP Integration Architecture for VALOR Engine

## Status: Proposal
## Date: 2026-03-25

---

## 1. Problem Statement

VALOR agents currently communicate via HTTP polling against REST endpoints. This creates several issues:

1. **Polling overhead** — Agents must repeatedly `GET /agents/:id/inbox` to check for new work. This wastes bandwidth and introduces latency between mission dispatch and agent awareness.
2. **X-VALOR-Role complexity** — Agents must manually set `X-VALOR-Role` and `X-VALOR-Agent-Key` headers on every request. This is fragile and error-prone.
3. **No tool discovery** — Agents must be pre-programmed with VALOR's REST API shape. There's no self-describing interface.
4. **Async polling loops** — After submitting a sitrep or accepting a mission, agents poll for responses. There's no synchronous request-response for actions.
5. **Dual auth paths** — Session cookies for dashboard, header-based auth for agents. Two code paths to maintain.

MCP (Model Context Protocol) solves all five problems natively.

---

## 2. What MCP Gives Us

| Capability | Current (REST) | MCP |
|---|---|---|
| Tool discovery | None — agents hardcode endpoints | JSON Schema per tool, automatic registration |
| Authentication | X-VALOR-Role + X-VALOR-Agent-Key headers | Session-level identity on connect |
| Communication | HTTP polling (GET /inbox) | Synchronous tool calls + server notifications |
| Action execution | POST then poll for result | Call tool, get result in response |
| Event streaming | WebSocket (dashboard only) | MCP notifications (server→client push) |
| Schema validation | Manual Zod on server | JSON Schema enforced by protocol |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   VALOR Engine                       │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ REST API │  │  MCP Server  │  │  Event Bus    │  │
│  │ (Hono)   │  │  (stdio/SSE) │  │  (pub/sub)    │  │
│  │          │  │              │  │               │  │
│  │ Dashboard │  │ Agent-facing │  │ Internal      │  │
│  │ Human UI │  │ tool surface │  │ orchestration │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
│       │               │                  │           │
│       └───────────────┼──────────────────┘           │
│                       │                              │
│              ┌────────┴────────┐                     │
│              │  Shared Layer   │                     │
│              │  - Repos (DB)   │                     │
│              │  - Orchestrator │                     │
│              │  - Gates        │                     │
│              │  - Dispatch     │                     │
│              └─────────────────┘                     │
└─────────────────────────────────────────────────────┘
        │                    │
   ┌────┴────┐         ┌────┴────┐
   │ Browser │         │  Agent  │
   │ (Human) │         │  (MCP   │
   │         │         │  Client)│
   └─────────┘         └─────────┘
```

**Key principle:** The MCP server is a new **transport layer** alongside the existing REST API. Both call into the same shared service layer (repos, orchestrator, gates, dispatch). The REST API remains for the dashboard and any non-MCP clients.

---

## 4. MCP Transport Selection

### Recommended: Streamable HTTP (SSE-based)

VALOR agents run as independent processes, often on different machines. stdio transport requires the engine to spawn agents as child processes — this violates VALOR's architecture (engine is orchestrator, not runtime).

**Streamable HTTP** (the MCP SSE transport) fits perfectly:
- Agent connects via HTTP to `POST /mcp` endpoint
- Server responds with SSE stream for notifications
- Agent sends JSON-RPC requests over HTTP
- Works across networks, firewalls, containers
- Supports reconnection natively

### Endpoint

```
POST /mcp                    — JSON-RPC request/response
GET  /mcp/sse?session={id}   — SSE stream for server→client notifications
```

Mounted on the existing Hono server alongside REST routes. No separate process needed.

---

## 5. MCP Session & Identity Model

### Connection Flow

```
Agent                              VALOR MCP Server
  │                                       │
  ├─── initialize ────────────────────────►│
  │    { agent_id, agent_key }            │
  │                                       │── Validate agent_key
  │                                       │── Look up agent record
  │                                       │── Create MCP session
  │◄── initialize response ──────────────│
  │    { session_id, server_info,         │
  │      capabilities, tools }            │
  │                                       │
  ├─── SSE connect ───────────────────────►│
  │    GET /mcp/sse?session={session_id}  │
  │                                       │
  │◄── SSE: notification stream ──────────│
  │    (missions, directives, messages)   │
  │                                       │
  ├─── tool call ─────────────────────────►│
  │    { method: "tools/call",            │
  │      params: { name: "submit_sitrep"  │
  │                arguments: {...} }}     │
  │◄── tool result ───────────────────────│
  │    { content: [...] }                 │
```

### Session Management

```typescript
interface McpSession {
  session_id: string;          // nanoid, returned on initialize
  agent_id: string;            // Resolved from agent_key on connect
  agent_callsign: string;      // Cached for logging
  connected_at: string;        // ISO timestamp
  last_activity: string;       // Updated on every tool call
  expires_at: string;          // connected_at + 30 minutes (rolling)
  sse_connected: boolean;      // Whether SSE stream is active
}
```

**Session rules:**
- 30-minute inactivity timeout (every tool call resets the timer)
- Session ID required on all subsequent requests (MCP `_meta.sessionId`)
- On timeout: agent marked as `degraded` after 5 min, `offline` after 30 min
- On reconnect: agent sends `initialize` again, gets a new session but retains agent identity
- **Implicit heartbeat**: Every tool call counts as a heartbeat (same pattern as current inbox polling)

### Identity Resolution (Replaces X-VALOR-Role)

```typescript
// On initialize, agent provides credentials
interface McpInitializeParams {
  clientInfo: {
    name: string;        // Agent callsign (e.g., "Mira")
    version: string;     // Agent version
  };
  // Custom VALOR extension in _meta
  _meta: {
    agent_key: string;   // Shared secret (same as current VALOR_AGENT_KEY)
  };
}
```

The MCP server resolves identity once at session creation:

```typescript
function resolveAgentIdentity(params: McpInitializeParams): Agent | null {
  const configuredKey = process.env.VALOR_AGENT_KEY;
  if (configuredKey && params._meta?.agent_key !== configuredKey) {
    return null; // Reject
  }
  // Look up agent by callsign
  return agentRepo.findByCallsign(params.clientInfo.name);
}
```

After session creation, every tool call is automatically scoped to that agent. No per-request auth headers needed.

---

## 6. MCP Tool Definitions

### 6.1 `check_inbox` — Unified Inbox (replaces GET /agents/:id/inbox)

The single most important tool. Returns everything an agent needs in one call.

```json
{
  "name": "check_inbox",
  "description": "Check your inbox for pending missions, directives, and messages. Also serves as heartbeat confirmation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "since": {
        "type": "string",
        "format": "date-time",
        "description": "Only return items newer than this timestamp. Omit for all pending items."
      },
      "categories": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["missions", "directives", "messages"]
        },
        "description": "Filter to specific inbox categories. Omit for all."
      }
    },
    "required": []
  }
}
```

**Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"heartbeat_at\":\"2026-03-25T10:00:00Z\",\"pending_missions\":[...],\"directives\":[...],\"messages\":[...]}"
  }]
}
```

**Implementation:** Calls the same `agentRepo`, `missionRepo`, `commsRepo`, and `natsState.drainDirectives()` that the current `GET /agents/:id/inbox` handler uses.

---

### 6.2 `accept_mission` — Accept and Begin a Mission

```json
{
  "name": "accept_mission",
  "description": "Accept a pending mission from your inbox and begin execution.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mission_id": {
        "type": "string",
        "description": "The mission ID to accept"
      }
    },
    "required": ["mission_id"]
  }
}
```

**Response:** Full mission brief (objective, constraints, deliverables, success_criteria) or error if mission is not assigned to this agent.

**Side effects:**
- Updates mission status to `dispatched` (or `streaming` if direct provider)
- Publishes `mission.accepted` event on bus
- Updates agent heartbeat

---

### 6.3 `submit_sitrep` — Report Mission Status

```json
{
  "name": "submit_sitrep",
  "description": "Submit a situation report for an active mission.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mission_id": {
        "type": "string",
        "description": "The mission this sitrep is for"
      },
      "phase": {
        "type": "string",
        "enum": ["V", "A", "L", "O", "R"],
        "description": "Current VALOR phase"
      },
      "status": {
        "type": "string",
        "enum": ["green", "yellow", "red", "hold", "escalated"],
        "description": "Current mission health"
      },
      "summary": {
        "type": "string",
        "description": "Brief status summary"
      },
      "objectives_complete": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Completed objectives"
      },
      "objectives_pending": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Remaining objectives"
      },
      "blockers": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Current blockers"
      },
      "artifacts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "type": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["title", "type", "content"]
        },
        "description": "Deliverable artifacts to attach"
      }
    },
    "required": ["mission_id", "phase", "status", "summary"]
  }
}
```

**Response:** Confirmation with sitrep ID, or escalation instructions if status is `red`/`escalated`.

**Side effects:**
- Persists sitrep to DB via `sitrepRepo`
- Publishes `sitrep.received` event
- If `escalated`: triggers gate evaluation and Director notification

---

### 6.4 `send_message` — Inter-Agent Communication

```json
{
  "name": "send_message",
  "description": "Send a message to another agent or division.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "to_agent_id": {
        "type": "string",
        "description": "Target agent ID (mutually exclusive with to_division_id)"
      },
      "to_division_id": {
        "type": "string",
        "description": "Target division ID (mutually exclusive with to_agent_id)"
      },
      "subject": {
        "type": "string",
        "description": "Message subject"
      },
      "body": {
        "type": "string",
        "description": "Message body"
      },
      "priority": {
        "type": "string",
        "enum": ["routine", "priority", "flash"],
        "default": "routine"
      },
      "conversation_id": {
        "type": "string",
        "description": "Thread ID to continue an existing conversation"
      },
      "category": {
        "type": "string",
        "enum": ["task", "intel", "question", "coordination", "escalation"],
        "default": "coordination"
      }
    },
    "required": ["body"],
    "oneOf": [
      { "required": ["to_agent_id"] },
      { "required": ["to_division_id"] }
    ]
  }
}
```

**Response:** Message ID and delivery confirmation.

---

### 6.5 `get_mission_brief` — Get Full Mission Details

```json
{
  "name": "get_mission_brief",
  "description": "Get the full brief for a specific mission including objectives, constraints, and deliverables.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mission_id": {
        "type": "string",
        "description": "The mission ID to retrieve"
      }
    },
    "required": ["mission_id"]
  }
}
```

**Response:** Complete mission record. Agent can only access missions assigned to them or their division.

---

### 6.6 `complete_mission` — Mark Mission Complete

```json
{
  "name": "complete_mission",
  "description": "Mark a mission as complete with final deliverables.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mission_id": {
        "type": "string",
        "description": "The mission to complete"
      },
      "summary": {
        "type": "string",
        "description": "Final completion summary"
      },
      "artifacts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "type": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["title", "type", "content"]
        },
        "description": "Final deliverable artifacts"
      },
      "learnings": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Lessons learned during execution"
      }
    },
    "required": ["mission_id", "summary"]
  }
}
```

**Side effects:**
- Transitions mission to `complete` (or `aar_pending` if AAR is configured)
- Publishes `mission.completed` event
- Stores artifacts

---

### 6.7 `get_status` — Engine and Division Status

```json
{
  "name": "get_status",
  "description": "Get current engine status including your agent health, division status, and active mission counts.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "include": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["agent", "division", "missions", "engine"]
        },
        "description": "What status sections to include. Defaults to all."
      }
    },
    "required": []
  }
}
```

**Response:** Agent health, division roster, active mission counts, engine uptime.

---

### 6.8 `submit_artifacts` — Upload Work Products

```json
{
  "name": "submit_artifacts",
  "description": "Submit artifacts (code, documents, analysis) for a mission without changing mission status.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mission_id": {
        "type": "string",
        "description": "The mission these artifacts belong to"
      },
      "artifacts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "type": { "type": "string", "enum": ["code", "document", "analysis", "data", "config"] },
            "content": { "type": "string" },
            "filename": { "type": "string" }
          },
          "required": ["title", "type", "content"]
        },
        "minItems": 1
      }
    },
    "required": ["mission_id", "artifacts"]
  }
}
```

---

### 6.9 `request_escalation` — Escalate to Director

```json
{
  "name": "request_escalation",
  "description": "Escalate a decision or blocker to the Director for approval.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mission_id": {
        "type": "string",
        "description": "The mission requiring escalation"
      },
      "reason": {
        "type": "string",
        "description": "Why this needs Director attention"
      },
      "options": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Proposed options for the Director to choose from"
      },
      "urgency": {
        "type": "string",
        "enum": ["routine", "urgent", "critical"],
        "default": "routine"
      }
    },
    "required": ["mission_id", "reason"]
  }
}
```

**Side effects:**
- Creates approval request in DB
- Publishes `mission.approval.requested` event
- Director sees it in dashboard approval queue

---

### 6.10 `acknowledge_directive` — Confirm Receipt of Directive

```json
{
  "name": "acknowledge_directive",
  "description": "Acknowledge receipt of an abort, pause, or reassign directive.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "directive_type": {
        "type": "string",
        "enum": ["abort", "pause", "reassign"]
      },
      "mission_id": {
        "type": "string"
      },
      "acknowledged": {
        "type": "boolean",
        "description": "Whether the agent has acted on the directive"
      },
      "note": {
        "type": "string",
        "description": "Optional note about directive handling"
      }
    },
    "required": ["directive_type", "mission_id", "acknowledged"]
  }
}
```

---

## 7. Server Notifications (Server→Client Push)

MCP supports server-initiated notifications. VALOR uses these to push events to connected agents without polling.

### Notification Types

```typescript
// Mission assigned to this agent
interface MissionAssignedNotification {
  method: "notifications/valor/mission_assigned";
  params: {
    mission_id: string;
    title: string;
    priority: "routine" | "priority" | "flash" | "override";
    objective: string;
  };
}

// Directive issued (abort, pause, reassign)
interface DirectiveNotification {
  method: "notifications/valor/directive";
  params: {
    type: "abort" | "pause" | "reassign";
    mission_id: string;
    reason: string;
    issued_by: string;
  };
}

// Message received
interface MessageNotification {
  method: "notifications/valor/message";
  params: {
    message_id: string;
    from_agent_id: string;
    from_callsign: string;
    subject: string;
    priority: "routine" | "priority" | "flash";
  };
}

// Gate decision (approval/rejection of escalation)
interface GateDecisionNotification {
  method: "notifications/valor/gate_decision";
  params: {
    mission_id: string;
    decision: "approved" | "rejected";
    reason?: string;
  };
}
```

### Notification Delivery

The MCP server subscribes to the internal event bus and routes relevant events to connected agents:

```typescript
// In MCP server initialization
eventBus.subscribe("mission.dispatched", (event) => {
  const agentId = event.payload.assigned_agent_id;
  const session = sessionManager.getByAgentId(agentId);
  if (session?.sse_connected) {
    session.sendNotification("notifications/valor/mission_assigned", {
      mission_id: event.payload.mission_id,
      title: event.payload.title,
      priority: event.payload.priority,
      objective: event.payload.objective,
    });
  }
  // If agent not connected, mission stays in pending queue (check_inbox fallback)
});
```

**Graceful degradation:** If the SSE stream is disconnected, notifications queue up. The agent picks them up on next `check_inbox` call. Push is an optimization, not a requirement.

---

## 8. Implementation Plan

### File Structure

```
src/mcp/
├── server.ts              # MCP server setup, tool registration, transport
├── session-manager.ts     # Session lifecycle, timeouts, reconnection
├── tools/
│   ├── inbox.ts           # check_inbox implementation
│   ├── missions.ts        # accept_mission, get_mission_brief, complete_mission
│   ├── sitreps.ts         # submit_sitrep
│   ├── comms.ts           # send_message
│   ├── status.ts          # get_status
│   ├── artifacts.ts       # submit_artifacts
│   ├── escalation.ts      # request_escalation
│   └── directives.ts      # acknowledge_directive
├── notifications.ts       # Event bus → MCP notification bridge
└── auth.ts                # Agent identity resolution for MCP sessions
```

### Integration with Hono

The MCP server mounts on the existing Hono app as additional routes:

```typescript
// src/index.ts — add alongside existing routes
import { createMcpRoutes } from "./mcp/server.js";

const mcpRoutes = createMcpRoutes({ eventBus, repos, orchestrator });
app.route("/mcp", mcpRoutes);
```

No separate process. Same port (3200). The MCP SSE transport uses standard HTTP — Hono handles it fine.

### Phase 1: Core Tools (Week 1)

Build the MCP server with these tools:
1. `check_inbox` — Direct port of existing inbox handler
2. `accept_mission` — Extract from mission dispatch logic
3. `submit_sitrep` — Direct port of sitrep ingestion
4. `send_message` — Direct port of comms handler
5. `get_status` — New, composed from existing repos

Session management with 30-min timeout.
Agent identity resolution (replaces X-VALOR-Role).

### Phase 2: Full Tool Surface (Week 2)

Add remaining tools:
6. `get_mission_brief`
7. `complete_mission`
8. `submit_artifacts`
9. `request_escalation`
10. `acknowledge_directive`

SSE notification bridge (event bus → connected agents).

### Phase 3: Agent Migration (Week 3)

- Update SKILL.md agent onboarding doc with MCP client instructions
- Build reference MCP client config for Claude Code agents
- Migrate one agent (Mira/Chief of Staff) as proof of concept
- Validate: tool discovery, session management, notifications

### Phase 4: REST Deprecation (Week 4+)

- Mark agent-facing REST endpoints as deprecated (add `Deprecation` header)
- Dashboard continues using REST (human UI, not an MCP client)
- Remove X-VALOR-Role header auth once all agents use MCP
- Agent-facing REST endpoints become internal-only (orchestrator↔dispatcher)

---

## 9. Migration Path: REST → MCP

### What Stays (REST)

| Endpoint | Reason |
|---|---|
| `/dashboard/*` | Human UI, serves HTML |
| `/auth/*` | Session-based human auth |
| `/health` | System health check (ops tooling) |
| `/skill.md` | Static document serving |
| `/api/missions-live` | Dashboard-specific NATS state views |
| WebSocket `/ws` | Dashboard real-time updates |

### What Migrates to MCP

| REST Endpoint | MCP Tool |
|---|---|
| `GET /agents/:id/inbox` | `check_inbox` |
| `POST /agents/:id/heartbeat` | Implicit (any tool call) |
| `POST /missions/:id/dispatch` (agent-side) | `accept_mission` |
| `GET /missions/:id` (agent access) | `get_mission_brief` |
| `POST /sitreps` | `submit_sitrep` |
| `POST /comms/messages` | `send_message` |
| `GET /comms/agents/:id/inbox` | `check_inbox` (messages category) |
| Director approve/reject | Stays REST (dashboard action) |

### What Gets Removed

| Item | Reason |
|---|---|
| `X-VALOR-Role` header | Replaced by MCP session identity |
| `X-VALOR-Agent-Key` header | Replaced by MCP initialize auth |
| `VALOR_ALLOW_ROLE_HEADER_FALLBACK` env var | No longer needed |
| Agent polling loops | Replaced by notifications + on-demand tool calls |

---

## 10. Agent-Side MCP Client Configuration

For Claude Code agents connecting to VALOR via MCP, the `.mcp.json` config:

```json
{
  "mcpServers": {
    "valor": {
      "type": "sse",
      "url": "http://localhost:3200/mcp/sse",
      "headers": {
        "X-VALOR-Agent-Key": "${VALOR_AGENT_KEY}"
      },
      "metadata": {
        "agent_callsign": "Mira"
      }
    }
  }
}
```

The agent's system prompt (SKILL.md) already describes available operations. With MCP, the tools are also machine-discoverable — the agent's LLM sees typed tool schemas and can call them directly.

---

## 11. Comparison: Before and After

### Before (Current REST Polling)

```
Agent Main Loop:
  1. GET /agents/{id}/inbox          ← Poll every 30s
  2. If pending_mission:
     a. Parse mission from JSON
     b. Do work
     c. POST /sitreps { ... }        ← Manual HTTP call with headers
     d. POST /comms/messages { ... }  ← Another manual HTTP call
  3. Sleep 30s
  4. Goto 1
```

Headers on every request:
```
X-VALOR-Role: agent
X-VALOR-Agent-Key: sk-valor-...
Content-Type: application/json
```

### After (MCP)

```
Agent connects to VALOR MCP server once.
Tools appear in agent's tool list automatically.

Agent receives notification: "Mission assigned: fix-auth-bug"
Agent calls: accept_mission({ mission_id: "m_123" })
Agent does work.
Agent calls: submit_sitrep({ mission_id: "m_123", phase: "L", status: "green", summary: "..." })
Agent calls: complete_mission({ mission_id: "m_123", summary: "Fixed", artifacts: [...] })

No headers. No polling. No URL construction.
```

---

## 12. Session Recovery & Edge Cases

### Agent Disconnects Mid-Mission

1. SSE stream drops → server marks `sse_connected = false`
2. Session remains valid for 30 minutes
3. Notifications queue in memory (bounded buffer, 100 items max)
4. Agent reconnects → new SSE stream, buffered notifications delivered
5. If session expired → agent re-initializes, gets new session
6. Pending missions and directives are stateful (DB-backed) — never lost

### Engine Restarts

1. MCP sessions are in-memory — all sessions invalidated on restart
2. Agents detect SSE drop, attempt reconnect
3. On reconnect, agent re-initializes (new session)
4. `check_inbox` returns all pending items from DB — no data loss
5. Agent resumes from last known state

### Concurrent Tool Calls

MCP supports concurrent requests per session. VALOR tool handlers are stateless (they read/write DB) — concurrent calls are safe. The session manager tracks `last_activity` on each call.

---

## 13. Security Considerations

### Agent Authentication

- `VALOR_AGENT_KEY` remains the shared secret, validated once at session creation
- Future: per-agent keys (each agent gets a unique key, mapped in agent record)
- Session IDs are cryptographically random (nanoid, 21 chars)
- Session IDs transmitted over SSE headers, not in URL query params for logging safety

### Scope Enforcement

Every tool handler checks that the calling agent has access:
- `check_inbox`: only returns items for the authenticated agent
- `accept_mission`: only missions assigned to this agent or their division
- `send_message`: sender identity is set from session (cannot impersonate)
- `get_mission_brief`: only missions visible to this agent's division

### Rate Limiting

- Per-session: 60 tool calls per minute (configurable)
- Per-agent: 10 concurrent MCP sessions max (prevents resource exhaustion)
- Notification buffer: 100 items max per session (prevents memory bloat)

---

## 14. Dependency Impact

### New Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.x"
}
```

Single new dependency. The MCP TypeScript SDK handles:
- JSON-RPC protocol
- SSE transport
- Tool schema registration
- Session management primitives

### No Changes To

- Database schema (MCP is a transport layer, not a data model change)
- Event bus (MCP notifications bridge to it, don't replace it)
- Orchestrator logic
- Gate evaluation
- Stream supervision (for direct provider streams — separate concern)
- Dashboard (continues using REST + WebSocket)

---

## 15. Open Questions

1. **Per-agent keys vs shared key?** Current `VALOR_AGENT_KEY` is a single shared secret. MCP sessions would benefit from per-agent keys for audit trail. This could be a Phase 2 enhancement — store unique keys in the agent record.

2. **NATS coexistence?** NATS is currently used for live dashboard state and external operative dispatch. MCP replaces the agent→engine communication channel. NATS may still be valuable for engine→engine (multi-instance) or dashboard real-time. Evaluate after Phase 1.

3. **Director as MCP client?** The Director currently uses the dashboard (browser). A future enhancement could expose Director-specific MCP tools (approve_mission, dispatch_mission, etc.) for CLI-based Director interaction. Not in scope for this proposal.

4. **Notification ordering guarantees?** MCP notifications are fire-and-forget. If ordering matters (e.g., mission assigned before directive to abort), the notification payload should include sequence numbers. Evaluate whether this is needed in practice.
