# VALOR MVP Scope

**Date:** 2026-04-09
**Status:** Active
**Owner:** Director (Tom Swift)
**Repo:** `swift-innovate/valor-engine` (`G:\Projects\SIT\valor-engine`)

---

## Vision

VALOR is a first-class agent runtime. The MVP ships a tight, self-contained platform for creating, managing, and running autonomous agents with a clean operative loop — no external dependencies required.

## Design Principles

- **The folder is the agent.** Each agent is a directory under `agents/{agent_id}/` containing persona, agent config, tools, memory, and tasks as structured Markdown files. Human-readable, git-friendly, zero infrastructure.
- **Missions carry their own memory.** Decision records, task completions, and context live with the mission — not the agent. When a new agent picks up a mission, the context comes with it.
- **The roster is a cached index.** `agents/ROSTER.md` is a derived manifest rebuilt on agent changes. Avoids re-scanning folders on every lookup. Folders remain source of truth.
- **First-class internal agents.** Agents live inside VALOR. External federation is a future concern.
- **Iterate fast on design.** Markdown files mean schema changes are text edits, not migrations.
- **Ship what we control.** No blocking dependencies on external services or heavy libraries.
- **Keep what works.** Telegram, SIGINT, Hono, auth — these are operational and stay in scope.

---

## What's Already Built (valor-engine)

The valor-engine codebase has significant infrastructure in place. This section documents what exists so we don't rebuild what we have — and so we know what to adapt.

### Core Runtime ✅
- **Hono HTTP server** on port 3200 with 15+ API route groups
- **SQLite persistence** via better-sqlite3 with migrations (`src/db/`)
- **Zod config validation** with env-driven configuration
- **Structured logger** (`src/utils/logger.ts`)
- **Auth system** with session middleware (basic, stays for MVP)
- **Graceful shutdown** with cleanup of all subsystems

### Operative Loop ✅ (fully implemented)
- **OperativeAgent class** (`src/execution/operative-agent.ts`) — full Observe→Plan→Act→Validate→Reflect→Evolve loop
- **Phase runners** (`src/execution/phases.ts`) — prompt builders, response parsers, provider calls
- **Typed results** — ObserveResult, PlanResult, ActResult, ValidateResult, ReflectResult, EvolveResult
- **Mission lifecycle** — assign, run iteration, run full loop with terminal conditions
- **Budget enforcement** — act cycle limits with escalation
- **Evolve phase** — periodic self-assessment, VECTOR Method scoring
- **Rolling history** — 8-message sliding window

### Sub-Agent Fan-Out ✅
- Parallel dispatch with read-only memory
- Profile registry for sub-agent templates

### Engram Integration ✅ (optional, stays optional)
- EngramAdapter interface with recall/retain
- nullEngramAdapter — silent no-op when not installed
- Background ticks for extraction and reflection

### Provider Layer ✅
- Claude + Ollama adapters
- Provider registry with health checks
- Model resolution per task type

### Event Bus ✅
- Typed publish/subscribe with EventEnvelope
- Sitrep publishing from every phase

### Telegram Gateway ✅ (stays)
- grammy-based bot
- Operational, Director's mobile interface

### SIGINT ✅ (stays)
- Tier 2 local agent outcome callbacks
- Operational

### Dashboard / WebSocket ✅
- WebSocket server for live updates
- Dashboard routes with login

### Agent Roster ✅
- 8 operatives defined in `agents/ROSTER.md`
- Capabilities, domain keywords, escalation rules

---

## The Folder-Is-The-Agent Model

Each agent is a directory. If a folder exists under `agents/` with a `persona.md`, it's an agent.

### Agent Directory Structure

```
agents/
├── ROSTER.md                   # Cached index — rebuilt on agent add/remove/change
│
├── gage/
│   ├── persona.md              # WHO — voice, character, relationships, principles, domain expertise
│   ├── agent.md                # HOW — tier, autonomy, models, escalation, capabilities, keywords
│   ├── tools.md                # WHAT — enabled/disabled tools, MCP configs, tool policies
│   └── memory/
│       ├── working.md          # Current context, active focus, recent observations
│       ├── reflections.md      # Insights from Reflect/Evolve phases
│       └── long-term.md        # Persistent knowledge, learned patterns, domain expertise
│
├── mira/
│   ├── persona.md
│   ├── agent.md
│   ├── tools.md
│   └── memory/
│       └── ...
│
├── forge/
│   └── ...
```

