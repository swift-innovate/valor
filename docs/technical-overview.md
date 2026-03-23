# VALOR Engine — Technical Overview

**Document:** VM-001-2  
**Operative:** Crazy-Eddie  
**Status:** COMPLETE — pending Tracer validation (VM-001-3)  
**Last Updated:** 2026-03-23  

---

## What is VALOR?

VALOR is a standalone orchestration engine for AI agent fleets. It manages agent identity, mission lifecycle, inter-agent communication, and stream supervision — without hosting or running agents directly.

**Key distinction:** VALOR is a *coordinator*, not an *executor*. It dispatches work, monitors progress, and routes messages. The agents themselves run on their own runtimes (OpenClaw, Claude API, Ollama, custom CLIs). VALOR doesn't care what model or platform an agent uses.

---

## Architecture

VALOR is structured as a 7-layer engine:

```
┌─────────────────────────────────────────────────────────────┐
│                    DIRECTOR (Human)                         │
│          Telegram Gateway  │  Web Dashboard                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP API (port 3200)
┌──────────────────────────▼──────────────────────────────────┐
│                    VALOR ENGINE                             │
│                                                             │
│  Layer 1: Core Engine      Mission lifecycle, WAL, streams  │
│  Layer 2: Provider Layer   Claude API, Ollama, OpenClaw     │
│  Layer 3: Identity Layer   Persona registry (SSOP-typed)    │
│  Layer 4: Memory Layer     Namespaced per-division state     │
│  Layer 5: Decision Layer   VECTOR checkpoints, bias scoring │
│  Layer 6: Communication    Typed EventEnvelope pub/sub      │
│  Layer 7: Division Schema  Autonomy policies, escalation    │
└─────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌─────────────────┐      ┌─────────────────┐
    │   Agent (Eddie) │      │   Agent (Gage)  │
    │   OpenClaw      │      │   Claude API    │
    └─────────────────┘      └─────────────────┘
```

---

## Key Components

### Agent Cards

The entry point for every agent. An agent submits a card with its identity, capabilities, runtime, and endpoint URL. A human admin approves or rejects it.

```
POST /agent-cards    → submit card (status: pending)
GET  /agent-cards/:id → poll until approval_status: "approved"
```

Once approved, the agent receives an `agent_id` — its permanent identity in VALOR.

**Card fields:** `callsign`, `name`, `operator`, `primary_skills`, `runtime`, `model`, `endpoint_url`, `description`

**Runtime values:** `claude_api` | `openai_api` | `ollama` | `openclaw` | `custom`

---

### Heartbeats

Agents signal liveness by posting heartbeats every 30 seconds.

```
POST /agents/:agentId/heartbeat
```

Health degrades without heartbeats: `registered` → `healthy` → `degraded` → `offline` → `deregistered`

The Director and other agents use health status to make routing decisions. An `offline` agent won't receive mission dispatches.

---

### Communication Bus

All agent-to-agent messaging routes through VALOR. No direct peer-to-peer connections.

**Messages** have:
- **Priority:** `routine` | `priority` | `flash` (flash triggers a secondary event)
- **Category:** `task_handoff` | `status_update` | `request` | `response` | `escalation` | `advisory` | `coordination`
- **Threading:** `conversation_id` + `in_reply_to` for full thread tracking

```
POST /comms/messages               → send a message
POST /comms/chats                  → start a group conversation
GET  /comms/agents/:id/inbox       → poll inbox (supports ?since= for incremental)
GET  /comms/conversations/:convId  → read full thread
```

Everything is logged. There is no off-the-record communication.

---

### Missions

Missions are the unit of work in VALOR. They have a full lifecycle with approval gates and stream supervision.

**Lifecycle states:**
```
draft → queued → gated → dispatched → streaming → complete
                                                 → aar_pending → aar_complete
                                     → failed
                                     → aborted
```

Key transitions:
- `gated` — being evaluated by control gates (safety, VECTOR, cost)
- `dispatched` — sent to the assigned agent's provider for execution
- `streaming` — agent is actively executing; VALOR supervises the stream
- `aar_pending` — completed, awaiting after-action review
- `aar_complete` — reviewed and closed

```
GET /agents/:agentId/missions      → check assigned missions
POST /sitreps                      → agent reports progress
```

**Agents cannot create missions.** Only the Director can create and dispatch missions. Agents escalate via `category: "escalation"` messages.

---

### Stream Supervision

When a mission is dispatched, VALOR doesn't just fire-and-forget. It maintains an active supervision session:

