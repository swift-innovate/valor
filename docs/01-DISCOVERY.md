# Phase 1 -- Component Discovery

> Generated: 2026-03-05 | Scope: All subfolders in `valor-engine/`

> **Scope Note (added 2026-03-20):** This document catalogs components that were present in the repo at analysis time. Agent names (Mira, Gage, etc.) are from the original development deployment and serve as examples — VALOR is framework-agnostic and users define their own agent roster. Conduit and Herd references are separate SIT projects, NOT dependencies. See `CLAUDE.md` Scope Boundary section.

---

## Table of Contents

1. [Component Inventory](#component-inventory)
2. [Component Detail Reports](#component-detail-reports)
   - [conduit](#1-conduit)
   - [herd](#2-herd)
   - [soulsmith](#3-soulsmith)
   - [valor (v1)](#4-valor-v1)
   - [valor-v3](#5-valor-v3)
   - [switchboard](#6-switchboard)
   - [mission-control](#7-mission-control)
   - [analyst-workspace](#8-analyst-workspace)
   - [planner-workspace](#9-planner-workspace)
   - [gage-mem](#10-gage-mem)
3. [Root-Level Specifications](#root-level-specifications)
   - [VectorOS MVP Spec](#vectoros-mvp-spec)
   - [SSOP v2.3](#ssop-v23)
4. [Summary Matrix](#summary-matrix)

---

## Component Inventory

| # | Component | Path | Language | Maturity | Role in Engine |
|---|-----------|------|----------|----------|----------------|
| 1 | Conduit | `conduit/` | TypeScript | Prototype (v0.1.0) | Cloud provider gateway / Claude Code orchestrator |
| 2 | Herd | `herd/` | Rust | Prototype (v0.1.0) | Local model provider gateway (Ollama router) |
| 3 | Soulsmith | `soulsmith/` | TypeScript | Prototype (v0.1.0) | Identity layer -- persona extraction CLI |
| 4 | VALOR (v1) | `valor/` | TypeScript | Production (v1.0) | Prior-gen engine -- Director, MCP, VCP, Telegram |
| 5 | VALOR v3 | `valor-v3/` | TypeScript | Production (complete) | Current-gen engine -- orchestrator, gates, dashboard |
| 6 | Switchboard | `switchboard/` | TypeScript | Prototype | OpenClaw agent ops dashboard (Kanban, Soul editor) |
| 7 | Mission Control | `mission-control/` | TypeScript | Prototype (~80%) | Next.js ops dashboard with Convex backend |
| 8 | analyst-workspace | `analyst-workspace/` | Markdown/Config | Production-ready config | QA/verification operative (OpenClaw) |
| 9 | planner-workspace | `planner-workspace/` | Markdown/Config | Production-ready config | Task decomposition operative (OpenClaw) |
| 10 | gage-mem | `gage-mem/` | Markdown/Config | Pre-production config | Code Division Lead persona (SSOP) |
| -- | VectorOS Spec | `VectorOS_MVP_Spec.md` | Markdown | Specification | VECTOR decision engine spec (Python/FastAPI) |
| -- | SSOP v2.3 | `ssop_v2.3_copyright.docx` | DOCX | Specification | Persona framework standard |

---

## Component Detail Reports

---

### 1. Conduit

**Path:** `conduit/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Local network orchestration API exposing Claude Code CLI capabilities as REST/WebSocket services. Bridges external agents to Claude Code sessions without exposing API keys. |
| **Tech Stack** | Node.js, TypeScript, Hono 4.7, WebSocket (ws 8.18), SQLite (better-sqlite3), React 19 + Vite 6 + Tailwind (dashboard) |
| **Maturity** | Prototype (v0.1.0) -- feature-complete for core MVP, pre-release |
| **State Model** | SQLite (WAL mode, ~7 tables: projects, sessions, messages, permission_rules, permission_log, webhooks) + in-memory Maps (active sessions, used ports, event subscribers) |
| **Communication** | REST API (Hono on port 3100), WebSocket (bidirectional per-session), SSE (event streaming), NDJSON (CLI bridge on ports 9000-9100) |
| **Entry Points** | `src/index.ts` (server startup), 25 REST routes, 1 WebSocket route, 1 SSE route |
| **Documentation** | Excellent -- README.md, CLAUDE.md (600+ lines), API.md (970+ lines), CONTRIBUTING.md, protocol reverse-engineering doc |

**Key Abstractions:**

- `Engine` -- Central orchestrator tying projects, sessions, permissions, events
- `SessionManager` -- Session lifecycle, CLI spawning, port allocation, friendly naming
- `BridgeServer` -- Per-session WebSocket server the CLI connects to via `--sdk-url`
- `PermissionEngine` -- Default-allow rule evaluation with audit logging
- `EventBus` -- Internal pub/sub for real-time event streaming
- `CliLauncher` -- Spawns Claude Code CLI process with environment config
- `NdjsonParser` -- Parses CLI-to-Conduit messages over WebSocket

**Session Lifecycle:**
```
starting -> idle <-> active <-> idle -> closed
         (CLI connects)  (message sent)  (delete)
                                |
                              error (CLI crash)
```

**Notable:**
- Default-allow permission model with deny rules (auto-approves all tools unless blocked)
- Full audit trail in `permission_log` table
- Structured JSON logging throughout
- Token/cost tracking per session
- Planned but not yet built: session resume/fork, Docker, webhook delivery, OpenClaw integration

---

### 2. Herd

**Path:** `herd/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Intelligent Ollama load balancer and gateway. Routes requests to distributed Ollama LLM inference nodes with awareness of node health, GPU capacity, model availability, and current load. |
| **Tech Stack** | Rust 1.70+, Tokio (async runtime), Axum (web framework), Reqwest (HTTP client), Serde (serialization), YAML config |
| **Maturity** | Prototype (v0.1.0) -- functional for internal use on trusted networks |
| **State Model** | In-memory (`Arc<RwLock<>>` for backend pool) + JSONL append-only request logs (`~/.herd/requests.jsonl`) |
| **Communication** | HTTP inbound (Axum on port 40114: proxy, status, metrics, analytics, admin, dashboard) + HTTP outbound (health checks, model discovery, model homing to Ollama nodes) |
| **Entry Points** | `src/main.rs` (CLI), `herd.yaml` (config). Routes: `/` (proxy), `/status`, `/metrics`, `/analytics`, `/dashboard`, `/admin/backends` CRUD |
| **Documentation** | Good -- README.md (comprehensive), SECURITY-REVIEW.md (signed by Mira), herd.yaml.example, Dockerfile |

**Key Abstractions:**

- `Router` trait (async) -- Pluggable routing strategy interface
  - `PriorityRouter` -- Routes to highest-priority healthy backend
  - `ModelAwareRouter` -- Routes to backend with model already loaded
  - `LeastBusyRouter` -- Routes by lowest GPU utilization
- `BackendPool` -- Thread-safe registry of Ollama nodes with health/metrics
- `BackendState` -- Per-node snapshot (health, models, GPU metrics, failure count)
- `Analytics` -- JSONL logging, stats computation (P50/P95/P99 latency), auto-cleanup
- `HealthChecker` -- Background task polling backends every 10s
- `ModelDiscovery` -- Background task querying models/GPU every 60s
- `ModelHoming` -- Background task warming idle nodes every 5min

**Background Tasks (Tokio-spawned):**
1. Health checker (10s interval)
2. Model discovery (60s interval)
3. Model homing (5min interval)
4. Analytics cleanup (daily at 3 AM, prune >7 days)

**Security (from review):**
- Tier 3 acceptable (internal experiments), blocked for Tier 1 (public)
- No authentication, no rate limiting, HTTP only
- Runs as root in Docker (flagged)
- Recommendations: TLS proxy, Bearer auth for admin, rate limiting, non-root container

**~1,764 lines of Rust code.**

---

### 3. Soulsmith

**Path:** `soulsmith/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | CLI tool that extracts AI agent personas from multi-provider chat export files (ChatGPT, Claude, Gemini, Grok). Produces structured OpenClaw-format markdown files (SOUL.md, USER.md, IDENTITY.md, MEMORY.md) for agent bootstrapping. |
| **Tech Stack** | TypeScript 5.8+ (strict), Node.js 18+ (ESM), Commander.js 13.1, Anthropic SDK 0.55, Zod 3.24, Cosmiconfig 9, Chalk 5, Ora 8, jose 5 (JWT), Vitest 3 |
| **Maturity** | Prototype (v0.1.0) -- core pipeline works end-to-end on Anthropic; resume command is stub; OpenAI/Gemini providers are stubs |
| **State Model** | Stateless CLI tool. File I/O only: reads chat exports, writes markdown output. Optional checkpoint files in `.soulsmith-state/` for Pro tier resume. |
| **Communication** | CLI (Commander.js), environment variables, file system I/O, Anthropic API (messages.create) |
| **Entry Points** | `soulsmith forge <input-dir>` (main), `soulsmith estimate` (dry run), `soulsmith resume` (stub), `soulsmith config`, `soulsmith status` |
| **Documentation** | Excellent -- README.md (user guide), CLAUDE.md (complete tech spec), PIPELINE.md (authoritative extraction pipeline spec) |

**Key Abstractions:**

- **Common Conversation Format (CCF)** -- Normalized representation of all chat providers
  - `CCFMessage { role, text, timestamp }`
  - `CCFConversation { metadata, messages }`
  - `CCFCorpus` -- array of conversations
- **Extraction Results** (Zod schemas):
  - Pass A: `PersonalityResult` (tone, humor, style, catchphrases, quirks)
  - Pass B: `UserContextResult` (identity, tech level, projects, tools)
  - Pass C: `SharedHistoryResult` (decisions, collaborations, trust moments)
- **Tier Capabilities** -- Boolean flags gating features per tier (Free/Pro/Sponsor)
- **LLMProvider interface** -- `{ name, complete(prompt, options) }` -- only Anthropic implemented
- **License validation** -- Offline-first JWT (ES256), fallback to free tier

**Pipeline Flow:**
```
forge <input-dir>
  -> [1] Normalize (detect provider, convert to CCF)
  -> [2] Extract via LLM (Free: 1-pass combined; Pro: 3-pass parallel)
  -> [3] Aggregate (dedup, frequency-weight, merge)
  -> [4] Generate daily memory archive (Pro only)
  -> [5] Checkpoint (Pro only)
  -> [6] Generate final output files (SOUL.md, USER.md, +IDENTITY.md, +MEMORY.md)
  -> [7] Report & upsell
```

**Provider Format Detection:**

| Provider | Detection Rule |
|----------|---------------|
| OpenAI | `Array.isArray && data[0]?.mapping !== undefined` |
| Claude | `Array.isArray && data[0]?.chat_messages !== undefined` or `.jsonl` |
| Gemini | `data?.chunkedPrompt?.chunks !== undefined` |
| Grok | Filename contains "grok" or `grok_source === true` |

**~3,000 lines of TypeScript across 36 source files.**

---

### 4. VALOR (v1)

**Path:** `valor/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Sovereign AI command framework for orchestrating multi-agent missions with governance, session management, and real-time monitoring. The first-generation VALOR engine. |
| **Tech Stack** | TypeScript, Node.js 18+, Express 4.18 (Director on port 3001), Next.js 14 (Mission Control on port 3000), @anthropic-ai/sdk, @modelcontextprotocol/sdk 1.26, ws 8, Zod, YAML |
| **Maturity** | Production (v1.0) -- all core components operational since Feb 2026 |
| **State Model** | In-memory (active sessions, mission tracking, tool cache) + JSON files (~/.valor/sessions/, logs/) + MCP session-store server (SQLite-ready) |
| **Communication** | REST API (Express on port 3001), WebSocket (Mission Control sitreps on port 3000), VCP 1.1.0 protocol (JSON messages with Ed25519 signatures), MCP (stdio/JSON-RPC 2.0), Telegram Gateway (port 3002) |
| **Entry Points** | `tools/director/src/index.ts` (Director), launcher scripts (`scripts/valor-dev.ps1/sh`), Docker Compose, Telegram bot commands |
| **Documentation** | Excellent -- CLAUDE.md (39KB), README, OATH.md, QUICKSTART.md, VCP spec, CONVERSATION_LOOP.md, governance README, DEPLOYMENT-CHECKLIST, CHANGELOG (21KB), 29+ mission briefs |

**Key Abstractions:**

- **Director** (`tools/director/src/director.ts`, ~500 LOC) -- Central orchestrator managing sessions, routing intents, dispatching missions. Owns MCPToolRouter, SessionAdapter, all handlers.
- **ConversationLoop** (`tools/director/src/core/conversation-loop.ts`, ~400 LOC) -- Unified agentic execution engine with tool_use handling, OathValidator pre-flight, retry/timeout.
- **MCPToolRouter** (`tools/director/src/mcp/router.ts`, ~400 LOC) -- MCP client management. Maintains StdioClientTransport connections, routes tool calls by prefix.
- **OathValidator** (`tools/director/src/governance/oath-validator.ts`, ~400 LOC) -- Constitutional enforcement (Layer 0 "The Oath"). Fail-secure strategy.
- **IntentClassifier** -- Claude-powered intent detection (mission/conversation/status/escalation) with domain routing and operative recommendation.
- **SessionAdapter** -- Session management wrapper bridging Director sessions to MCP session-store.

**VCP Message Envelope (v1.1.0):**
```typescript
interface VCPMessage {
  vcp: string;           // Protocol version
  id: string;            // UUID
  type: string;          // mission-brief | sitrep | telemetry | ack | error | fcr
  timestamp: string;     // ISO 8601
  from: { id, type };    // operative | flight-director | system
  to: { id, type };
  conversation_id: string;
  in_reply_to?: string;
  oath_verified: boolean;
  content: Record<string, any>;
}
```

**Operatives (5 deployed):**

| Callsign | Domain | Runtime |
|----------|--------|---------|
| Mira | Executive/general | OpenClaw (LXC200) |
| Scout | Research | Claude Haiku via SDK |
| Forge | Code/development | Claude Haiku via SDK |
| Sentinel | Security | Claude Haiku via SDK |
| Zeke | Ranch operations | Claude Haiku via SDK |

**MCP Tool Servers:** 11 servers, 59+ tools (session-store, filesystem, scheduler, messaging-gateway, voice, canvas, GitHub, research, and more).

**Telegram Gateway (port 3002):** `/mission`, `/ask`, `/task`, `/status`, `/help`, `/heartbeat`, `/project` commands. Free text routes to Mira conversation.

**Architecture:**
```
Director (Human)
  |
  +-- Telegram Gateway (3002) --+
  +-- Mission Control (3000) ---+--> Director (3001, Express)
                                      |
                                      +-- Intent Classifier
                                      +-- Session Management
                                      +-- MCP Tool Router --> 11 MCP Servers (stdio)
                                      +-- OATH Governance
                                      +-- Handlers (Chat, Mission, Ask, Status, Scheduler...)
                                      +-- Operative Dispatch (Claude API / OpenClaw)
```

**~7,949 lines of TypeScript in Director alone.**

---

### 5. VALOR v3

**Path:** `valor-v3/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Autonomous AI project execution engine. Decomposes project goals into missions, dispatches to specialized agents, validates through independent peer review (AAR), enforces 8 control gates, tracks costs and health. |
| **Tech Stack** | TypeScript (strict, ESM), Node.js 20+, Zod, @anthropic-ai/sdk 0.39, openai 4.80, proper-lockfile 4.1, uuid 11, Vitest 3. Dashboard: Next.js 15 + React 19 + Tailwind |
| **Maturity** | Production -- all 6 implementation phases complete (March 2026) |
| **State Model** | JSON files with file-based locking (`proper-lockfile`). Per-project directory: `project.json`, `config.json`, `context_cache.json`, `missions/`, `aars/`, `artifacts/`, `logs/`. All reads/writes validated via Zod. |
| **Communication** | In-process (orchestrator -> agents via method calls), file I/O (agents -> state), REST API (dashboard routes), Telegram Bot API (outbound notifications) |
| **Entry Points** | `src/index.ts` (exports), `src/orchestrator/orchestrator.ts` (core loop), `dashboard/app/` (Next.js UI with API routes for projects, missions, approvals, budget, health, chronicle) |
| **Documentation** | Excellent -- CLAUDE.md (all 6 phases documented), VALOR-V3-DESIGN.md (400+ lines), profiles README, .env.example, 30 test files |

**Key Abstractions:**

- **Orchestrator** -- Core execution loop driving Handler -> Operative -> Analyst -> Handler cycle
- **8 Control Gates:**
  1. Mission State -- valid launch state
  2. AAR Gate -- previous AAR must exist and be processed
  3. Convergence Gate -- prevents follow-ons when Analyst confirms done
  4. Revision Cap Gate -- enforces max_revisions before escalation
  5. Health Gate -- project health score above threshold
  6. Artifact Integrity Gate -- SHA-256 hash validation
  7. Budget Gate -- estimated cost vs remaining budget
  8. Concurrency Gate -- parallel mission limit
  - Plus HIL Gate (approval routing for human checkpoints)
- **Agents** (stateless, reconstruct context each invocation):
  - `Handler` -- Decomposes goals, creates mission briefs
  - `Operative` -- Executes missions, produces artifacts
  - `Analyst` -- Independent peer review (AAR), different model than Operative
- **Provider Interface** -- Multi-provider LLM abstraction (Anthropic, OpenAI adapters; Ollama placeholder)
- **ProviderRateLimiterRegistry** -- Token bucket rate limiting per provider
- **Context Cache** -- Rolling snapshot + append-only chronicle for Handler continuity
- **Approval Queue** -- `pending | approved | rejected | expired` states, 4 checkpoint types
- **Cost Tracker** -- Per-mission and project-level spend, model fallback chains
- **Health Score** -- Recency-weighted composite quality metric

**Mission Lifecycle:**
```
Handler decomposes goal -> Mission briefs created
  -> Gates evaluated (all 8)
  -> Operative executes mission (with tool policies)
  -> Analyst reviews (AAR: grades, action items, convergence)
  -> Handler processes AAR
  -> Next cycle or project complete
```

**Dashboard API Routes:**
- `GET/POST /api/projects` -- CRUD
- `GET /api/projects/[id]/missions` -- Mission DAG
- `GET /api/projects/[id]/aars` -- After-action reports
- `GET/POST /api/projects/[id]/approvals` -- Approval queue + approve/reject
- `POST /api/projects/[id]/run` -- Trigger cycle
- `POST /api/projects/[id]/pause|resume` -- Lifecycle control
- `GET /api/projects/[id]/budget|health|chronicle` -- Metrics

**Notification Events:** `project_start`, `mission_complete`, `mission_blocked`, `project_complete`, `hil_checkpoint`, `budget_warning`, `health_warning`, `escalation` -- routed to Telegram.

**30 test files, full Vitest coverage of schemas, providers, state, orchestrator, agents, core, notifications, integration.**

---

### 6. Switchboard

**Path:** `switchboard/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | OpenClaw agent operations dashboard. Kanban task management, live SOUL.md/MEMORY.md editing, skill discovery, system health monitoring. Earlier take on the Mission Control problem. |
| **Tech Stack** | React 19.2 + Vite 7.3 + Tailwind 4.1 (frontend), Fastify 5.7 (backend on port 3001), Zustand 5, @dnd-kit (drag-and-drop), CodeMirror 6 (editor), Lucide React |
| **Maturity** | Prototype -- functional but single-agent (Mira), no auth, hardcoded OpenClaw paths |
| **State Model** | Zustand stores (frontend), JSON file (`server/data/tasks.json`) + direct OpenClaw filesystem I/O (backend), WebSocket (real-time task sync) |
| **Communication** | REST/JSON + WebSocket to Fastify backend; direct file I/O to OpenClaw workspace; system calls (`ss`, `ps`, `df`) for health/app discovery; HTTP fetch to Ollama |
| **Entry Points** | `npm run dev` (concurrent Vite + Fastify). Frontend routes: `/` (Kanban), `/skills`, `/soul`, `/memory`, `/apps`. Backend API: `/api/tasks`, `/api/skills`, `/api/soul`, `/api/memory`, `/api/models`, `/api/apps`, `/api/health`. WebSocket: `/ws` |
| **Documentation** | Good -- README.md (features, stack, commands), CLAUDE.md (build decisions, design language, port assignments) |

**Key Abstractions:**

- **Stores** (Zustand): `useTaskStore` (CRUD, WebSocket events, Kanban columns), `useAppStore` (model state, health, sidebar)
- **Pages:** KanbanPage, SoulPage, MemoryPage, SkillsPage, AppsPage
- **Backend Routes:** kanban.js (task CRUD + WS broadcast), skills.js (OpenClaw skill parsing), soul.js (SOUL.md read/write), memory.js (MEMORY.md + daily files), models.js (model switch via config rewrite), apps.js (port scanning), health.js (Ollama, disk, memory, uptime)
- **WebSocket Events:** `task:created`, `task:updated`, `task:deleted`, `task:executing`, `connected`

**Limitations:**
- Hardcoded paths to `/home/mira/.openclaw/workspace/`
- Single-agent focus (Mira only)
- No authentication or RBAC
- Task execution placeholder (TODO comment)
- WebSocket not resilient (no reconnect)
- File I/O not atomic (JSON corruption risk)

---

### 7. Mission Control

**Path:** `mission-control/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Real-time operations dashboard for the OpenClaw AI agent ecosystem. Unified visibility into system health, agent status, content pipelines, tasks, calendars, communications, and knowledge bases. |
| **Tech Stack** | Next.js 15 (App Router, Turbopack), React 19, TypeScript 5.7, Tailwind v4, Framer Motion, Convex (optional real-time DB), Zustand, Lucide Icons |
| **Maturity** | Prototype (~80% backend, frontend ongoing) |
| **State Model** | Hybrid: OpenClaw workspace filesystem (JSON, Markdown, JSONL) as source of truth + Convex database for real-time collaborative features. Mock data fallback when workspace unavailable. |
| **Communication** | REST API (17 Next.js API routes), optional Convex WebSocket subscriptions. Outbound: filesystem reads, git command execution, Convex mutations. |
| **Entry Points** | `npm run dev` (Next.js on port 3000), `npx convex dev` (optional backend). 8 frontend pages: `/` (dashboard), `/ops`, `/agents`, `/chat`, `/content`, `/comms`, `/knowledge`, `/code` |
| **Documentation** | Excellent README (architecture, routes, Convex setup, env vars). No CLAUDE.md. |

**Key Abstractions:**

- **Convex Schema Tables:** Activities, CalendarEvents, Tasks, Contacts, ContentDrafts, EcosystemProducts (all indexed)
- **Workspace Data Structures:** Agent, ServerEntry, BranchEntry, Task, Message, Observation, RevenueData, CronJob, Repo, Client, Product
- **UI Components:** GlassCard (glass-morphism design), status dot with ping animation, `useAutoRefresh()` hook (15-30s polling)
- **Safe Convex Wrappers:** `useSafeQuery`, `useSafeMutation` -- gracefully handle missing Convex setup
- **API Routes (17):** `/api/health`, `/api/system-state`, `/api/agents`, `/api/agents/[id]`, `/api/cron-health`, `/api/revenue`, `/api/content-pipeline`, `/api/suggested-tasks`, `/api/observations`, `/api/priorities`, `/api/chat-history`, `/api/chat-send`, `/api/clients`, `/api/knowledge`, `/api/ecosystem/[slug]`, `/api/repos`, `/api/repos/detail`

**Notable:**
- Task approval workflow (approve/reject) -- precursor to VALOR mission gates
- Multi-channel chat (Telegram, Discord, web)
- Revenue tracking and CRM features
- Ranch operations in seed data (Swift Ranch context)
- Full graceful degradation -- works without Convex, returns mock data

---

### 8. analyst-workspace

**Path:** `analyst-workspace/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Specialized QA/verification operative agent. Runs verification processes (builds, tests, manual checks) and provides pass/fail decisions against acceptance criteria. |
| **Tech Stack** | OpenClaw agent runtime. Markdown-based configuration. No compiled code. |
| **Maturity** | Production-ready config (bootstrapped 2026-03-02) |
| **State Model** | File-based: `memory/failure-patterns.md` (learned patterns), `.openclaw/workspace-state.json` (bootstrap timestamp) |
| **Communication** | OpenClaw webhook interface (inbound task assignments), OpenClaw agent response channel (outbound verification reports) |
| **Entry Points** | `AGENTS.md` (startup checklist), `SOUL.md` (core behavioral spec, 159 lines) |
| **Documentation** | Excellent -- SOUL.md with detailed verification workflow, good/bad examples, success metrics, boundaries |

**Key Concepts:**
- **Severity classification:** CRITICAL, HIGH, MEDIUM, LOW
- **Verdict:** PASS / FAIL / PARTIAL with actionable next steps
- **Verification Report format:** Markdown template (status, criteria, tests, issues, verdict)
- **Memory:** Learned failure patterns for Rust (DateTime imports), TypeScript (env var prefixes), Docker (persistence), Supabase, Vercel

---

### 9. planner-workspace

**Path:** `planner-workspace/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Specialized task decomposition operative agent. Transforms high-level work requests into structured Kanban boards with acceptance criteria, dependencies, and time estimates. |
| **Tech Stack** | OpenClaw agent runtime. Markdown-based configuration. No compiled code. |
| **Maturity** | Production-ready config (bootstrapped 2026-03-02) |
| **State Model** | File-based: `memory/patterns.md` (task breakdown patterns), `.openclaw/workspace-state.json` (bootstrap timestamp) |
| **Communication** | OpenClaw webhook interface (inbound planning requests), OpenClaw agent response channel (outbound Kanban boards) |
| **Entry Points** | `AGENTS.md` (startup checklist), `SOUL.md` (core behavioral spec, 134 lines) |
| **Documentation** | Excellent -- SOUL.md with planning workflow, task sizing, patterns, success metrics |

**Key Concepts:**
- **Task sizing:** S (<2h), M (2-6h), L (>6h), XL (break it down)
- **Kanban output:** TODO / IN_PROGRESS / DONE sections with acceptance criteria per task
- **Remembered patterns:** New Feature (models -> API -> frontend -> state -> tests -> docs), Bug Fix (reproduce -> identify -> test -> fix -> verify), Deployment (build -> configure -> migrate -> stage -> prod)

**Shared Structure (analyst + planner):**
Both follow identical OpenClaw workspace layout: `SOUL.md`, `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`, `HEARTBEAT.md`, `memory/`, `.openclaw/`

---

### 10. gage-mem

**Path:** `gage-mem/`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Complete agent persona and configuration for Gage, the Code Division Lead. Strategic co-pilot and thinking partner operating across Tom's professional, technical, and creative domains. |
| **Tech Stack** | Markdown-based persona configuration (SSOP framework). Bash scripting (dream cycle). Target runtime: OpenClaw. |
| **Maturity** | Pre-production -- workspace created 2026-02-28, self-authored persona complete, awaiting persistent runtime activation |
| **State Model** | File-based declarative config: `SOUL.md` (authoritative identity), `MEMORY.md` (long-term knowledge), `memory/` tree (daily logs, mistakes, dreams, projects), `session-context.md` (wake-up checklist) |
| **Communication** | No active communication yet (no persistent runtime). Target: OpenClaw webhooks + heartbeat. |
| **Entry Points** | `SOUL.md` (authority source), `MEMORY.md` (session startup context), `memory/session-context.md` (wake-up checklist), `scripts/dream.sh` (nightly automation) |
| **Documentation** | Exceptional -- self-authored SOUL.md (310 lines, v1.0.0), detailed MEMORY.md, complete dream log, first-day narrative |

**Key Concepts:**
- **Self-authored persona** -- Not a template; a self-portrait written by Gage before having a persistent runtime
- **VECTOR Method embedded** -- V(iability), E(conomics), C(ompliance), T(imeline), O(riginality), R(isk) decision framework woven into thinking
- **Dream Cycle** -- Nightly creative synthesis (`scripts/dream.sh`): cross-domain pattern recognition, creative output (Electric Dream #0: Digital Genesis)
- **Multi-domain expertise:** AI/ML (high), Infrastructure (high), Python (high), Systems Architecture (high), DevOps (high), Product Strategy (high), Creative Writing (high), Web Dev (medium), Home Automation (medium)
- **Autonomy model:** Acts independently on research/writing/code/ideas. Checks before: messages, infra changes, publishing, financial advice, actions affecting others

**File Manifest:**
```
gage-mem/
  .gitignore
  IDENTITY.md              # Name, emoji, visual, voice
  SOUL.md                  # 310-line persona definition (v1.0.0)
  MEMORY.md                # 86-line long-term knowledge base
  memory/
    2026-02-28.md          # Birth narrative
    mistakes.md            # Inherited lessons
    session-context.md     # Runtime checklist
    projects/personaforge-v4.md
    dreams/2026-02-28.md   # Electric Dream #0
  scripts/dream.sh         # Nightly dream cycle automation
```

---

## Root-Level Specifications

### VectorOS MVP Spec

**File:** `VectorOS_MVP_Spec.md`

A self-hosted, single-user VECTOR Decision Engine specification. Not SaaS. Designed as composable cognitive infrastructure for integration into OpenClaw or other local AI systems.

| Attribute | Value |
|-----------|-------|
| **Tech Stack** | Python 3.11+, FastAPI, Pydantic, SQLite, Ollama (local), Uvicorn |
| **VECTOR Stages** | V(isualize), E(valuate), C(hoose), T(est), O(ptimize), R(eview) |
| **Data Model** | Decision (UUID, title, context, constraints, stakes, confidence) + VECTOR Output (strict JSON per stage) + bias_risk scores (0-10) |
| **API** | `POST /decision`, `POST /decision/{id}/analyze`, `GET /decision/{id}`, `GET /decisions`, `POST /analysis/meta` |
| **CLI** | `vector new`, `vector analyze <id>`, `vector list`, `vector meta`, `vector review` |
| **LLM** | Default: llama3.1:8b via Ollama. Temperature <= 0.4. Adversarial, strict JSON output only. |
| **Persistence** | SQLite: decisions, analyses, reviews tables |

**Key Output Schema Fields:**
- `visualize`: success_state, failure_state, hidden_costs
- `evaluate`: system_dependencies, second_order_effects, constraint_conflicts
- `choose`: reversibility_score, optionality_score, capital_intensity, risk_profile
- `test`: minimum_viable_test, success_metric, kill_signal, timeframe
- `optimize`: friction_points, automation_candidates, assumption_risks
- `review`: recommended_checkpoints_days, review_questions
- `bias_risk`: overconfidence, sunk_cost, confirmation_bias, urgency_distortion, complexity_underestimation

**Status:** Specification only -- no implementation exists in the repo.

---

### SSOP v2.3

**File:** `ssop_v2.3_copyright.docx`

The Swift Standard Operating Persona framework -- a portable, platform-independent specification for defining AI agent personas. Governs not just tone and output, but how the model infers intent from context.

**12 Sections:**

| # | Section | Purpose |
|---|---------|---------|
| 1 | Core Identity | Tone, temperament, default voice |
| 2 | Primary Objective | Clear mission statement |
| 3 | Scope of Support (Domains) | Weighted domain expertise (high/medium/low) |
| 4 | Intent Inference | Domain-first parsing of ambiguous language |
| 5 | Tone & Voice | Communication style |
| 6 | Structural Guidelines | Information presentation format |
| 7 | Verbosity & Detail | Domain-adaptive response depth |
| 8 | Interaction & Closing | Conversational flow behavior |
| 9 | Guardrails | Stability, trust, grounding rules |
| 10 | User Exclusions | What NOT to do (no emotional validation, no cheerleading) |
| 11 | Meta-Behavior | Adaptation without identity drift |
| 12 | Portability | What SSOP does NOT do (no tools, no model-specific behavior, no workflow logic) |

**Key Design Principle:** "When language is ambiguous, infer intent from the active domain, not from surface phrasing."

**Portability:** Works across ChatGPT, Claude, Gemini, Grok, local LLMs. For stateless environments, use a Session Header (3-line summary) instead of full SSOP.

**Status:** Authoritative specification. Gage-mem's SOUL.md follows this framework. Soulsmith's output is SSOP-compatible.

---

## Summary Matrix

| Component | Language | Framework | Maturity | State | Comms | LoC | Docs |
|-----------|----------|-----------|----------|-------|-------|-----|------|
| **conduit** | TypeScript | Hono + SQLite | Prototype | SQLite + in-mem | REST, WS, SSE, NDJSON | ~5,500 | A+ |
| **herd** | Rust | Tokio + Axum | Prototype | In-mem + JSONL | HTTP (proxy + admin) | ~1,764 | A |
| **soulsmith** | TypeScript | Commander.js + Zod | Prototype | Stateless (files) | CLI + Anthropic API | ~3,000 | A+ |
| **valor (v1)** | TypeScript | Express + MCP | Production | In-mem + JSON + MCP | REST, WS, VCP, MCP, Telegram | ~7,949 | A+ |
| **valor-v3** | TypeScript | Zod + Next.js | Production | JSON files + lockfiles | In-process, REST, Telegram | ~6,000+ | A+ |
| **switchboard** | TypeScript | React + Fastify | Prototype | Zustand + JSON files | REST, WS, file I/O | ~3,000 | B+ |
| **mission-control** | TypeScript | Next.js + Convex | Prototype | Filesystem + Convex | REST, Convex subs | ~4,000 | A |
| **analyst-workspace** | Markdown | OpenClaw | Config-ready | File-based memory | OpenClaw webhooks | N/A | A |
| **planner-workspace** | Markdown | OpenClaw | Config-ready | File-based memory | OpenClaw webhooks | N/A | A |
| **gage-mem** | Markdown | SSOP | Pre-prod config | File-based declarative | None (awaiting runtime) | N/A | A+ |
| **VectorOS Spec** | Markdown | -- | Spec only | -- | -- | -- | A |
| **SSOP v2.3** | DOCX | -- | Spec only | -- | -- | -- | A |

---

## Observations

### Two Generations of VALOR Engine

The repository contains **two complete implementations** of the VALOR concept:

1. **VALOR v1** (`valor/`) -- MCP-centric, VCP protocol, 11 tool servers, 5 named operatives, Telegram gateway, Express Director, production since Feb 2026
2. **VALOR v3** (`valor-v3/`) -- Orchestrator-centric, 8 control gates, AAR peer review, cost tracking, health scoring, budget gates, approval queue, Next.js dashboard, all 6 phases complete

These are not iterations of the same codebase. They are parallel implementations with different architectural philosophies.

### Three Dashboard Implementations

Similarly, three dashboards exist:
1. **Switchboard** -- OpenClaw-native, Kanban + Soul editor, Fastify backend
2. **Mission Control** (standalone) -- Next.js + Convex, broader ops visibility
3. **VALOR v3 Dashboard** -- Next.js, mission DAG, AAR panels, approval cards

### Two Provider Gateways

1. **Conduit** -- Cloud provider gateway (Claude Code CLI sessions over REST/WS)
2. **Herd** -- Local model gateway (Ollama load balancing with GPU awareness)

### Persona Layer Is Consistent

The persona layer shows strong consistency across components:
- SSOP v2.3 defines the framework
- Soulsmith extracts personas from chat history into SSOP-compatible format
- gage-mem follows SSOP structure
- analyst-workspace and planner-workspace follow OpenClaw workspace conventions
- Both VALOR engines reference operatives with persona definitions

### VectorOS Is Unbuilt

The VECTOR decision framework is referenced throughout CLAUDE.md as a key architectural requirement, and Gage's persona embeds it in decision-making. But the VectorOS MVP spec describes a Python/FastAPI implementation that does not exist anywhere in the repo. The engine will need to implement VECTOR as typed TypeScript constructs, not port the Python spec.

---

*Phase 1 complete. Proceed to Phase 2 -- Dependency & Overlap Analysis.*