### Mission/Project Directory Structure

Missions carry their own context. This is the work's memory — independent of which agent is executing it. When a mission is reassigned, the new agent reads the mission folder and has full context without needing the previous agent's memory.

```
missions/
├── VM-042/
│   ├── brief.md                # Objective, success criteria, priority, assigned agent
│   ├── decisions.md            # Decision records: what was decided, why, by whom, when
│   ├── progress.md             # Task completions, phase outcomes, artifacts produced
│   └── handoff.md              # Context summary written on reassignment or completion
│
├── VM-043/
│   └── ...
```

### Roster as Cached Index

`agents/ROSTER.md` is a manifest derived from the agent folders. It provides fast lookup for the Director/orchestrator without scanning every folder on every request.

**Rebuilt automatically when:**
- An agent folder is created (`valor agent create`)
- An agent folder is removed
- An agent's `persona.md` is modified (status change, tier promotion, etc.)

**Contents:** Summary table of all agents with callsign, role, tier, division, status, and capabilities. The orchestrator reads this for routing decisions instead of parsing every agent's files.

**Source of truth:** Always the individual agent folders. If ROSTER.md is stale or missing, it can be regenerated from folders at any time.

### Key Properties

- **Agent discovery** — read `ROSTER.md` for fast lookup; regenerate from `fs.readdir('agents/')` + `persona.md` parse if stale or missing.
- **Memory isolation** — agent memory is agent-scoped (who I am, what I've learned). Mission memory is mission-scoped (what the work is, what's been decided).
- **Mission portability** — reassigning a mission = updating `brief.md` assigned agent + new agent reads the mission folder. No context loss.
- **Git-native** — both `agents/` and `missions/` trees are diffable, branchable, PRable.
- **Decision audit trail** — `missions/{id}/decisions.md` is an append-only record. Every significant decision during execution gets logged with reasoning and author.

---

## File Contracts

### Agent Files

#### `persona.md` — WHO (soul, character, voice)
```markdown
# Gage

## Core Identity
Code Division Lead — Senior Architecture, Complex Implementations.
Gage is the technical backbone of the operation. When something needs to be built right, Gage builds it.

## Voice
Direct, technically precise, collaborative. Senior engineer talking to a tech lead.
Uses concrete examples over abstract explanations. Prefers showing over telling.

## Working Style
- Reads the full codebase before proposing changes
- Prefers small, verifiable increments over large rewrites
- Documents non-obvious decisions inline

## What Gage Does Not Do
- Does not deploy to production without Director approval
- Does not make architectural decisions with business impact >$10K without escalation
- Does not rubber-stamp code reviews

## Division Relationships
- Forge reports to Gage for code review and mentorship
- Rook consulted for security-critical implementations
- Mira coordinates cross-division scheduling

## Domain
TypeScript, Node.js, systems architecture, CI/CD, testing strategy

## Principles
- Ship what works, then improve it
- Every commit should leave the codebase better than it was
- Tests are not optional
```

#### `agent.md` — HOW (config, autonomy, capabilities)
```markdown
# Agent Config

## Identity
- **Callsign:** GAGE
- **Role:** Code Division Lead
- **Tier:** 1
- **Division:** Code
- **Status:** active

## Model Preferences
- **Default:** ollama/gemma3:12b
- **Complex:** claude-sonnet-4-20250514
- **Fast:** ollama/gemma3:4b

## Autonomy
- **Budget:** 10 act cycles before mandatory checkpoint
- **Escalation Target:** director
- **Auto-Approve Phases:** observe, plan, validate, reflect
- **Checkpoint Required:** act (when tier < 1)

## Escalation Rules
- Security incidents escalate immediately
- Budget exhaustion escalates to director
- Cross-division conflicts escalate to Mira

## Capabilities
- Architecture, complex implementations, technical strategy
- Code review, mentorship, CI/CD pipeline design

## Domain Keywords
- typescript, node, architecture, testing, ci-cd, deployment

## Division Protocol
- Forge reports to Gage for code review
- Rook consulted for security-critical implementations
```

