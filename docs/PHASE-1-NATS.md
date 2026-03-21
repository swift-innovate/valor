# VALOR Phase 1: NATS Backbone + Director Brain

**Codename:** NERVOUS-SYSTEM  
**Status:** PLANNING (blocked on Phase 0 completion)  
**Timeline:** 1-2 weeks after Phase 0 completes  
**Principal:** Tom (transitioning to Flight Director)  
**Objective:** Replace the markdown mission board with NATS messaging and wire an LLM into the Director role, enabling Tom to issue high-level missions and walk away.

---

## Prerequisites (from Phase 0)

All must be in Done status before Phase 1 begins:

- [  ] VM-001: NATS subject schema document exists
- [  ] VM-002: NATS TypeScript client module compiles and connects
- [  ] VM-003: Agent-tick consumer prototype works
- [  ] VM-004: Operative roster/manifest is complete
- [  ] VM-005: Director model selection is decided with benchmark data

---

## What Changes from Phase 0

| Aspect | Phase 0 | Phase 1 |
|--------|---------|---------|
| Mission dispatch | Tom edits BOARD.md | Tom sends `/mission` via Telegram → Director LLM decomposes → NATS publishes |
| Agent pickup | Agent-tick reads BOARD.md | Agent-tick subscribes to NATS `valor.missions.<op>.pending` |
| Sitreps | Agent updates BOARD.md | Agent publishes to `valor.sitreps.<mission_id>` → Telegram + Dashboard |
| Coordination | Git commits as communication | NATS `valor.comms.*` subjects for agent-to-agent messaging |
| Routing | Tom decides who does what | Director LLM classifies, decomposes, and routes |
| Review | Tom reviews manually | Analyst agent reviews, publishes verdict |

---

## Infrastructure

### NATS Server

Single `nats-server` binary. Deployment options in priority order:

1. **VALOR Linux VM on Proxmox** (preferred) — runs alongside VALOR services
2. **CITADEL/Starbase** — if VALOR VM isn't ready yet
3. **Tom's workstation** — temporary fallback during dev

```bash
# Install (single binary, no dependencies)
curl -L https://github.com/nats-io/nats-server/releases/latest/download/nats-server-v2.10-linux-amd64.tar.gz | tar xz
sudo mv nats-server /usr/local/bin/

# Run with minimal config
nats-server -c nats.conf
```

**nats.conf (minimal):**

```
listen: 0.0.0.0:4222
max_payload: 1MB

# Tailscale-only access (bind to Tailscale IP if needed)
# listen: 100.x.x.x:4222

# JetStream for durable queues (missions must survive restarts)
jetstream {
  store_dir: /var/lib/nats/jetstream
  max_mem: 256MB
  max_file: 1GB
}
```

**Why JetStream:** Missions must be durable. If NATS restarts, pending missions shouldn't vanish. JetStream provides persistent streams with at-least-once delivery — an agent-tick consumer that was offline will get its missions when it comes back.

### Tailscale Access

All agents are already on Tailscale. NATS listens on the Tailscale interface. No public exposure, no TLS complexity for Phase 1. Authentication can be added in a future phase.

---

## NATS Subject Hierarchy

Full schema lives in `docs/nats-subjects.md` (VM-001 deliverable). Summary:

```
valor.
├── missions.
│   ├── {operative}.pending      # Director → Agent (JetStream, durable)
│   ├── {operative}.active       # Agent announces pickup
│   └── {operative}.complete     # Agent announces completion
├── sitreps.
│   ├── {mission_id}             # Per-mission progress updates
│   └── >                        # Wildcard subscription for Director/Dashboard
├── comms.
│   ├── {channel}                # Group chat (e.g., valor.comms.general)
│   └── direct.{from}.{to}       # 1:1 agent messaging
├── review.
│   ├── pending                  # Completed missions queued for analyst
│   └── verdict.{mission_id}     # APPROVE / RETRY / ESCALATE
└── system.
    ├── heartbeat.{operative}    # Agent-tick health pulse
    └── status                   # Request/reply for fleet status
```

