# Phase 2 -- Dependency & Overlap Analysis

> Generated: 2026-03-05 | Input: `docs/01-DISCOVERY.md`

> **Scope Note (added 2026-03-20):** This analysis references Conduit and Herd as components found in the repo at analysis time, and uses agent names from the original deployment (Mira, Gage, etc.) as examples. VALOR is framework-agnostic — users define their own roster. Conduit/Herd are separate SIT projects, NOT dependencies. See `CLAUDE.md` Scope Boundary section.

---

## Table of Contents

1. [Dependency Matrix](#dependency-matrix)
2. [Shared Patterns](#shared-patterns)
3. [Redundant Implementations](#redundant-implementations)
4. [Implicit Dependencies](#implicit-dependencies)
5. [Interface Mismatches](#interface-mismatches)
6. [Tech Stack Conflicts](#tech-stack-conflicts)
7. [Shared Infrastructure Needs](#shared-infrastructure-needs)
8. [Integration Surface Area](#integration-surface-area)

---

## Dependency Matrix

Shows which components depend on or interact with other components.

| Component | Depends On | Depended On By | Integration Type |
|-----------|-----------|----------------|------------------|
| **conduit** | Claude Code CLI (external) | None currently; VALOR engine will consume | REST/WS API |
| **herd** | Ollama nodes (external) | None currently; VALOR engine will consume | HTTP proxy |
| **soulsmith** | Anthropic API (external) | gage-mem (output format); analyst/planner (output format) | CLI output -> file consumption |
| **valor (v1)** | Anthropic API, MCP SDK, OpenClaw (Mira) | Mission Control (v1 dashboard), Telegram Gateway | REST, WS, MCP, VCP |
| **valor-v3** | Anthropic API, OpenAI API | Dashboard (embedded) | In-process, REST |
| **switchboard** | OpenClaw workspace (Mira's filesystem) | None | File I/O |
| **mission-control** | OpenClaw workspace, Convex (optional) | None | File I/O, REST |
| **analyst-workspace** | OpenClaw runtime | Planner (downstream handoff) | OpenClaw webhooks |
| **planner-workspace** | OpenClaw runtime | Analyst (upstream handoff) | OpenClaw webhooks |
| **gage-mem** | OpenClaw runtime (target) | None (awaiting activation) | File-based config |
| **SSOP v2.3** | None (specification) | Soulsmith, gage-mem, all persona configs | Conceptual standard |
| **VectorOS Spec** | None (specification) | VALOR engine (future decision layer) | Unbuilt spec |

### Dependency Graph

```
                    ┌──────────────┐
                    │  SSOP v2.3   │ (specification standard)
                    └──────┬───────┘
                           │ defines format
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌───────────┐   ┌───────────┐   ┌─────────────────┐
    │ Soulsmith │   │ gage-mem  │   │ analyst/planner  │
    │ (extract) │   │ (persona) │   │ (operative cfg)  │
    └─────┬─────┘   └───────────┘   └─────────┬───────┘
          │ produces                           │ runs on
          ▼                                    ▼
    ┌──────────────────┐               ┌──────────────┐
    │ OpenClaw Format  │               │   OpenClaw   │ (external runtime)
    │ (SOUL/USER/MEM)  │               │   Runtime    │
    └──────────────────┘               └──────┬───────┘
                                              │ filesystem
                              ┌───────────────┼──────────────┐
                              ▼               ▼              ▼
                       ┌────────────┐  ┌────────────┐  ┌───────────────┐
                       │ Switchboard│  │  Mission    │  │ VALOR v1      │
                       │ (dashboard)│  │  Control    │  │ (Director+MCP)│
                       └────────────┘  └────────────┘  └───────┬───────┘
                                                               │
                    ┌──────────────────────────────────────────┤
                    ▼                                          ▼
             ┌────────────┐                           ┌──────────────┐
             │ Telegram   │                           │ VALOR v1     │
             │ Gateway    │                           │ Dashboard    │
             └────────────┘                           └──────────────┘

    ┌────────────┐    ┌───────────┐
    │  Conduit   │    │   Herd    │
    │ (cloud gw) │    │ (local gw)│
    └────────────┘    └───────────┘
    (independent)     (independent)

    ┌────────────┐
    │ VALOR v3   │ (self-contained with embedded dashboard)
    └────────────┘
    (independent)
```

**Key observation:** Conduit, Herd, and VALOR v3 are currently **fully independent** -- they share no runtime dependencies with each other or with VALOR v1. The unified engine must bridge them.

---

## Shared Patterns

### 1. Structured JSON Logging

| Component | Implementation | Format |
|-----------|---------------|--------|
| conduit | Custom `logger.ts` | Structured JSON with levels |
| valor v1 | Custom `Logger` class | JSON with timestamps, context |
| valor-v3 | Custom `logger.ts` | Structured JSON to files |
| herd | `tracing` crate | Structured with Prometheus export |
| soulsmith | Custom `logger.ts` | Verbose-flag-aware |
| switchboard | Fastify built-in | Default Fastify JSON |

**Verdict:** Every component implements its own logger. All produce structured JSON but with different field schemas, levels, and output targets. The unified engine needs a shared logging contract.

### 2. Health Check Endpoints

| Component | Route | Returns |
|-----------|-------|---------|
| conduit | `GET /api/health` | Uptime, memory, DB status, active sessions |
| herd | `GET /health` | Simple 200 OK (K8s probe) |
| valor v1 | `GET /health` | Basic health |
| valor v1 | `GET /status` | Fleet status (all operatives, missions) |
| valor-v3 | Dashboard `/api/projects/[id]/health` | Health score per project |
| switchboard | `GET /api/health` | Ollama status, disk %, memory, uptime |
| mission-control | `GET /api/health` | Server uptime, memory |

**Verdict:** Health endpoints exist everywhere but report different data shapes. The engine needs a unified health contract that aggregates component health into a system-wide view.

### 3. WebSocket Real-Time Updates

| Component | Endpoint | Protocol | Events |
|-----------|----------|----------|--------|
| conduit | `/api/sessions/:id/ws` | JSON (action/event) | Session messages, tool results, errors |
| valor v1 | `ws://localhost:3000/ws/sitreps` | JSON | VCP sitreps, mission updates |
| switchboard | `/ws` | JSON (type field) | task:created, task:updated, task:deleted |
| mission-control | Convex subscriptions | Convex wire protocol | Activities, tasks, calendar |

**Verdict:** Four different WebSocket implementations with four different message schemas. The unified engine needs a typed event envelope that all components emit and consume.

### 4. Permission / Authorization Models

| Component | Approach | Authentication |
|-----------|----------|---------------|
| conduit | Default-allow with deny rules, audit log | None (local-only) |
| valor v1 | Bearer token + `X-VALOR-Signature`, rate limiting | Token-based |
| valor-v3 | None (internal process) | None |
| herd | None | None |
| switchboard | None | None |
| mission-control | None | None |

**Verdict:** Only VALOR v1 has real authentication. All others assume trusted local networks. The engine needs a unified auth layer, especially for the dashboard and admin APIs.

### 5. Configuration Patterns

| Component | Config Source | Format |
|-----------|-------------|--------|
| conduit | Environment variables | Sensible defaults, no config file |
| herd | `herd.yaml` + CLI flags | YAML with CLI override |
| soulsmith | `.soulsmithrc` + env + CLI flags | Cosmiconfig (multi-source) |
| valor v1 | `.env` (180+ vars) + YAML operatives | Dotenv + YAML |
| valor-v3 | `.env` + JSON project configs | Dotenv + JSON |
| switchboard | Hardcoded paths | None (hardcoded) |
| mission-control | `NEXT_PUBLIC_*` env vars | Next.js conventions |

**Verdict:** Config approaches range from sophisticated (Soulsmith's cosmiconfig stack) to hardcoded paths (Switchboard). The engine should adopt env vars + optional config file, similar to Conduit or VALOR v1.

### 6. Error Handling Patterns

| Component | Approach |
|-----------|----------|
| conduit | Typed error categories, structured logging, HTTP error envelopes |
| herd | `anyhow::Result<T>` + `thiserror` (Rust idioms) |
| soulsmith | Custom `SoulsmithError` class with `userMessage` + `suggestion` fields |
| valor v1 | Custom errors, OATH violation routing, conversation loop retries |
| valor-v3 | Custom error types, Zod validation errors, retry with backoff |
| switchboard | Silent failures in some routes |
| mission-control | Mock data fallback on errors |

**Verdict:** Error handling quality varies. Conduit, Soulsmith, and VALOR v3 have the best patterns. Switchboard and Mission Control need hardening. The engine should adopt typed error categories with recovery strategies.

---

## Redundant Implementations

### A. Orchestration Engines: VALOR v1 vs VALOR v3

This is the **primary redundancy** in the repository. Two complete engines solving the same core problem with different approaches:

| Aspect | VALOR v1 | VALOR v3 |
|--------|----------|----------|
| **Architecture** | Director pattern (central Express server routing intents) | Orchestrator pattern (cycle-driven Handler->Operative->Analyst loop) |
| **Communication** | VCP protocol (typed message envelopes), MCP (11 tool servers via stdio), WebSocket (sitreps), Telegram | In-process method calls, file I/O, REST dashboard |
| **State** | In-memory + JSON + MCP session-store | JSON files with file-based locking + Zod validation |
| **Governance** | OathValidator (Layer 0 constitutional), intent classification | 8 control gates (state, AAR, convergence, revision, health, artifact, budget, concurrency) |
| **Agent Model** | Named operatives (Mira/Scout/Forge/Sentinel/Zeke), intent-routed dispatch | Stateless agents (Handler/Operative/Analyst), role-based execution |
| **Approval** | Implicit in OathValidator escalation | Explicit approval queue with 4 checkpoint types |
| **Cost Tracking** | None | Full budget gates, per-mission cost estimation, model fallback |
| **Peer Review** | None | AAR pipeline with independent Analyst review |
| **Tooling** | MCP tool servers (59+ tools) | Tool policy in mission briefs (abstract, no MCP) |

**Recommendation:** Neither is strictly superior. The unified engine should combine:
- **From v1:** VCP protocol, MCP tool integration, named operative roster, Telegram gateway, intent classification
- **From v3:** Control gates, AAR pipeline, cost tracking, health scoring, budget enforcement, approval queue, Zod schema discipline

### B. Dashboards: Switchboard vs Mission Control vs VALOR v3 Dashboard

Three dashboards solving overlapping problems:

| Aspect | Switchboard | Mission Control | VALOR v3 Dashboard |
|--------|-------------|-----------------|-------------------|
| **Focus** | Agent ops (Kanban, Soul editor) | Broad ops (agents, content, comms, revenue) | Mission ops (DAG, AAR, approvals) |
| **Backend** | Fastify + file I/O | Next.js + Convex + file I/O | Next.js + file I/O |
| **Real-time** | WebSocket (basic) | Convex subscriptions / polling | HTTP polling |
| **Agent editing** | Yes (SOUL.md, MEMORY.md) | Yes (agent detail page) | No |
| **Task management** | Kanban drag-and-drop | Approve/reject tasks | Mission DAG + approval cards |
| **Unique features** | Model switching, skill viewer, app discovery | Revenue tracking, CRM, knowledge search | Budget breakdown, health trends, chronicle |

**Recommendation:** Merge into a single dashboard. Take:
- **From Switchboard:** SOUL/Memory editor (CodeMirror), model switching, skill viewer, Kanban UX
- **From Mission Control:** Broader ops visibility (revenue, comms, knowledge), Convex optional backend, graceful degradation
- **From v3 Dashboard:** Mission DAG visualization, AAR panels, approval queue, budget/health metrics

**Strongest base to evolve from:** VALOR v3 Dashboard (Next.js 15, React 19, most aligned with engine needs), augmented with Switchboard's agent editing and Mission Control's breadth.

### C. Provider Abstractions

| Component | What It Abstracts | Implementation |
|-----------|------------------|----------------|
| conduit | Claude Code CLI sessions | REST/WS API wrapping CLI spawning |
| herd | Ollama inference nodes | HTTP proxy with routing strategies |
| valor v1 | Anthropic API (direct SDK), Ollama (planned) | `@anthropic-ai/sdk` in conversation loop |
| valor-v3 | Anthropic + OpenAI | `Provider` interface with adapters + rate limiting |
| soulsmith | LLM for extraction | `LLMProvider` interface (only Anthropic implemented) |

**Recommendation:** Conduit and Herd are complementary (cloud vs local), not redundant. VALOR v3's `Provider` interface is the best abstraction to unify them under. Soulsmith's `LLMProvider` can be adapted to use the same interface.

---

## Implicit Dependencies

### 1. OpenClaw as Universal Runtime

Switchboard, Mission Control, analyst-workspace, and planner-workspace all **implicitly depend on OpenClaw** being installed and running with a specific workspace directory structure (`~/.openclaw/workspace/`). VALOR v1 depends on OpenClaw for Mira's runtime.

**Risk:** If OpenClaw's workspace structure changes, these components break silently. The engine should abstract workspace access through a provider gateway, not direct filesystem reads.

### 2. Soulsmith Output -> Agent Consumption

Soulsmith generates OpenClaw-format files (SOUL.md, USER.md, IDENTITY.md, MEMORY.md). The agent workspaces (analyst, planner) and gage-mem consume this format. There is no schema validation at the boundary -- it's convention-based.

**Risk:** If Soulsmith's output format drifts from what agents expect, bootstrapping fails silently. The engine should define a typed persona schema that both Soulsmith and agent loaders validate against.

### 3. VALOR v1 Mission Control Dependency

VALOR v1's Director expects Mission Control to be running on port 3000 for WebSocket sitrep delivery. If Mission Control is down, sitreps are lost (no queue, no retry).

**Risk:** Lost observability during dashboard outages. The engine should buffer events and replay on reconnection.

### 4. Telegram Gateway -> Director Coupling

The Telegram gateway (in VALOR v1) makes HTTP POSTs to the Director on port 3001. It's tightly coupled -- hardcoded URLs, no service discovery.

**Risk:** Port/host changes break Telegram. The engine should use service registration or configuration-based discovery.

### 5. Herd Assumes gpu-hot Companion Service

Herd's model discovery queries a `gpu_hot_url` endpoint per backend for GPU metrics. This assumes a companion `gpu-hot` service running alongside each Ollama node.

**Risk:** If gpu-hot isn't deployed, GPU metrics silently degrade to unavailable. Herd handles this gracefully (optional), but the engine should surface this as a known dependency in health reporting.

---

## Interface Mismatches

### 1. Message Envelope Incompatibility

The two VALOR engines use fundamentally different message contracts:

| Engine | Envelope | Key Fields |
|--------|----------|-----------|
| VALOR v1 | VCP 1.1.0 | `vcp`, `type`, `from`, `to`, `conversation_id`, `oath_verified`, `content` |
| VALOR v3 | None (in-process) | Method parameters, JSON state files |

**Impact:** If both engines need to coexist during migration, there's no shared message format. The unified engine must adopt VCP (or evolve it) as the canonical envelope.

### 2. Session Model Divergence

| Component | Session Concept |
|-----------|----------------|
| conduit | Project -> Session (CLI process with message history, costs, permissions) |
| valor v1 | Director Session (chat history, operative context, MCP tools) |
| valor-v3 | Project -> Mission (no "session" abstraction; state is per-project) |

**Impact:** "Session" means different things in each component. The engine needs clear separation: **conversation session** (chat context) vs **mission execution** (project lifecycle) vs **CLI session** (Conduit process).

### 3. Task / Mission Terminology Mismatch

| Component | Unit of Work | Lifecycle |
|-----------|-------------|-----------|
| switchboard | Task (Kanban card) | backlog -> to-do -> in-progress -> done |
| mission-control | Suggested Task | pending -> approved -> rejected -> completed |
| valor v1 | Mission (dispatched to operative) | dispatched -> executing -> complete/failed |
| valor-v3 | Mission (in project DAG) | planned -> ready -> in_progress -> review -> complete/failed/blocked |

**Impact:** Four different task/mission lifecycles. The engine must define a single `MissionLifecycle` state machine that subsumes all of these.

### 4. Agent Identity Models

| Component | Agent Identity |
|-----------|---------------|
| gage-mem | Self-authored SOUL.md (SSOP v2.3 framework) |
| analyst/planner | Template-based SOUL.md (simpler, role-specific) |
| valor v1 | YAML operative definitions (identity, personality, domains, capabilities, runtime) |
| valor-v3 | JSON agent profiles (handler, developer, researcher, reviewer) |
| soulsmith | Outputs OpenClaw format (SOUL.md + USER.md + IDENTITY.md + MEMORY.md) |

**Impact:** Agent identity is defined in at least 3 different formats. The engine needs a canonical agent identity schema that maps to/from each format.

---

## Tech Stack Conflicts

### 1. Rust (Herd) vs TypeScript (Everything Else)

Herd is the only Rust component. Every other component is TypeScript/Node.js. This creates:
- **Build toolchain divergence** -- Cargo vs npm
- **Deployment complexity** -- Separate Docker images, can't share Node.js process
- **Type sharing impossibility** -- No direct type imports between Rust and TS

**Mitigation:** Herd communicates via HTTP. The engine can consume it as an external service through a TypeScript client wrapper. No code sharing needed -- just API contract alignment.

### 2. Express (VALOR v1) vs Hono (Conduit) vs Fastify (Switchboard) vs Next.js (Mission Control, VALOR v3 Dashboard)

Four different HTTP frameworks across components. For the unified engine:
- **Express** is the most widely used and has the largest middleware ecosystem
- **Hono** is fastest and lightest, best for the API server
- **Fastify** is in between (only used by Switchboard)
- **Next.js** is appropriate for the dashboard but heavy for API-only services

**Recommendation:** Standardize on **Hono** for the core engine API (it's what Conduit already uses, and it's the most aligned with "lean dependencies"). Keep **Next.js** for the dashboard. Migrate away from Express and Fastify.

### 3. SQLite (Conduit) vs JSON Files (VALOR v3) vs Convex (Mission Control)

Three different persistence strategies:
- **SQLite** (Conduit) -- Best for the engine: structured, queryable, WAL mode, single-file
- **JSON files** (VALOR v3) -- Simple but fragile, requires file locking, no query capability
- **Convex** (Mission Control) -- Cloud-dependent, requires external service

**Recommendation:** Standardize on **SQLite** (via better-sqlite3) for the core engine. It's already proven in Conduit, supports WAL for concurrent reads, and can serve as the transaction log / WAL for conversations that CLAUDE.md requires.

### 4. Zod (Multiple) vs No Validation (Switchboard, Mission Control)

| Component | Validation |
|-----------|-----------|
| soulsmith | Zod throughout (types derived from schemas) |
| valor-v3 | Zod throughout (SSoT for all types) |
| conduit | No Zod (TypeScript interfaces only) |
| valor v1 | Zod for some schemas |
| switchboard | TypeScript interfaces, no runtime validation |
| mission-control | TypeScript interfaces, no runtime validation |

**Recommendation:** Standardize on **Zod** as the single source of truth for all types. VALOR v3 and Soulsmith demonstrate the pattern well.

---

## Shared Infrastructure Needs

Components that multiple components need independently but each implement (or fail to implement) on their own:

### 1. Event Bus / Message Broker

| Need | Who Needs It |
|------|-------------|
| Internal event routing | conduit (EventBus), valor v1 (WebSocket), switchboard (WS broadcast) |
| External event notification | valor v1 (Telegram, sitreps), valor-v3 (Telegram notifications) |
| Cross-component events | All components (none currently support this) |

**Required:** A typed event bus with subscription, replay, and guaranteed delivery.

### 2. Authentication & Authorization

| Need | Who Needs It |
|------|-------------|
| API authentication | All HTTP-exposed services |
| Agent identity verification | Engine core (prevent operative spoofing) |
| Division-level access control | Engine core (Black Division state isolation) |

**Required:** A shared auth middleware that all services use. Bearer tokens minimum; signed messages for agent-to-engine communication.

### 3. Typed Error Taxonomy

| Need | Who Needs It |
|------|-------------|
| Categorized errors | All components |
| Recovery strategies per error type | Engine core, provider gateways |
| User-facing error messages | CLI tools, dashboards |

**Required:** A shared error type hierarchy with categories (network, auth, validation, provider, governance, timeout) and recovery strategy hints.

### 4. Audit Logging

| Need | Who Needs It |
|------|-------------|
| Mission dispatch logging | Engine core |
| Permission decisions | Conduit (has it), all others (don't) |
| State mutations | Engine core, provider gateways |
| Agent check-ins | Engine core |

**Required:** An append-only audit log (SQLite table or structured file) with consistent schema across all components.

### 5. Stream Supervision

| Need | Who Needs It |
|------|-------------|
| Heartbeat detection | Engine core -> agents |
| Sequence tracking | Engine core -> provider gateways |
| Typed failure modes | All streaming interactions |
| Automatic recovery | Engine core |

**Required:** A stream supervisor that wraps all provider interactions with heartbeat/timeout/retry logic. This is the **core problem** the engine must solve (per CLAUDE.md: "eliminates silent stream failures").

### 6. Configuration Registry

| Need | Who Needs It |
|------|-------------|
| Centralized config | All components |
| Environment-specific overrides | All deployments |
| Runtime config updates | Admin operations |

**Required:** A unified config loader (env vars + optional file) that all components can import.

---

## Integration Surface Area

### High-Affinity Pairs (Should Be Combined)

| Pair | Affinity | Rationale |
|------|----------|-----------|
| **VALOR v1 + VALOR v3** | Critical | Two engines solving the same problem. Must merge. |
| **Conduit + Herd** | High | Complementary provider gateways (cloud + local) under a unified dispatch interface. |
| **Switchboard + Mission Control + v3 Dashboard** | High | Three dashboards -> one. |
| **analyst-workspace + planner-workspace** | Medium | Same structure, complementary roles. Should be template instances of a generic operative workspace. |

### Clean Integration Points (API Boundaries)

| Component | Exposed API | Consumer |
|-----------|------------|----------|
| Conduit | REST + WS on port 3100 | Engine provider layer (cloud gateway) |
| Herd | HTTP proxy on port 40114 | Engine provider layer (local gateway) |
| Soulsmith | CLI tool (can be called programmatically) | Engine identity layer (persona provisioning) |

### Hard Integration Points (Deep Coupling Required)

| Integration | Difficulty | Reason |
|-------------|-----------|--------|
| VCP protocol + v3 state model | Hard | Different paradigms (message passing vs file state) |
| MCP tool servers + v3 tool policies | Hard | v1 has concrete MCP servers; v3 has abstract tool policies |
| OathValidator + Control Gates | Medium | Different governance models that must be unified |
| Soulsmith output + v1 operative YAML | Medium | Different agent definition formats |

### No Integration Needed

| Component | Reason |
|-----------|--------|
| SSOP v2.3 | Specification only -- informs design, doesn't need code integration |
| VectorOS Spec | Specification only -- the engine implements its own VECTOR layer |

---

## Summary

### Critical Integration Challenges

1. **Engine Unification** -- Merging VALOR v1 and v3 is the highest-risk, highest-value task. The two engines represent different architectural philosophies that must be reconciled.

2. **Dashboard Consolidation** -- Three dashboards must become one. The approach should be additive (start with v3 Dashboard, add features from Switchboard and Mission Control) not reductive.

3. **Message Contract** -- No shared event/message envelope exists. VCP 1.1.0 is the strongest candidate but needs to be adapted for v3's state-driven model.

4. **Provider Unification** -- Conduit and Herd are clean HTTP services that can be consumed through a unified dispatch interface. The v3 `Provider` interface is the right abstraction.

5. **Agent Identity** -- Three different identity formats (SSOP/OpenClaw markdown, YAML operatives, JSON profiles) need a canonical schema. Soulsmith should output this canonical format.

### What's Actually Shared Today

Almost nothing. The components share:
- TypeScript as a language (except Herd)
- General patterns (JSON logging, health endpoints, WebSocket)
- Conceptual alignment (SSOP standard, VALOR philosophy)

But they share zero actual code: no shared npm packages, no common types, no shared utilities. The unified engine must create this shared foundation.

---

*Phase 2 complete. Proceed to Phase 3 -- Integration Architecture.*