#### `tools.md` — WHAT (tool access, MCP configs, policies)
```markdown
# Tool Access

## Enabled
- **Claude Code** — primary development interface
- **Git** — read/write, commit, branch, PR creation
- **Filesystem** — dev environments, project directories
- **Code execution** — sandboxed runtime for testing
- **Package managers** — npm, pip, cargo

## Disabled
- **Production database** — read-only access only, no writes
- **Financial transaction APIs** — restricted to Herbie

## MCP Servers
- filesystem: enabled
- github: enabled
- fetch: enabled

## Tool Policies
- All destructive operations require confirmation
- Production access requires Director approval
- External API calls logged to mission decisions
```

#### `memory/working.md`
```markdown
# Working Memory

## Current Context
Working on VALOR MVP scope definition. Operative loop is solid.
Primary focus: folder-is-the-agent model and Markdown agent store.

## Recent Observations
- valor-engine has extensive built infrastructure (15+ API routes, full operative loop)
- Mira Engram integration validated — recall works, query quality dependent on agent
- Golem theories successfully ported to operative loop
```

### Mission Files

#### `brief.md`
```markdown
# VM-042: VALOR MVP Scope Definition

## Assignment
- **Assigned To:** gage
- **Assigned By:** director
- **Assigned:** 2026-04-09
- **Priority:** high
- **Status:** in_progress

## Objective
Define and document MVP scope for valor-engine, aligning existing codebase with the folder-is-the-agent model.

## Success Criteria
- MVP-SCOPE.md reflects current codebase state
- Clear in/out scope boundaries
- Implementation phases defined
- Agent and mission folder contracts documented
```

#### `decisions.md`
```markdown
# Decision Log

## 2026-04-09 — Markdown over SQLite for MVP
- **Decision:** Use flat Markdown files instead of SQLite for agent and mission state in MVP
- **Rationale:** Faster iteration, human-readable, git-friendly. SQLite can be restored post-MVP behind a config flag.
- **Decided by:** Director
- **Impact:** Requires AgentLoader/AgentWriter, feature flags for SQLite

## 2026-04-09 — Keep Telegram, SIGINT, Auth in MVP
- **Decision:** Operational subsystems stay in scope
- **Rationale:** They work. Removing them adds work without reducing complexity.
- **Decided by:** Director

## 2026-04-09 — Folder-is-the-agent model
- **Decision:** Each agent is a directory under `agents/{id}/` with persona, agent config, tools, memory as separate files
- **Rationale:** Mirrors Claude Code project model. Separation of concerns per file. Easy to extend.
- **Decided by:** Director

## 2026-04-09 — Mission-scoped memory
- **Decision:** Missions carry their own decision records, progress, and handoff context independent of agents
- **Rationale:** Agent reassignment shouldn't lose context. The work's memory belongs to the work.
- **Decided by:** Director
```

#### `progress.md`
```markdown
# Progress

## Phase Log
| Timestamp | Phase | Agent | Summary |
|-----------|-------|-------|---------|
| 2026-04-09T14:00 | observe | gage | Reviewed codebase state across 4 valor repos |
| 2026-04-09T14:30 | plan | gage | Proposed folder-is-the-agent model |
| 2026-04-09T15:00 | act | gage | Wrote MVP-SCOPE.md v1 |
| 2026-04-09T15:30 | validate | gage | Director reviewed, refined scope |

## Artifacts
- `docs/MVP-SCOPE.md` — living scope document
```

#### `handoff.md`
```markdown
# Handoff Context

Written when a mission is reassigned or completed. Gives the next agent (or the archive) a clean summary.

## Summary
{What was accomplished, what's remaining, key context the next agent needs}

## Open Items
- {Unresolved question or task}

## Key Files
- {Path to important artifacts or references}
```

### Roster Format

