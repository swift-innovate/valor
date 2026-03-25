# Phase 4 -- Gap Analysis

> Generated: 2026-03-05 | Input: `docs/01-DISCOVERY.md`, `docs/02-DEPENDENCIES.md`, `docs/03-ARCHITECTURE.md`

---

## Table of Contents

1. [Use As-Is](#use-as-is)
2. [Needs Rework](#needs-rework)
3. [Build New](#build-new)
4. [Deprecate](#deprecate)

---

## Use As-Is

Components that can be integrated with minimal changes.

### 1. Ollama Protocol Adapter

**What "minimal" means:** The `OllamaAdapter` (~150-200 LOC) implements the `ProviderAdapter` interface by speaking the standard Ollama HTTP protocol. This works with bare Ollama, or any compatible proxy the user chooses to run in front of it.

| Aspect | Status |
|--------|--------|
| HTTP API | Standard Ollama `/api/chat`, `/api/tags` |
| Health check | `/api/tags` for model listing + liveness |
| Streaming | NDJSON stream from `/api/chat?stream=true` |

**Integration work:**
- `OllamaAdapter` wraps standard Ollama HTTP endpoints
- Map Ollama responses to `ProviderResponse` / `StreamEvent`
- Register in `ProviderRegistry` at engine startup

**Note:** This is NOT a dependency on Herd Pro or any other gateway product. It speaks the Ollama protocol.

**Estimated scope:** Small (1-2 days, already implemented)

---

### 2. Soulsmith (Persona Extraction)

**What "minimal" means:** Use as-is for persona extraction via CLI. For programmatic use, import its pipeline functions as a library.

| Aspect | Status |
|--------|--------|
| Extraction pipeline | Works end-to-end (Anthropic) |
| CCF normalizer | All 4 providers supported |
| Output format | OpenClaw-compatible SOUL.md/USER.md/IDENTITY.md/MEMORY.md |
| Zod schemas | Reusable type definitions |

**Integration work:**
- Add a thin adapter that converts Soulsmith output files into `AgentPersona` schema objects
- Register the adapter in the Identity Layer as a persona source
- No changes to Soulsmith source code needed

**Estimated scope:** Small (1 day)

---

### 3. Agent Workspace Templates (analyst-workspace, planner-workspace)

**What "minimal" means:** These are configuration-only (no code). Use them as reference templates for operative provisioning.

| Aspect | Status |
|--------|--------|
| SOUL.md structure | Complete, well-documented |
| Memory patterns | Pre-populated with useful patterns |
| OpenClaw compatibility | Native |

**Integration work:**
- Parse SOUL.md files into `AgentPersona` schema at provisioning time
- Define a "workspace template" concept in the Identity Layer
- No changes to workspace files needed

**Estimated scope:** Small (0.5 days)

---

### 4. gage-mem (Division Lead Persona)

**What "minimal" means:** Use as the reference persona for Gage (Code Division Lead). Load into Identity Layer at division registration.

| Aspect | Status |
|--------|--------|
| SSOP compliance | Full SSOP v2.3 structure |
| VECTOR integration | Embedded in persona |
| Memory architecture | File-based, well-structured |
| Dream cycle | Scripted (scripts/dream.sh) |

**Integration work:**
- Parse SOUL.md + IDENTITY.md + MEMORY.md into `AgentPersona` schema
- Register in persona registry
- Dream cycle becomes a scheduled engine task (not standalone bash)

**Estimated scope:** Small (0.5 days)

---

### 5. SSOP v2.3 Specification

**What "minimal" means:** Already used as the design reference for `AgentPersonaSchema`. No code integration -- it's a specification.

**Integration work:** None. It informed the Identity Layer design in Phase 3.

---

### 6. VectorOS MVP Specification

**What "minimal" means:** Already used as the design reference for `VECTORAnalysisSchema` and `DecisionEngine` interface. The Python/FastAPI spec is not implemented; the engine implements VECTOR natively in TypeScript.

**Integration work:** None. It informed the Decision Layer design in Phase 3.

---

## Needs Rework

Components that have the right idea but need significant modification.

### 1. VALOR v3 Orchestrator -- Core Engine Foundation

**What works:**
- 8 control gates (all implemented and tested)
- Mission lifecycle state management (JSON + Zod + lockfiles)
- Agent dispatch cycle (Handler -> Operative -> Analyst)
- AAR pipeline with peer review
- Cost tracking with budget gates and model fallback
- Health scoring (recency-weighted)
- Approval queue with 4 checkpoint types
- Telegram notifications
- Dashboard with mission DAG, approvals, chronicle
- 30 test files with good coverage

**What needs to change:**
- **State backend migration:** Replace JSON files + lockfiles with SQLite (as per architectural decision). The Zod schemas stay; the I/O layer swaps.
- **Stream supervision addition:** v3 has no stream supervision during operative execution. The engine must wrap operative dispatch with `StreamSupervisor`.
- **Communication protocol:** v3 uses in-process method calls. The engine must emit `EventEnvelope` events through the Communication Bus for cross-component visibility.
- **Division model:** v3 is project-scoped (single project at a time). The engine must support multiple concurrent divisions with namespaced state.
- **MCP tool integration:** v3's tool policies are abstract. The engine must wire in VALOR v1's concrete MCP servers or their equivalents.
- **Provider layer swap:** v3's Provider interface must be generalized to use the unified `ProviderAdapter` (supporting Claude API, Ollama, OpenClaw, and custom runtimes).
- **Gate 9 (OathGate):** Add VALOR v1's OathValidator as a constitutional gate in the gate pipeline.
- **Gate 10 (VECTOR checkpoint):** Add VECTOR analysis as an optional gate for high-stakes missions.

**Estimated scope:** Large (8-12 days)
- SQLite migration: 2-3 days
- Stream supervisor integration: 2-3 days
- EventEnvelope emission: 1-2 days
- Multi-division support: 2-3 days
- MCP integration: 2 days (or defer)

---

### 3. VALOR v1 Director -- Communication & Governance

**What works:**
- VCP 1.1.0 protocol (typed message envelopes)
- MCPToolRouter (11 servers, 59+ tools)
- OathValidator (constitutional governance, Layer 0)
- IntentClassifier (Claude-powered, domain-aware)
- Telegram Gateway (mobile Director interface)
- Session management via MCP session-store
- Named operative roster (Mira, Scout, Forge, Sentinel, Zeke)
- ConversationLoop (agentic execution with tool use)

**What needs to change:**
- **Architecture refactor:** v1's Director is a monolithic Express server. The engine needs its subsystems extracted into composable layers:
  - VCP -> evolves into EventEnvelope (Communication Bus)
  - OathValidator -> becomes Gate 9 (Core Engine)
  - IntentClassifier -> becomes engine middleware
  - MCPToolRouter -> becomes a tool dispatch service
  - Telegram Gateway -> becomes a gateway adapter
- **Session model swap:** v1's in-memory session management must give way to SQLite-backed persistence.
- **Express removal:** The engine uses Hono, not Express. All route handlers must migrate.
- **Operative definitions:** YAML operatives must be converted to `AgentPersona` schema and registered in the Identity Layer.

**Estimated scope:** Large (6-10 days)
- Extract OathValidator as standalone gate: 1 day
- Extract IntentClassifier as middleware: 1 day
- Extract MCPToolRouter: 2 days
- Migrate Telegram Gateway: 1-2 days
- VCP -> EventEnvelope mapping: 1-2 days
- Convert operative YAMLs: 1 day

---

### 4. VALOR v3 Dashboard -- Unified Dashboard

**What works:**
- Next.js 15 + React 19 (modern stack)
- Mission DAG visualization
- AAR panels with grades and action items
- Approval queue with approve/reject actions
- Budget breakdown and health metrics
- Chronicle event feed
- Dark theme, VALOR palette

**What needs to change:**
- **Multi-division view:** Dashboard currently shows one project at a time. Must show all divisions, their leads, and mission pipelines.
- **Agent management:** Add Switchboard's SOUL.md/MEMORY.md editing (CodeMirror), model switching, skill discovery.
- **Broader ops visibility:** Add Mission Control's revenue tracking, CRM, comms, knowledge search.
- **Real-time:** Replace HTTP polling with WebSocket subscription to Communication Bus events.
- **Auth:** Add login/session management (at minimum, Bearer token for API calls).

**Estimated scope:** Large (8-12 days)
- Multi-division view: 2-3 days
- Agent editing (from Switchboard): 2-3 days
- WebSocket integration: 1-2 days
- Ops breadth (from Mission Control): 3-4 days

---

## Build New

Capabilities that don't exist in any current component.

### 1. Stream Supervisor

**What it does:** Wraps every provider interaction with heartbeat detection, sequence tracking, typed failure modes, and automatic recovery. This is the **core problem** the engine must solve.

**Why needed:** CLAUDE.md states: "OpenClaw's orchestration layer fails silently during streaming." No existing component has stream supervision during active LLM execution. VALOR v3's operative dispatch is fire-and-forget. VALOR v1's ConversationLoop has retry but no heartbeat/sequence tracking.

**Architectural layer:** Core Engine

**Estimated scope:** Medium (3-5 days)

**Dependencies:** Provider Layer (must be implemented first -- the supervisor wraps provider streams)

**Key deliverables:**
- `StreamSupervisor` class implementing the interface from Phase 3
- Heartbeat monitor (configurable interval, stale detection)
- Sequence tracker (gap detection, out-of-order handling)
- Recovery strategies: retry, fallback provider, escalate, abort
- Integration with WAL (log stream events for replay/recovery)

---

### 2. Communication Bus (EventBus + Envelope)

**What it does:** The typed event routing backbone. All components publish and subscribe to events using `EventEnvelope` schema. Handles delivery guarantees, replay, and cross-component routing.

**Why needed:** Components currently have no shared communication mechanism. Events are lost between services (e.g., v1 sitreps lost if Mission Control is down).

**Architectural layer:** Communication Bus (Layer 6)

**Estimated scope:** Medium (3-4 days)

**Dependencies:** SQLite (for event persistence and replay). No other dependencies.

**Key deliverables:**
- `EventBus` implementation with pub/sub, pattern matching, replay
- SQLite event store (append-only, indexed by type + timestamp + mission)
- `EventEnvelope` validation (Zod) on publish
- Gateway adapter interface for Telegram, Dashboard, future channels

---

### 3. SQLite State Layer (WAL + Audit)

**What it does:** Central persistence for the engine. All state mutations go through a transaction log. Provides the "single state authority" required by CLAUDE.md.

**Why needed:** Current state is fragmented: v1 uses in-memory + JSON + MCP, v3 uses JSON + lockfiles, Mission Control uses Convex. The engine needs one authority.

**Architectural layer:** Core Engine (persistence) + Memory Layer

**Estimated scope:** Medium (3-4 days)

**Dependencies:** None (SQLite via better-sqlite3 is self-contained)

**Key deliverables:**
- Database schema: missions, agents, divisions, events, decisions, conversations, audit_log
- Migration system (versioned)
- WAL table for all state mutations
- Prepared statement wrappers with Zod validation on read/write
- Industry-standard better-sqlite3 patterns

---

### 4. Division Registry

**What it does:** Manages division registration, lead instantiation, autonomy policies, and escalation rules. Implements the Division schema from Phase 3.

**Why needed:** No existing component models divisions. VALOR v1 has named operatives but no division concept. VALOR v3 has projects but no divisions.

**Architectural layer:** Division Schema (Layer 7)

**Estimated scope:** Medium (2-3 days)

**Dependencies:** SQLite State Layer, Identity Layer

**Key deliverables:**
- `DivisionRegistry` implementation
- Division CRUD with autonomy policies
- Lead status tracking (heartbeat monitoring)
- Operative registration per division
- Mira cross-division access configuration

---

### 5. MCP Server (Agent Communication Layer)

**What it does:** Replaces agent-facing REST polling (`GET /agents/:id/inbox`) with Model Context Protocol. Agents connect via streamable HTTP (SSE), authenticate once per session, and interact through 10 typed MCP tools. The event bus bridges to MCP notifications for server→client push.

**Why needed:** Current agent loop requires repeated HTTP polling with manual `X-VALOR-Role` headers. No tool discovery — agents must be pre-programmed with REST API shape. No synchronous request-response for actions (submit sitrep → poll for result). MCP solves all of these natively.

**Architectural layer:** Communication Bus (Layer 6) — transport extension

**Estimated scope:** Medium (12 days, phased internally over 4 weeks)

**Dependencies:** Core Engine (event bus), Mission Lifecycle (repos), Phase 0 types

**Key deliverables:**
- MCP server mounted on Hono at `/mcp` (SSE transport)
- Session manager with 30-min timeout, implicit heartbeat, reconnection
- 10 MCP tools: check_inbox, accept_mission, submit_sitrep, send_message, get_mission_brief, complete_mission, submit_artifacts, request_escalation, acknowledge_directive, get_status
- Event bus → MCP notification bridge (mission assignments, directives, messages)
- Agent identity resolution replacing X-VALOR-Role headers
- Single new dependency: `@modelcontextprotocol/sdk`

See `docs/06-MCP-INTEGRATION.md` for full tool schemas and migration path.

---

### 6. Memory Layer (Namespaced State)

**What it does:** Per-division isolated state with cross-division read policies and Director-controlled access gates.

**Why needed:** Currently state is either global (v1) or project-scoped (v3). The engine needs namespace isolation (especially for Black Division).

**Architectural layer:** Memory Layer (Layer 4)

**Estimated scope:** Medium (2-3 days)

**Dependencies:** SQLite State Layer, Division Registry

**Key deliverables:**
- `MemoryStore` implementation with namespace isolation
- `ConversationMemory` with context windowing and summarization
- Cross-namespace read authorization
- Full-text search within namespaces

---

### 6. Decision Engine (VECTOR Implementation)

**What it does:** Runs VECTOR analysis on decisions at configurable mission lifecycle points. Persists analyses for meta-pattern detection.

**Why needed:** VECTOR is referenced throughout the project vision but has zero implementation. It's the decision engine inside the orchestration engine.

**Architectural layer:** Decision Layer (Layer 5)

**Estimated scope:** Medium (3-4 days)

**Dependencies:** Provider Layer (needs LLM for analysis), SQLite State Layer, Core Engine gate system

**Key deliverables:**
- `DecisionEngine` implementation
- LLM prompts for each VECTOR stage (adapted from VectorOS spec's system prompt)
- Checkpoint integration with mission lifecycle
- Meta-analysis across historical decisions
- Bias risk scoring and tracking

---

### 7. Persona Registry & Loader

**What it does:** Stores and retrieves agent personas in the canonical `AgentPersona` format. Loaders convert from source formats (SSOP markdown, YAML, JSON profiles).

**Why needed:** Three different persona formats exist. The engine needs a single registry that speaks one schema.

**Architectural layer:** Identity Layer (Layer 3)

**Estimated scope:** Small-Medium (2-3 days)

**Dependencies:** SQLite State Layer

**Key deliverables:**
- `PersonaRegistry` backed by SQLite
- Loaders: SSOP markdown -> AgentPersona, YAML -> AgentPersona, JSON profile -> AgentPersona
- Soulsmith output adapter
- Persona versioning (track changes over time)

---

### 8. Home Assistant Adapter

**What it does:** Enables Zeke (Swift Ranch Lead) to read sensor data, trigger automations, and report ranch status through the engine.

**Why needed:** CLAUDE.md states: "This is not a nice-to-have -- it's how an entire division operates."

**Architectural layer:** Provider Layer

**Estimated scope:** Small-Medium (2-3 days)

**Dependencies:** Provider Layer interface

**Key deliverables:**
- `HomeAssistantAdapter` implementing `ProviderAdapter` (subset -- no LLM completion)
- REST client for HA API (entities, services, automations)
- Event mapping: HA state changes -> StreamEvent
- Sensor data queries for ranch status reporting

---

## Deprecate

Components or patterns that should be left behind.

### 1. Switchboard -- As Standalone Application

**Why deprecate:** Switchboard's functionality (Kanban, Soul editor, health monitoring) will be absorbed into the unified dashboard. Its Fastify backend, hardcoded OpenClaw paths, and single-agent focus make it unsuitable as a standalone service.

**What to preserve:** The CodeMirror editor integration, Kanban drag-and-drop UX patterns, and model switching UI should be extracted and rebuilt in the unified Next.js dashboard.

**What to discard:** The Fastify backend, direct filesystem I/O to OpenClaw paths, and the WebSocket implementation. These are replaced by the engine's API and Communication Bus.

---

### 2. Mission Control (standalone) -- As Standalone Application

**Why deprecate:** Mission Control's Next.js stack overlaps with VALOR v3's dashboard. Its Convex dependency is unnecessary when the engine uses SQLite. Its OpenClaw filesystem coupling is replaced by the engine's API.

**What to preserve:** The broader ops visibility features (revenue tracking, CRM, knowledge search, content pipeline) should be ported as pages/routes in the unified dashboard.

**What to discard:** The Convex backend, direct workspace file I/O, and the custom API routes that duplicate engine functionality.

---

### 3. VALOR v1 Express Server -- As Primary HTTP Layer

**Why deprecate:** The engine standardizes on Hono (lighter, faster). The Express server from VALOR v1 should not be the engine's HTTP layer.

**What to preserve:** All business logic in route handlers (chat, mission, ask, status, scheduler, heartbeat, project, governance). These are extracted into engine handlers.

**What to discard:** The Express app setup, CORS middleware, rate limiting middleware (replaced by Hono equivalents), and the monolithic server.ts.

---

### 4. JSON File Persistence (VALOR v3 Pattern)

**Why deprecate:** JSON files with `proper-lockfile` are fragile, not queryable, and don't support concurrent reads. The engine uses SQLite.

**What to preserve:** The Zod schema discipline (schemas as SSoT, validate on every read/write). This is the most valuable pattern from v3.

**What to discard:** `fs.readFileSync` / `fs.writeFileSync` for state, lockfile acquisition, per-project directory structure for state files.

---

### 5. Convex Backend (Mission Control)

**Why deprecate:** Convex is an external cloud dependency. The engine runs self-hosted with SQLite. Adding a Convex dependency violates the "self-hosted, no heavy frameworks" constraint.

**What to preserve:** The real-time subscription pattern. The engine's Communication Bus + WebSocket provides equivalent real-time capability.

**What to discard:** The Convex schema, mutations, queries, and the `convex/` directory entirely.

---

### 6. In-Memory Session State (VALOR v1 Pattern)

**Why deprecate:** VALOR v1 stores active sessions as in-memory Maps. If the Director process crashes, all session state is lost.

**What to preserve:** The concept of active session tracking for performance. But the authoritative state must be SQLite-backed with in-memory cache.

**What to discard:** Sole reliance on `Map<chatId, SessionAdapter>` without persistence.

---

## Summary

### By Category

| Category | Count | Items |
|----------|-------|-------|
| **Use As-Is** | 6 | Ollama adapter, Soulsmith, analyst-workspace, planner-workspace, gage-mem, specs (SSOP + VectorOS) |
| **Needs Rework** | 3 | VALOR v3 Orchestrator (large), VALOR v1 Director (large), v3 Dashboard (large) |
| **Build New** | 8 | Stream Supervisor, Communication Bus, SQLite State Layer, Division Registry, Memory Layer, Decision Engine, Persona Registry, HA Adapter |
| **Deprecate** | 6 | Switchboard (app), Mission Control (app), v1 Express, JSON files, Convex, in-memory state |

### Effort Estimation

| Category | Estimated Days |
|----------|---------------|
| Use As-Is (adapter wrappers) | ~4 days |
| Needs Rework | ~25-39 days |
| Build New | ~20-29 days |
| **Total** | **~49-72 days** |

This is an ambitious scope. The build plan (Phase 5) will sequence this work to deliver maximum value earliest.

---

*Phase 4 complete. Proceed to Phase 5 -- Build Plan.*
