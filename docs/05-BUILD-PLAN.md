# Phase 5 -- Build Plan

> Generated: 2026-03-05 | Input: All previous phase docs

---

## Table of Contents

1. [Build Philosophy](#build-philosophy)
2. [Phase Map](#phase-map)
3. [Detailed Phase Breakdown](#detailed-phase-breakdown)
4. [Migration Path: Mira](#migration-path-mira)
5. [Rollback Plan](#rollback-plan)
6. [Starter Scaffold](#starter-scaffold)

---

## Build Philosophy

**Sequence by leverage.** Each phase unblocks the most downstream work. The critical path:

1. Foundation (types + state + bus) -- everything depends on this
2. Stream supervision + providers -- solves the core problem (silent failures)
3. Mission lifecycle -- the engine's spine
4. Division model + identity -- multi-agent orchestration
5. Decision layer (VECTOR) -- governance enhancement
6. Dashboard unification -- Director visibility
7. Mira migration -- prove the engine governs a live agent

**Mira continues running on OpenClaw throughout.** The engine wraps her; it doesn't replace her. If any phase fails, the rollback is "Mira keeps running exactly as she does today."

---

## Phase Map

```
Phase 0: Foundation            [~5 days]  ── Unblocks everything
  │
  ├── Phase 1: Stream + Providers  [~5-7 days]  ── Solves core problem
  │     │
  │     └── Phase 2: Mission Lifecycle  [~5-7 days]  ── Engine spine
  │           │
  │           ├── Phase 3: Divisions + Identity  [~5-7 days]  ── Multi-agent
  │           │     │
  │           │     └── Phase 4: VECTOR + Governance  [~4-5 days]  ── Decision layer
  │           │
  │           └── Phase 5: Dashboard  [~8-10 days]  ── Director visibility
  │
  └── Phase 6: Mira Migration  [~5-7 days]  ── Prove it works
                                ──────────
                          Total: ~37-48 days
```

---

## Detailed Phase Breakdown

---

### Phase 0: Foundation

**What gets built:** Shared types, SQLite state layer, Communication Bus, project scaffold.

**What it unblocks:** Every subsequent phase. Nothing can be built without shared types and persistence.

**Estimated effort:** ~5 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **Project scaffold** | `engine/` folder with package.json, tsconfig (strict), Zod, better-sqlite3 | 0.5d |
| **Core type schemas** | All Zod schemas from Phase 3: Mission, StreamEvent, EngineError, WALEntry, EventEnvelope | 1d |
| **SQLite state layer** | Database init, migration system, core tables (missions, agents, divisions, events, audit_log, conversations) | 2d |
| **Communication Bus** | EventBus with pub/sub, pattern matching, SQLite-backed event store, replay | 1.5d |

#### Milestone Test

- `npm test` passes with schema validation tests
- SQLite database initializes with migrations
- EventBus can publish, subscribe, and replay events
- All core types compile with TypeScript strict mode

---

### Phase 1: Stream Supervision + Provider Layer

**What gets built:** StreamSupervisor, ProviderAdapter interface, concrete adapters (Ollama, Claude API), provider registry.

**What it unblocks:** Mission execution (Phase 2 needs providers to dispatch missions).

**Dependencies:** Phase 0 (types, SQLite, EventBus)

**Estimated effort:** ~5-7 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **ProviderAdapter interface** | Abstract interface + ProviderRegistry | 0.5d |
| **DirectClaudeAdapter** | Wraps @anthropic-ai/sdk with streaming | 1d |
| **OllamaAdapter** | HTTP client speaking standard Ollama protocol | 1d |
| **StreamSupervisor** | Heartbeat monitor, sequence tracker, recovery strategies | 2-3d |
| **Provider health checking** | Background health check loop for registered providers | 0.5d |
| **Cost estimator** | Token counting + cost calculation per model (from v3) | 0.5d |

#### Milestone Test

- Stream a response from Claude API through DirectClaudeAdapter
- StreamSupervisor detects a simulated heartbeat timeout
- StreamSupervisor recovers via fallback provider
- Ollama health check returns status via OllamaAdapter
- All stream events are logged to SQLite event store

---

### Phase 2: Mission Lifecycle

**What gets built:** Mission state machine, gate system (10 gates), AAR pipeline, approval queue, orchestrator loop.

**What it unblocks:** Actual mission execution. This is the engine's spine.

**Dependencies:** Phase 0 (types, state), Phase 1 (providers, stream supervisor)

**Estimated effort:** ~5-7 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **Mission state machine** | Status transitions per Phase 3 statechart, validated by Zod | 1d |
| **Gate system** | Gates 1-8 from v3, plus Gate 9 (OathGate from v1), Gate 10 (VECTOR checkpoint placeholder) | 2d |
| **AAR pipeline** | Analyst dispatch, AAR processing, convergence logic (from v3) | 1d |
| **Approval queue** | Checkpoint creation, resolution, expiration (from v3) | 0.5d |
| **Orchestrator loop** | Cycle-driven execution: evaluate gates -> dispatch -> supervise stream -> process AAR | 1-2d |
| **Mission API** | Hono routes: create, list, get, dispatch, approve, reject, abort | 0.5d |

#### Milestone Test

- Create a mission, evaluate all gates, dispatch to DirectClaudeAdapter
- StreamSupervisor monitors execution through completion
- AAR is generated and processed
- Approval checkpoint blocks execution until resolved
- Full lifecycle logged in SQLite WAL

---

### Phase 3: Divisions + Identity

**What gets built:** Division registry, persona registry, lead instantiation, Mira cross-cutting config, autonomy policies.

**What it unblocks:** Multi-division operation. Before this phase, the engine runs single-division.

**Dependencies:** Phase 0 (types, state), Phase 2 (mission lifecycle)

**Estimated effort:** ~5-7 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **Persona registry** | SQLite-backed, loaders for SSOP markdown, YAML, JSON | 2d |
| **Division registry** | Division CRUD, autonomy policies, escalation rules | 1.5d |
| **Lead instantiation** | Persona -> provider -> registration -> heartbeat monitoring | 1d |
| **Mira config** | Cross-division access model, Director proxy behavior | 0.5d |
| **Soulsmith adapter** | Convert Soulsmith output to AgentPersona schema | 0.5d |
| **Operative provisioning** | Template-based operative creation (from analyst/planner workspaces) | 0.5d |

#### Milestone Test

- Register Code Division with Gage as lead
- Load Gage's persona from gage-mem/ into persona registry
- Division autonomy policy controls what Gage can do without approval
- Multiple divisions coexist with isolated namespaces
- Heartbeat monitoring detects lead going offline

---

### Phase 4: VECTOR + Governance

**What gets built:** Decision engine (VECTOR implementation), OATH governance integration, checkpoint integration with mission lifecycle.

**What it unblocks:** Decision quality and governance features. The engine works without this but makes lower-quality decisions.

**Dependencies:** Phase 2 (mission lifecycle for checkpoint integration), Phase 1 (provider for LLM analysis)

**Estimated effort:** ~4-5 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **VECTOR analysis engine** | LLM-powered analysis across 6 stages, strict JSON output | 2d |
| **Bias risk scoring** | 5 bias dimensions scored 0-10 per analysis | 0.5d |
| **Checkpoint integration** | VECTOR runs at configurable mission lifecycle points | 1d |
| **Meta-analysis** | Cross-decision pattern detection (trends, common conflicts) | 0.5d |
| **OathGate (Gate 9)** | Port v1's OathValidator as a gate in the pipeline | 0.5d |
| **Decision persistence** | Store all analyses in SQLite for audit and meta-analysis | 0.5d |

#### Milestone Test

- Submit a decision, get structured VECTOR analysis back
- Bias scores are within expected ranges
- Pre-mission VECTOR checkpoint blocks dispatch until reviewed
- Meta-analysis across 5+ decisions detects patterns
- OathGate blocks a Layer 0 violation

---

### Phase 5: Dashboard Unification

**What gets built:** Unified Mission Control dashboard combining features from VALOR v3 Dashboard, Switchboard, and Mission Control.

**What it unblocks:** Director visibility into multi-division operations.

**Dependencies:** Phase 2 (mission API), Phase 3 (division API). Can be built in parallel with Phase 4.

**Estimated effort:** ~8-10 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **Multi-division overview** | Division cards showing leads, status, active missions, health | 2d |
| **Mission pipeline view** | DAG visualization + status indicators (from v3 Dashboard) | 1d |
| **Approval queue** | Approve/reject cards with VECTOR analysis display | 1d |
| **Agent management** | Persona viewer/editor with CodeMirror (from Switchboard) | 2d |
| **WebSocket integration** | Subscribe to Communication Bus events for real-time updates | 1d |
| **Ops views** | Revenue, CRM, knowledge search (from Mission Control, lower priority) | 2-3d |

#### Milestone Test

- Dashboard shows all divisions with lead status
- Clicking a division shows its mission pipeline
- Approval queue shows pending checkpoints, can approve/reject
- Agent persona editor loads/saves via Identity Layer API
- Real-time updates flow when missions change status

---

### Phase 6: Mira Migration

**What gets built:** OpenClaw adapter, Telegram gateway integration, Mira governed by the engine.

**What it unblocks:** Proves the engine can govern a live agent. This is the validation milestone.

**Dependencies:** Phase 2 (mission lifecycle), Phase 3 (division registry). Phase 4 and 5 are nice-to-have but not required.

**Estimated effort:** ~5-7 days

#### Deliverables

| Item | Description | Est. |
|------|------------|------|
| **OpenClawAdapter** | ProviderAdapter wrapping OpenClaw's webhook API | 2d |
| **Telegram Gateway adapter** | GatewayAdapter wrapping existing Telegram bot (from v1) | 1.5d |
| **Mira registration** | Register Mira as cross-cutting agent in engine | 0.5d |
| **Intent routing** | Director commands via Telegram -> engine -> Mira (from v1 IntentClassifier) | 1d |
| **Stream supervision** | Monitor Mira's responses through OpenClaw with heartbeat | 1d |
| **Acceptance test** | Director sends command via Telegram, engine routes to Mira, monitors stream, reports sitrep | 1d |

#### Milestone Test

- Director sends `/mission` via Telegram
- Engine receives, classifies intent, routes to Mira via OpenClaw
- StreamSupervisor monitors Mira's execution
- Sitrep appears on Dashboard and Telegram
- If Mira's stream stalls, engine detects and escalates (not silent failure)

---

## Migration Path: Mira

Mira is a live agent on OpenClaw (LXC200). The migration must not risk her current operational state.

### Stage 1: Observe (Phase 0-1)

Engine runs alongside Mira. No governance, just monitoring.
- Register Mira in the engine's agent registry (read-only)
- Monitor her OpenClaw health endpoint
- Log observations, build the engine's understanding of her patterns

**Rollback:** Remove engine registration. Mira unaffected.

### Stage 2: Shadow (Phase 2-3)

Engine receives the same inputs Mira receives but doesn't act on them.
- Duplicate Director commands to both OpenClaw (Mira acts) and engine (engine observes)
- Engine classifies intents, evaluates gates, but doesn't dispatch
- Compare engine decisions to Mira's actual behavior

**Rollback:** Stop duplicating commands. Mira unaffected.

### Stage 3: Govern (Phase 6)

Engine becomes the routing authority. Mira still runs on OpenClaw.
- Director commands go to engine first
- Engine classifies, evaluates gates, then dispatches to Mira via OpenClaw
- Engine monitors Mira's stream, tracks health, reports sitreps
- Mira's actual behavior is unchanged -- she just gets her work through a new dispatcher

**Rollback:** Route Director commands directly to OpenClaw again. Mira unaffected.

### Stage 4: Full Integration (Post Phase 6)

Engine is the authority. Mira is a governed operative.
- All communication flows through the engine
- Stream supervision active on all Mira interactions
- Sitreps, health, and audit trail fully operational
- Dashboard shows Mira's status alongside all other Division Leads

**Rollback:** Revert to Stage 3 routing.

---

## Rollback Plan

Every phase has a clear revert point:

| Phase | Rollback Action | Risk to Mira |
|-------|----------------|-------------|
| 0 (Foundation) | Delete `engine/` folder | None -- Mira not touched |
| 1 (Stream + Providers) | Unused adapters. Delete. | None |
| 2 (Mission Lifecycle) | Engine not yet governing anything. Delete. | None |
| 3 (Divisions + Identity) | Registry not yet connected to live agents. Delete. | None |
| 4 (VECTOR) | Decision layer not yet in critical path. Delete. | None |
| 5 (Dashboard) | Old dashboards still work. Delete new. | None |
| 6 (Mira Migration) | Route commands back to OpenClaw directly | **None** -- Mira's config unchanged |

**Key principle:** The engine is additive. It wraps existing systems; it doesn't replace their internals. At any point before Stage 4, removing the engine leaves Mira exactly as she was.

---

## Starter Scaffold

The minimal `engine/` folder structure for Phase 0:

```
engine/
├── package.json                    # TypeScript, Zod, better-sqlite3, Hono, ws
├── tsconfig.json                   # strict: true, ESM, ES2022 target
├── .env.example                    # ANTHROPIC_API_KEY, VALOR_DB_PATH, etc.
│
├── src/
│   ├── index.ts                    # Engine entry point + Hono server startup
│   │
│   ├── types/                      # Zod schemas (SSoT for all types)
│   │   ├── mission.ts              # MissionSchema, MissionStatus
│   │   ├── stream.ts               # StreamEventSchema, StreamHealth
│   │   ├── error.ts                # ErrorCategory, RecoveryStrategy, EngineErrorSchema
│   │   ├── event.ts                # EventEnvelopeSchema
│   │   ├── agent.ts                # AgentPersonaSchema
│   │   ├── division.ts             # DivisionSchema, MiraConfigSchema
│   │   ├── decision.ts             # VECTORAnalysisSchema, DecisionCheckpointSchema
│   │   ├── memory.ts               # ConversationMessageSchema, MemoryEntry
│   │   ├── wal.ts                  # WALEntrySchema
│   │   └── index.ts                # Re-exports all types
│   │
│   ├── db/                         # SQLite persistence layer
│   │   ├── database.ts             # Database init, migrations, connection
│   │   ├── migrations/             # Versioned SQL migration files
│   │   │   └── 001-initial.sql     # Core tables
│   │   ├── repositories/           # CRUD per entity (missions, agents, divisions, etc.)
│   │   │   ├── mission-repo.ts
│   │   │   ├── agent-repo.ts
│   │   │   ├── division-repo.ts
│   │   │   ├── event-repo.ts
│   │   │   └── wal-repo.ts
│   │   └── index.ts
│   │
│   ├── bus/                        # Communication Bus
│   │   ├── event-bus.ts            # Pub/sub with pattern matching + replay
│   │   ├── gateway-adapter.ts      # Gateway adapter interface
│   │   └── index.ts
│   │
│   ├── core/                       # Core engine (Phase 2+)
│   │   ├── engine.ts               # Central orchestrator
│   │   ├── mission-lifecycle.ts    # State machine + transitions
│   │   ├── stream-supervisor.ts    # Heartbeat, sequence, recovery
│   │   ├── failure-router.ts       # Error -> recovery strategy mapping
│   │   └── index.ts
│   │
│   ├── gates/                      # Gate system (Phase 2+)
│   │   ├── gate.ts                 # Gate interface
│   │   ├── mission-state-gate.ts
│   │   ├── aar-gate.ts
│   │   ├── convergence-gate.ts
│   │   ├── revision-cap-gate.ts
│   │   ├── health-gate.ts
│   │   ├── artifact-integrity-gate.ts
│   │   ├── budget-gate.ts
│   │   ├── concurrency-gate.ts
│   │   ├── oath-gate.ts
│   │   ├── vector-checkpoint-gate.ts
│   │   ├── evaluator.ts           # Runs all gates in sequence
│   │   └── index.ts
│   │
│   ├── providers/                  # Provider Layer (Phase 1+)
│   │   ├── adapter.ts             # ProviderAdapter interface
│   │   ├── registry.ts            # ProviderRegistry
│   │   ├── adapters/
│   │   │   ├── direct-claude.ts   # @anthropic-ai/sdk wrapper
│   │   │   ├── ollama.ts          # Standard Ollama HTTP protocol client
│   │   │   ├── openai.ts          # OpenAI-compatible API client (future)
│   │   │   ├── openclaw.ts        # OpenClaw webhook client (Phase 6)
│   │   │   └── home-assistant.ts  # HA REST client (Phase 3+)
│   │   └── index.ts
│   │
│   ├── identity/                   # Identity Layer (Phase 3+)
│   │   ├── persona-registry.ts    # SQLite-backed persona CRUD
│   │   ├── loaders/
│   │   │   ├── ssop-loader.ts     # Parse SOUL.md/IDENTITY.md -> AgentPersona
│   │   │   ├── yaml-loader.ts     # Parse VALOR v1 YAML -> AgentPersona
│   │   │   └── json-loader.ts     # Parse VALOR v3 JSON -> AgentPersona
│   │   └── index.ts
│   │
│   ├── memory/                     # Memory Layer (Phase 3+)
│   │   ├── memory-store.ts        # Namespaced key-value store
│   │   ├── conversation-memory.ts # Context windowing + summarization
│   │   └── index.ts
│   │
│   ├── decision/                   # Decision Layer (Phase 4+)
│   │   ├── vector-engine.ts       # VECTOR analysis implementation
│   │   ├── checkpoint.ts          # Mission checkpoint integration
│   │   ├── meta-analysis.ts       # Cross-decision pattern detection
│   │   └── index.ts
│   │
│   ├── divisions/                  # Division Schema (Phase 3+)
│   │   ├── division-registry.ts   # Division CRUD + policies
│   │   ├── mira-config.ts         # Cross-cutting Mira configuration
│   │   └── index.ts
│   │
│   ├── api/                        # HTTP API (Hono routes)
│   │   ├── app.ts                 # Hono app factory
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── missions.ts
│   │   │   ├── agents.ts
│   │   │   ├── divisions.ts
│   │   │   ├── decisions.ts
│   │   │   ├── events.ts
│   │   │   └── gateway.ts        # Telegram/webhook inbound
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rate-limit.ts
│   │   │   └── validation.ts
│   │   └── index.ts
│   │
│   ├── gateways/                   # External gateways (Phase 6+)
│   │   ├── telegram.ts            # Telegram GatewayAdapter
│   │   ├── dashboard-ws.ts        # WebSocket GatewayAdapter for dashboard
│   │   └── index.ts
│   │
│   └── utils/                      # Shared utilities
│       ├── logger.ts              # Structured JSON logger
│       ├── config.ts              # Environment config loader
│       └── index.ts
│
├── tests/                          # Mirror of src/ with .test.ts files
│   ├── types/
│   ├── db/
│   ├── bus/
│   ├── core/
│   ├── gates/
│   ├── providers/
│   └── integration/
│
└── dashboard/                      # Unified dashboard (Phase 5+)
    ├── app/                       # Next.js 15 app
    └── package.json
```

**File descriptions for Phase 0 (what gets built first):**

| File | What It Contains |
|------|-----------------|
| `src/types/*.ts` | All Zod schemas from Phase 3 architecture. These are the foundation everything is built on. |
| `src/db/database.ts` | SQLite connection, WAL mode, migration runner |
| `src/db/migrations/001-initial.sql` | Core tables: missions, agents, divisions, events, conversations, audit_log, wal |
| `src/db/repositories/*.ts` | Typed CRUD with Zod validation on read/write |
| `src/bus/event-bus.ts` | Pub/sub with glob pattern matching, SQLite persistence, replay from timestamp |
| `src/utils/logger.ts` | Structured JSON logger (shared across all engine code) |
| `src/utils/config.ts` | Env var loader with Zod validation |
| `src/index.ts` | Minimal Hono server with `/health` endpoint, wires DB + EventBus |

---

*Phase 5 complete. Proceed to Phase 6 -- Executive Summary.*