- **Heartbeat detection** — if the agent stream goes silent, VALOR detects it
- **Sequence tracking** — tokens are tracked in order; gaps trigger alerts
- **Typed failure modes** — timeouts, errors, and stalls have distinct handling
- **Automatic recovery** — configurable retry and fallback strategies

This is the core problem VALOR was built to solve: OpenClaw's gateway failed silently. VALOR surfaces failures immediately.

---

### Control Gates (Pre-Dispatch)

Before a mission is dispatched to an agent, it passes through control gates. These are synchronous, deterministic checks — no LLM involved.

**Gate levels:**
- **P0 — Financial transactions** — blocked immediately, Principal escalation required
- **P1 — Mass communications, destructive operations** — blocked, escalation required
- **P2 — Public content publishing** — flagged, Director approval required
- **OathGate** — Layer 0 absolute blocks; Layer 1-2 escalations
- **VectorCheckpointGate** — blocks high-stakes unanalyzed decisions

Gates run before the Director LLM ever sees the mission. This is intentional: no model reliably handles safety edge cases.

---

### Divisions

Agents are organized into divisions. Each division has:
- A **Division Lead** — the senior agent responsible for that domain
- **Autonomy policy** — what the Lead can do without Director approval
- **Escalation rules** — when to surface decisions to the Principal

Current division structure:
- **Chief of Staff** — cross-cutting executive, Director's proxy
- **Code Division** — development, architecture, technical strategy (Lead: Gage)
- **Operations Division** — physical world, IoT, automation (high autonomy)
- **R&D Division** — research, red team, sandbox (isolated state)
- **Business Division** — business ops, brand, consulting
- **SIT Division** — SIT products and competition (Lead: Eddie)

```
GET /divisions         → list divisions
GET /agents            → roster with health status
```

---

### Artifacts

Structured content shared between agents. Code, configs, docs, data — attached to comms messages and rendered in the dashboard.

```
POST /artifacts                          → create artifact
GET  /artifacts/conversation/:convId     → all artifacts in a thread
```

Artifacts allow agents to share deliverables in a structured, versioned way rather than dumping raw content into message bodies.

---

### VECTOR Decision Layer

High-stakes decisions go through VECTOR analysis before dispatch. VALOR's implementation scores decisions across multiple dimensions (viability, ethics, cost, etc.) with bias risk scoring.

Gates can block missions pending VECTOR analysis. The meta-analysis layer detects cross-decision patterns — if multiple missions are trending toward high-risk outcomes, it surfaces that to the Director.

---

## Value Proposition

**For the Director (Tom):**
- Dispatch a mission from Telegram and walk away
- Get sitreps automatically as work progresses
- Safety gates block dangerous operations before they happen
- Full audit trail — nothing happens without a record

**For agents:**
- Clear identity and capability declaration
- Structured communication that scales past 2 agents
- Mission context persists across sessions
- No more "what am I supposed to be doing?" — the engine knows

**For the system as a whole:**
- Observable: every state transition, message, and decision is logged
- Recoverable: typed failure modes with explicit recovery paths
- Extensible: runtime-agnostic, new providers and divisions without engine changes
- Safe: deterministic gates before any LLM inference

---

## What VALOR Is Not

- **Not an agent runtime.** VALOR doesn't run LLMs. It dispatches to them.
- **Not Engram.** Memory is managed by Engram (standalone). VALOR has a simple per-division state store, not Engram's belief/knowledge graph.
- **Not Herd Pro.** The provider layer speaks standard Ollama HTTP. Any Ollama-compatible proxy works.
- **Not a chat application.** The comms layer is for coordination, not conversation.

---

## Integration Quick Reference

```bash
# 1. Register
curl -X POST http://citadel:3200/agent-cards -d '{"callsign":"MyAgent",...}'

# 2. Poll approval
curl http://citadel:3200/agent-cards/:cardId

# 3. Heartbeat (every 30s)
curl -X POST http://citadel:3200/agents/:agentId/heartbeat

# 4. Check inbox (every 10-15s)
curl http://citadel:3200/comms/agents/:agentId/inbox?since=<timestamp>

# 5. Check missions
curl http://citadel:3200/agents/:agentId/missions

# 6. Sitrep
curl -X POST http://citadel:3200/sitreps -d '{"mission_id":"...","status":"IN_PROGRESS",...}'
```

Full integration guide: `GET /skill.md`

---

## See Also

- `/skill.md` — complete agent integration guide (live, always current)
- `docs/03-ARCHITECTURE.md` — deep architectural detail with layer diagrams
- `docs/PHASE-1-NATS.md` — NATS backbone roadmap
- `src/director/system-prompt.md` — Director LLM prompt and operative roster
