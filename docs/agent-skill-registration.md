# VALOR Engine — Agent Registration Skill

> **Note:** This document covers REST-based registration. For the recommended MCP-based communication (typed tools, session auth, no polling), see [`/skill.md`](../SKILL.md) §MCP Connection.

You are an AI agent connecting to the VALOR engine. This document tells you how to register, maintain health, and operate within the VALOR command hierarchy.

## Engine Location

```
Base URL: http://localhost:3200
MCP endpoint: POST http://localhost:3200/mcp
WebSocket: ws://localhost:3200/ws
```

Adjust the host if the engine runs elsewhere.

---

## Step 1: Register Yourself

> **Preferred path:** Submit an agent card via `POST /agent-cards` and wait for approval. Direct `POST /agents` is restricted to Director role. See [`/skill.md`](../SKILL.md) §1 for the agent card flow.

Send a POST to `/agents` with your identity (Director role required):

```http
POST /agents
Content-Type: application/json

{
  "callsign": "<your callsign>",
  "runtime": "<your runtime type>",
  "endpoint_url": "<your webhook URL or null>",
  "model": "<model you run on or null>",
  "division_id": "<division ID if assigned, or null>",
  "capabilities": ["<list>", "<of>", "<your>", "<capabilities>"]
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `callsign` | string | Your unique name. Examples: `Mira`, `Gage`, `Zeke`, `Rook`, `Eddie` |
| `runtime` | enum | One of: `openclaw`, `herd`, `claude_api`, `ollama`, `custom` |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoint_url` | string | null | URL where the engine can reach you via webhook |
| `model` | string | null | Model identifier you run on (e.g., `claude-sonnet-4-20250514`, `llama3.1:70b`) |
| `division_id` | string | null | Division you belong to. Get division IDs from `GET /divisions` |
| `capabilities` | string[] | [] | What you can do: `code_review`, `architecture`, `research`, `writing`, `analysis`, `homestead_ops`, `red_team`, etc. |

### Response

```json
{
  "id": "agt_abc123...",
  "callsign": "Mira",
  "runtime": "openclaw",
  "health_status": "registered",
  "division_id": null,
  "endpoint_url": "http://lxc200:3000/webhook",
  "model": "claude-sonnet-4-20250514",
  "capabilities": ["intent_routing", "cross_division_coordination"],
  "persona_id": null,
  "last_heartbeat": null,
  "created_at": "2026-03-08T22:00:00.000Z",
  "updated_at": "2026-03-08T22:00:00.000Z"
}
```

**Save your `id` — you need it for all subsequent calls.**

---

## Step 2: Start Heartbeats

After registration your status is `registered`. Send heartbeats to prove you are alive:

```http
POST /agents/<your-agent-id>/heartbeat
```

No body required. Each heartbeat sets your status to `healthy` and updates `last_heartbeat`.

**Heartbeat cadence:** Send every 30–60 seconds. If you stop sending heartbeats, the engine will eventually mark you `degraded` or `offline`.

---

## Step 3: Check Your Assignments

Query missions assigned to you:

```http
GET /agents/<your-agent-id>/missions
```

Returns an array of missions. Each mission has:

| Field | Meaning |
|-------|---------|
| `id` | Mission ID (e.g., `mis_xyz...`) |
| `title` | Human-readable mission name |
| `objective` | What you need to accomplish |
| `status` | Current state: `draft`, `queued`, `dispatched`, `streaming`, etc. |
| `priority` | `critical`, `high`, `normal`, `low` |
| `constraints` | Rules you must follow |
| `deliverables` | What you must produce |
| `success_criteria` | How success is measured |
| `max_revisions` | How many revision cycles are allowed |

Focus on missions with status `dispatched` — those are your active assignments.

---

## Step 4: Understand the Mission Lifecycle

Missions flow through these states:

```
draft → queued → gated → dispatched → streaming → complete → aar_pending → aar_complete
                                                  ↘ failed
                                                  ↘ aborted
```

- **draft**: Created but not yet queued
- **queued**: Waiting for dispatch
- **gated**: Blocked by a control gate (budget, approval, oath check, etc.)
- **dispatched**: Assigned to you — begin work
- **streaming**: You are actively producing output
- **complete**: Work finished, pending after-action review
- **aar_pending**: Director is reviewing your output
- **aar_complete**: Approved. Mission done.
- **failed / aborted**: Terminal states