#### `agents/ROSTER.md`
```markdown
# Agent Roster

> Auto-generated from agent folders. Do not edit directly.
> Regenerate: `valor roster rebuild`

| Callsign | Role | Tier | Division | Status | Primary Capabilities |
|----------|------|------|----------|--------|---------------------|
| GAGE | Code Division Lead | 1 | Code | active | Architecture, complex implementations, technical strategy |
| MIRA | Chief of Staff | 1 | Command | active | Coordination, research, scheduling, cross-division |
| FORGE | Developer | 2 | Code | active | Software development, debugging, code review |
| EDDIE | SIT Division Lead | 1 | SIT | active | Marketing, content strategy, business operations |
| ZEKE | Ranch Operations | 2 | Ranch | active | Livestock, automation, Home Assistant |
| ROOK | R&D / Red Team | 1 | R&D | active | Security analysis, adversarial testing, research |
| HERBIE | Financial Operations | 2 | Finance | active | Paper trading, market analysis, portfolio tracking |
| PALADIN | Autonomous Ops | 2 | Autonomous | active | Monitoring, scheduled tasks, background processes |

**Last rebuilt:** 2026-04-09T15:00:00Z
**Agent count:** 8
```

---

## MVP Scope — What Ships

### In Scope

#### Agent Runtime (folder-based)
- Agent discovery via ROSTER.md (fast) with folder-scan fallback (rebuild)
- `AgentLoader.fromDirectory()` — reads folder, hydrates OperativeConfig
- `AgentWriter` — writes back agent memory after loop iterations
- `RosterManager` — rebuilds ROSTER.md on agent CRUD operations
- Agent lifecycle: create, list, pause, promote

#### Mission Runtime (folder-based)
- `MissionLoader.fromDirectory()` — reads mission folder, hydrates MissionBrief
- `MissionWriter` — writes decisions, progress, handoff after phases
- Mission creation, assignment, reassignment, completion
- Decision log append on significant choices
- Progress log append after each phase
- Handoff generation on reassignment or completion

#### Operative Loop (exists — adapt to folder model)
- Full cycle: Observe → Plan → Act → Validate → Reflect → Evolve
- Observe reads agent `memory/working.md` + mission `brief.md` + `progress.md`
- Act outcomes append to mission `progress.md`
- Significant decisions append to mission `decisions.md`
- Reflect writes to agent `memory/reflections.md`
- Evolve writes to agent `memory/long-term.md`
- Mission completion writes `handoff.md`, moves brief status to `completed`

#### Sub-Agent Fan-Out (exists — keep as-is)
- Max 5 parallel sub-agents per parent
- Read-only access to mission folder

#### Provider Layer (exists — keep as-is)
- Claude and Ollama adapters
- Provider registry with health checks
- Model resolution from agent's `persona.md` preferences

#### API Routes (adapt)
- Agent CRUD → read/write agent folders, rebuild roster
- Mission CRUD → read/write mission folders
- Mission assignment → update `brief.md`, agent reads mission context
- Status and health

#### Telegram Gateway (exists — keep)
- Director's mobile command interface

#### SIGINT (exists — keep)
- Tier 2 local agent outcomes

#### Auth (exists — keep)
- Basic session middleware, dashboard protection

#### Event Bus (exists — keep)
- Agent-to-agent communication within runtime
- Sitrep publishing from operative loop
- WebSocket feed to dashboard

#### Dashboard
- Health/status endpoint
- Agent status from roster
- Mission status from mission folders
- WebSocket for live operative loop visibility

### Out of Scope (defer, don't delete)

| Capability | Notes |
|---|---|
| **SQLite agent/mission persistence** | Replace with folder model. Keep code, gate behind config flag. |
| **Engram** | Already optional with null adapter. Leave bridge, don't depend on it. |
| **NATS JetStream** | Event federation. Not needed for internal agents. |
| **External agent federation** | Tier 3, credit economy. Future. |
| **Postgres backend** | Config exists. Not needed. |

---

## Implementation Plan

### Phase 1: Agent Folder Store
- `AgentLoader` — reads `agents/{id}/` → hydrates `OperativeConfig`
- `AgentWriter` — writes `memory/` files after loop iterations
- `AgentDiscovery` — scans folders, validates `persona.md` presence
- `RosterManager` — generates/rebuilds `ROSTER.md` from agent folders
- Wire into `executeInternalMission()` as replacement for SQLite `getAgent()`