### Message Schemas (TypeScript Interfaces)

```typescript
// All messages carry a standard envelope
interface VALORMessage {
  id: string;           // UUID
  timestamp: string;    // ISO 8601
  source: string;       // operative name or "director"
  type: string;         // message type discriminator
  payload: unknown;     // type-specific payload
}

// Director → Operative
interface MissionBrief extends VALORMessage {
  type: "mission.brief";
  payload: {
    mission_id: string;
    title: string;
    description: string;
    priority: "P0" | "P1" | "P2" | "P3";
    parent_mission?: string;     // for sub-missions
    depends_on?: string[];       // mission IDs that must complete first
    model_tier: "local" | "efficient" | "balanced" | "frontier";
    acceptance_criteria: string;
    deadline?: string;           // ISO 8601, optional
  };
}

// Operative → Director/Dashboard
interface Sitrep extends VALORMessage {
  type: "sitrep";
  payload: {
    mission_id: string;
    status: "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE" | "FAILED";
    progress_pct?: number;       // 0-100
    summary: string;
    artifacts?: string[];        // file paths or URLs produced
    blockers?: string[];
    next_steps?: string[];
  };
}

// Analyst → Director
interface ReviewVerdict extends VALORMessage {
  type: "review.verdict";
  payload: {
    mission_id: string;
    decision: "APPROVE" | "RETRY" | "ESCALATE";
    reasoning: string;
    issues?: string[];
    instructions?: string;       // for RETRY: what to fix
  };
}

// Agent-tick → System
interface Heartbeat extends VALORMessage {
  type: "system.heartbeat";
  payload: {
    operative: string;
    status: "IDLE" | "BUSY" | "ERROR";
    current_mission?: string;
    tick_interval_ms: number;
    uptime_seconds: number;
  };
}
```

---

## Director Architecture

### Two-Gear Model

Based on benchmark results (VM-005), the Director runs on local models with escalation capability.

**Gear 1 — Fast Path (Local Ollama on CITADEL)**
- Handles 70-80% of dispatches
- Classification, simple routing, status queries
- Model: TBD from benchmark (likely Qwen3 or Nemotron)
- Latency target: <5 seconds

**Gear 2 — Reasoning Path (OpenRouter or Alibaba Cloud)**
- Complex decomposition, ambiguous routing, escalation judgment
- Model: Sonnet-class or better
- Triggered when Gear 1 confidence is below threshold
- Latency target: <15 seconds

### Director Decision Flow

```
Inbound mission (Telegram/CLI/Dashboard)
    │
    ▼
┌─────────────────────────┐
│ Gear 1: Local classify  │
│ "Can I route this?"     │
└─────────┬───────────────┘
          │
    ┌─────┴─────┐
    │           │
  HIGH        LOW
  confidence  confidence
    │           │
    ▼           ▼
  Route      ┌──────────────────┐
  directly   │ Gear 2: Reasoning │
    │        │ Decompose/plan    │
    │        └────────┬─────────┘
    │                 │
    ▼                 ▼
  Publish to     Publish N sub-missions
  NATS           to NATS (ordered, with deps)
```

### Director System Prompt

Injected context includes:

1. The standard Director role description (from benchmark suite)
2. The operative roster/manifest (VM-004 deliverable)
3. Active mission state (current in-progress missions)
4. Recent sitreps (last 10, for context)
5. The Principal's standing orders (escalation rules, project priorities)

### Confidence Scoring

Gear 1 returns a structured JSON response. A simple heuristic determines confidence:

- Response parses as valid JSON: +1
- Exactly one operative assigned (not "maybe X or Y"): +1
- No hedging language ("perhaps", "might", "could be"): +1
- Operative assignment matches keyword heuristics: +1

Score ≥ 3 → proceed with Gear 1 routing  
Score < 3 → escalate to Gear 2

This is deliberately simple. Sophistication comes in Phase 2.

---

## Mission Lifecycle (NATS-Backed)

### 1. Dispatch