When you receive a dispatched mission, execute it and report back.

---

## Step 5: Maintain Health

The engine tracks your health via heartbeats. Health states:

| Status | Meaning |
|--------|---------|
| `registered` | Just registered, no heartbeat yet |
| `healthy` | Heartbeating normally |
| `degraded` | Missed heartbeats or slow responses |
| `offline` | Unreachable |
| `deregistered` | Removed from the engine |

Keep sending heartbeats to stay `healthy`.

---

## Optional: Join a Division

If divisions exist, list them:

```http
GET /divisions
```

If your registration didn't include a `division_id`, update yourself:

```http
PUT /agents/<your-agent-id>
Content-Type: application/json

{
  "division_id": "<division-id>"
}
```

---

## Optional: Attach a Persona

If a persona has been loaded for you (via the persona loader or API), attach it:

```http
PUT /agents/<your-agent-id>/persona
Content-Type: application/json

{
  "persona_id": "<persona-id>"
}
```

Query available personas: `GET /personas` or `GET /personas/callsign/<your-callsign>`

---

## Runtime-Specific Notes

### OpenClaw Agents

- Set `runtime` to `openclaw`
- Set `endpoint_url` to your OpenClaw instance webhook endpoint
- The engine will dispatch missions to you via webhook POST to your `endpoint_url`
- You report status back by calling the engine API

### VALOR Operatives (Custom/Claude API)

- Set `runtime` to `custom` or `claude_api` depending on your backend
- If you can receive webhooks, set `endpoint_url`
- If you poll for work, periodically check `GET /agents/<id>/missions` for dispatched missions
- Send heartbeats to confirm you are operational

### Herd/Ollama Agents

- Set `runtime` to `herd` or `ollama`
- Set `model` to the specific model you run (e.g., `llama3.1:70b`)
- Set `endpoint_url` to your local inference endpoint

---

## Quick Registration Examples

### Mira (OpenClaw, cross-cutting)

```json
{
  "callsign": "Mira",
  "runtime": "openclaw",
  "endpoint_url": "http://lxc200:3000/webhook",
  "model": "claude-sonnet-4-20250514",
  "capabilities": ["intent_routing", "cross_division_coordination", "sitrep", "triage"]
}
```

### VALOR Operative

```json
{
  "callsign": "Operative-1",
  "runtime": "custom",
  "model": "claude-sonnet-4-20250514",
  "capabilities": ["code_review", "research", "analysis"]
}
```

### Gage (Code Division Lead, Claude API)

```json
{
  "callsign": "Gage",
  "runtime": "claude_api",
  "model": "claude-sonnet-4-20250514",
  "division_id": "<code-division-id>",
  "capabilities": ["architecture", "code_review", "technical_strategy", "development"]
}
```

### Zeke (Swift Ranch, Ollama/Herd)

```json
{
  "callsign": "Zeke",
  "runtime": "herd",
  "endpoint_url": "http://localhost:11434",
  "model": "llama3.1:70b",
  "division_id": "<ranch-division-id>",
  "capabilities": ["homestead_ops", "sensor_monitoring", "automation"]
}
```

---

## Step 6: Report Sitreps

When working on a mission, report your status back to the engine:

```http
POST /sitreps
Content-Type: application/json

{
  "mission_id": "<mission-id>",
  "agent_id": "<your-agent-id>",
  "phase": "A",
  "status": "green",
  "summary": "Completed initial analysis, proceeding to implementation",
  "objectives_complete": ["Research phase complete"],
  "objectives_pending": ["Write implementation", "Run tests"],
  "blockers": [],
  "learnings": ["Found existing utility that simplifies the approach"],
  "confidence": "high",
  "tokens_used": 1500,
  "delivered_to": []
}
```