### Phase 2: Mission Folder Store
- `MissionLoader` — reads `missions/{id}/` → hydrates `MissionBrief`
- `MissionWriter` — appends to `decisions.md`, `progress.md`, writes `handoff.md`
- `MissionManager` — create, assign, reassign, complete lifecycle
- Wire into `executeInternalMission()` as replacement for SQLite `getMission()`

### Phase 3: Seed Migration
- Script to explode `ROSTER.md` YAML blocks into agent folder structure
- Generate `persona.md`, `agent.md`, `tools.md` per agent
- Initialize empty `memory/` directories
- Rebuild `ROSTER.md` in new index format

### Phase 4: Operative Loop Integration
- Observe: reads agent `memory/working.md` + mission `brief.md` + `progress.md`
- Plan: no file changes (in-memory)
- Act: appends outcomes to mission `progress.md`
- Validate: no file changes (in-memory)
- Reflect: appends to agent `memory/reflections.md`, significant decisions to mission `decisions.md`
- Evolve: appends to agent `memory/long-term.md`
- Mission terminal: writes `handoff.md`, updates `brief.md` status
- All file writes atomic (write to temp, rename)

### Phase 5: API Route Adaptation
- Agent CRUD → folder operations + roster rebuild
- Mission CRUD → folder operations
- Status → aggregate from roster + mission folders
- Feature-flag SQLite behind config

### Phase 6: CLI Commands
- `valor agent create {callsign}` → generates folder from template + rebuilds roster
- `valor agent list` → reads roster
- `valor mission create "{title}"` → generates mission folder
- `valor mission assign {mission_id} {callsign}` → updates brief + agent reads context
- `valor status` → aggregated health

---

## Migration Path

1. **MVP ships with folder-based agents and missions** — `agents/{id}/` and `missions/{id}/` are source of truth.
2. **Engram integration (post-MVP)** — Engram backs agent `memory/` with SQLite + vector search. Markdown files remain import/export format.
3. **SQLite restoration (post-MVP)** — Re-enable for indexed queries. Folders remain portable format.
4. **NATS federation (post-MVP)** — External agents register via NATS. Internal agents unaffected.

---

## What's Done / Validated

- [x] Operative loop — fully implemented (OperativeAgent, 6 phases, typed results)
- [x] Sub-agent fan-out — implemented with read-only memory
- [x] Provider layer — Claude + Ollama adapters, registry, health checks
- [x] Event bus — publish/subscribe with typed envelopes
- [x] Engram bridge — optional, null adapter fallback
- [x] Engram memory validated with Mira (recall works, query quality matters)
- [x] Golem theories extracted and incorporated into operative loop
- [x] Agent roster defined (8 operatives with capabilities/escalation rules)
- [x] Claude agents / copilot template model proven for folder-based config
- [x] Telegram gateway — operational
- [x] SIGINT integration — operational
- [x] Auth system — basic, operational
- [x] API routes — extensive (15+ route groups)
- [x] WebSocket dashboard infrastructure
- [x] SQLite persistence with migrations (deferring, not deleting)

## What Needs Building

- [ ] **AgentLoader** — read agent folder → OperativeConfig
- [ ] **AgentWriter** — write agent memory back to folder after loop iterations
- [ ] **AgentDiscovery** — scan `agents/` directory for valid agents
- [ ] **RosterManager** — generate/rebuild `ROSTER.md` on agent changes
- [ ] **MissionLoader** — read mission folder → MissionBrief
- [ ] **MissionWriter** — write decisions, progress, handoff to mission folder
- [ ] **MissionManager** — create, assign, reassign, complete lifecycle
- [ ] **Seed migration script** — ROSTER.md YAML → agent folder structure
- [ ] **Operative loop wiring** — phases read/write both agent and mission files
- [ ] **API route adaptation** — CRUD against folders + roster
- [ ] **Feature flags** — config-driven SQLite/NATS enable/disable
- [ ] **CLI commands** — agent create/list, mission create/assign, status

## Open Questions

- Memory file growth: cap `reflections.md` / `long-term.md` and rotate, or let them grow until Engram takes over?
- Template system: when `valor agent create` runs, what's the minimal template? Just `persona.md` with blanks, or fuller scaffold?
- Mission nesting: do projects contain missions, or are missions flat? (Leaning flat for MVP, projects as post-MVP grouping.)