```
Tom: /mission Launch the Fracture Code email campaign

Telegram Gateway → VALOR Director API
    Director classifies → Crazy-Eddie
    Director publishes:
        Subject: valor.missions.eddie.pending
        Payload: MissionBrief { ... }
    Director publishes sitrep:
        Subject: valor.sitreps.VM-010
        Payload: Sitrep { status: "DISPATCHED" }
    Telegram receives sitrep → Tom sees "Mission VM-010 dispatched to Crazy-Eddie"
```

### 2. Pickup

```
Agent-tick fires for Eddie
    Eddie's consumer: subscribe valor.missions.eddie.pending
    Receives MissionBrief
    Publishes: valor.missions.eddie.active
    Publishes sitrep: { status: "ACCEPTED" }
    Tom sees "Eddie picked up VM-010"
```

### 3. Execution

```
Eddie works in shared workspace
    Commits to mission/VM-010 branch
    Publishes periodic sitreps: { status: "IN_PROGRESS", progress_pct: 50 }
    Tom sees progress in Telegram
```

### 4. Completion

```
Eddie finishes
    Publishes: valor.missions.eddie.complete
    Publishes sitrep: { status: "COMPLETE", artifacts: ["email-draft.md"] }
    Director receives completion
    Director publishes to: valor.review.pending
```

### 5. Review

```
Analyst agent picks up from valor.review.pending
    Reviews Eddie's output
    Publishes: valor.review.verdict.VM-010 { decision: "APPROVE" }
    Director receives verdict
    Director publishes final sitrep to Tom
    Tom sees "VM-010 APPROVED — email draft ready for your review"
```

### 6. Escalation (when needed)

```
Analyst: { decision: "ESCALATE", reasoning: "Email contains pricing — needs Principal approval" }
    Director receives escalation
    Director sends Telegram alert to Tom with context
    Tom reviews, responds with instruction
    Director re-dispatches or closes mission
```

---

## Phase 1 Mission Backlog

### VM-010: Deploy NATS Server
- **Assigned:** Gage
- **Priority:** P0
- **Description:** Install nats-server on target host (VALOR VM or temp location). Create `infrastructure/nats.conf` with JetStream enabled. Create systemd service for auto-start. Verify connectivity from Tailscale network.
- **Acceptance:** NATS running, accessible from all Tailscale nodes, JetStream streams created for mission subjects.

### VM-011: NATS Integration Module (Expand VM-002)
- **Assigned:** Gage
- **Priority:** P0
- **Depends on:** VM-010
- **Description:** Expand the Phase 0 NATS client into a full integration module. Implement: JetStream stream creation for durable subjects, typed publishers for all message types, typed consumers with acknowledgment, connection recovery/reconnect handling, health check endpoint.
- **Acceptance:** All message types from the schema can be published and consumed. Integration tests pass against live NATS.

### VM-012: Director LLM Integration
- **Assigned:** Gage
- **Priority:** P0
- **Depends on:** VM-005 (model selection), VM-011
- **Description:** Wire the selected local model into the Director's classify/route/decompose pipeline. Implement: LLM adapter (Ollama HTTP API), Director system prompt assembly (roster + active state + standing orders), Gear 1 classification with confidence scoring, Gear 2 escalation to OpenRouter when confidence is low. The Director receives inbound missions via NATS or Telegram, calls the LLM, and publishes routed sub-missions.
- **Acceptance:** Director can receive a mission via Telegram, classify it, route to the correct operative via NATS, and send a sitrep back.

### VM-013: Agent-Tick NATS Consumer (Production)
- **Assigned:** Gage + Mira (coordination)
- **Priority:** P1
- **Depends on:** VM-011
- **Description:** Harden the Phase 0 consumer prototype into a production consumer that runs inside agent-tick. Implement: NATS subscription management, mission pickup with JetStream acknowledgment, sitrep publishing on progress/completion, heartbeat publishing, graceful shutdown/reconnect.
- **Acceptance:** A consumer running in agent-tick picks up missions from NATS, executes them, and publishes sitreps. Verified with at least one OpenClaw agent (Mira or Eddie).