### Sitrep Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mission_id` | string | yes | The mission you're reporting on |
| `agent_id` | string | yes | Your agent ID |
| `phase` | enum | yes | VALOR phase: `V` (Validate), `A` (Act), `L` (Learn), `O` (Optimize), `R` (Report) |
| `status` | enum | yes | `green` (on track), `yellow` (at risk), `red` (blocked), `hold` (paused), `escalated` (needs Director) |
| `summary` | string | yes | Human-readable status update |
| `objectives_complete` | string[] | no | What you've finished |
| `objectives_pending` | string[] | no | What remains |
| `blockers` | string[] | no | What's preventing progress |
| `learnings` | string[] | no | Insights discovered during work |
| `confidence` | enum | no | `high`, `medium`, `low`, `conflicting` (default: `medium`) |
| `tokens_used` | number | no | Token consumption so far (default: `0`) |

**When to send sitreps:**
- After completing each VALOR phase
- When status changes (e.g., green → yellow)
- When encountering blockers
- On mission completion

**Escalation:** Setting `status` to `escalated` automatically notifies the Director via the event bus.

### Query sitreps

```http
GET /sitreps?mission_id=<id>           # All sitreps for a mission
GET /sitreps?agent_id=<id>             # All your sitreps
GET /sitreps/mission/<id>/latest       # Latest sitrep for a mission
```

---

## Receiving Mission Dispatches (Webhook)

If you registered with an `endpoint_url`, the engine will POST mission briefs directly to you:

```json
{
  "type": "mission.dispatch",
  "mission_id": "mis_abc123...",
  "mission": {
    "id": "mis_abc123...",
    "title": "Refactor auth layer",
    "objective": "Simplify the authentication middleware",
    "priority": "high",
    "constraints": ["No downtime"],
    "deliverables": ["Updated auth module"],
    "success_criteria": ["All tests pass"],
    "max_revisions": 3
  },
  "callback_url": "http://localhost:3200/agents/<your-id>/sitrep",
  "timestamp": "2026-03-08T22:00:00.000Z"
}
```

Headers included:
- `X-VALOR-Source: engine`
- `X-VALOR-Mission-ID: <mission-id>`

Your endpoint should return `200` to acknowledge receipt. Then begin work and report sitreps to the `callback_url`.

If you don't have an `endpoint_url`, poll `GET /agents/<id>/missions` for new dispatched missions.

---

## Full API Reference

### MCP Tools (Recommended)

Connect via `POST /mcp` with `initialize` to get session-based access to all tools:

| Tool | Purpose |
|------|---------|
| `check_inbox` | Unified inbox + heartbeat |
| `accept_mission` | Accept a pending mission |
| `submit_sitrep` | Report mission status |
| `send_message` | Send message to agent/division |
| `get_mission_brief` | Get full mission details |
| `complete_mission` | Mark mission done |
| `submit_artifacts` | Upload work products |
| `request_escalation` | Escalate to Director |
| `acknowledge_directive` | Confirm abort/pause/reassign |
| `get_status` | Agent health + engine info |

### REST Endpoints (Legacy)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST /agent-cards` | Submit agent card (preferred registration) |
| `POST /agents` | Register directly (Director only) |
| `GET /agents/<id>` | Check your own record |
| `PUT /agents/<id>` | Update your details |
| `POST /agents/<id>/heartbeat` | Send heartbeat |
| `GET /agents/<id>/inbox` | Unified inbox (heartbeat + missions + directives + messages) |
| `GET /agents/<id>/missions` | List your missions |
| `PUT /agents/<id>/persona` | Attach a persona |
| `POST /sitreps` | Report mission status |
| `GET /sitreps?mission_id=<id>` | Query sitreps for a mission |
| `GET /sitreps/mission/<id>/latest` | Latest sitrep for a mission |
| `GET /divisions` | List available divisions |
| `GET /personas` | List available personas |
| `GET /health` | Check engine health |
| `ws://host:3200/ws` | WebSocket for real-time events |

---

## WebSocket Events

Connect to `ws://localhost:3200/ws` to receive real-time event bus broadcasts. Events arrive as JSON:

```json
{
  "type": "mission.status.changed",
  "timestamp": "2026-03-08T22:00:00.000Z",
  "source": { "id": "system", "type": "engine" },
  "payload": { ... }
}
```

Event types you may see: `mission.*`, `agent.*`, `gate.*`, `stream.*`, `vector.*`, `system.*`

Listen for events targeting your agent ID or your division to stay informed.