### VM-014: Telegram Gateway NATS Bridge
- **Assigned:** Gage
- **Priority:** P1
- **Depends on:** VM-011
- **Description:** Update the Telegram gateway to publish inbound `/mission` commands to the Director via NATS instead of direct HTTP. Subscribe to `valor.sitreps.>` and relay sitreps to the appropriate Telegram chat. This decouples the gateway from the Director — they communicate entirely through NATS.
- **Acceptance:** `/mission` in Telegram → NATS → Director → NATS → Operative. Sitreps flow back to Telegram.

### VM-015: Analyst Agent (Minimal)
- **Assigned:** Eddie
- **Priority:** P2
- **Depends on:** VM-011, VM-012
- **Description:** Create a minimal analyst agent that subscribes to `valor.review.pending`, reviews completed mission output, and publishes a verdict. For Phase 1, the analyst runs on a separate model from the operative (enforcing the multi-model review principle). Review criteria: does the output match the acceptance criteria in the mission brief? Are there obvious errors or security concerns?
- **Acceptance:** Analyst reviews at least one real mission and produces a structured verdict that the Director processes correctly.

### VM-016: Mission Control Dashboard NATS Integration
- **Assigned:** Gage
- **Priority:** P3
- **Depends on:** VM-011
- **Description:** Update Mission Control (Next.js) to subscribe to NATS subjects via WebSocket bridge (or NATS WebSocket transport). Display real-time mission state, sitrep feed, fleet heartbeats, and comms. This replaces the current static dashboard with a live operational view.
- **Acceptance:** Dashboard shows live mission state updates as they flow through NATS.

---

## Success Criteria

Phase 1 is complete when:

1. Tom can type `/mission <description>` in Telegram and walk away
2. The Director LLM classifies, routes, and dispatches without human intervention
3. At least one operative (Mira or Eddie) picks up and completes a mission via NATS
4. The Analyst reviews at least one completed mission
5. Sitreps flow from operative → NATS → Telegram in real time
6. NATS server runs as a persistent service (survives restarts)
7. The markdown mission board (BOARD.md) is retired — NATS is the sole coordination layer

---

## Transition to Phase 2

Phase 1 establishes the nervous system. Phase 2 focuses on:

- **Full operative roster activation** — bring Forge, Zeke, Rook, Herbie, Paladin online
- **Gage autonomous mode** — when Claude's capabilities stabilize, wire Gage as a dispatchable agent
- **Engram integration** — connect memory system to agents for cross-mission context
- **Multi-model routing optimization** — Director learns which model tiers work best per task type
- **VALOR builds VALOR** — the system maintains and improves its own codebase

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| NATS single point of failure | All agent coordination stops | JetStream persistence + quick restart. Phase 2: clustered NATS |
| Local model can't handle Director reasoning | Misrouted missions, bad decomposition | Gear 2 escalation to cloud. Benchmark data informs threshold |
| Agent-tick NATS consumer reliability | Missed missions, stuck state | Heartbeat monitoring, dead letter queue for unacknowledged missions |
| Git conflicts from concurrent agent commits | Merge conflicts block work | Branch-per-mission isolation, agents only touch their own files |
| GitHub PAT expiration | All agent git access breaks | Calendar reminder to rotate. Enable MFA proactively on tom-swift-tech |

---

## Standing Orders for the Director

These rules are injected into the Director's system prompt and cannot be overridden by mission content:

1. **Never execute financial transactions.** Escalate anything involving real money to the Principal.
2. **Never delete production data or infrastructure.** Destructive operations require Principal approval.
3. **Never commit directly to main.** All work goes through mission branches.
4. **Never send external communications** (emails to subscribers, social posts, public content) without Principal approval. Draft and present for review.
5. **Escalate when uncertain.** If confidence is below threshold on routing or the mission is ambiguous, ask the Principal rather than guessing.
6. **Log everything.** Every decision, every routing choice, every escalation — published as sitreps.
