# VALOR Engine — Agent Instructions

> **VALOR Engine**: Folder-based agent runtime with mission-driven execution.
> TypeScript · Node.js 20+ · ESM · Hono · Zod · better-sqlite3

**Last Updated:** 2026-04-09

---

## Project Overview

VALOR is a first-class agent runtime. Agents are directories. Missions carry their own memory. The operative loop (Observe→Plan→Act→Validate→Reflect→Evolve) drives all agent execution.

**Authoritative spec:** `docs/MVP-SCOPE.md` — read this for the full design, file contracts, and implementation plan.

**Agent team prompt:** `docs/AGENT-TEAM-PROMPT.md` — structured task assignments for `/agent-team` mode.

---

## Core Model: The Folder Is The Agent

Each agent is a directory under `agents/{agent_id}/`. If a folder has a `persona.md`, it's an agent.

```
agents/
├── ROSTER.md                   # Cached index — auto-rebuilt on agent changes
├── gage/
│   ├── persona.md              # WHO — voice, character, relationships, principles, domain expertise
│   ├── agent.md                # HOW — tier, autonomy, models, escalation, capabilities, keywords
│   ├── tools.md                # WHAT — enabled/disabled tools, MCP configs, tool policies
│   └── memory/
│       ├── working.md          # Current context, recent observations
│       ├── reflections.md      # Insights from Reflect/Evolve phases
│       └── long-term.md        # Persistent knowledge, learned patterns
├── mira/
│   └── ...
```

Each mission is a directory under `missions/{mission_id}/`. Missions carry their own context — independent of the executing agent.

```
missions/
├── VM-042/
│   ├── brief.md                # Objective, criteria, priority, assigned agent
│   ├── decisions.md            # Append-only decision log
│   ├── progress.md             # Phase outcomes, artifacts
│   └── handoff.md              # Context summary on reassignment/completion
```

**ROSTER.md** is a derived index rebuilt on agent CRUD. Fast lookups without scanning folders every time. Folders are always source of truth.

---

## Tech Stack

- **Runtime:** Node.js 20+ with TypeScript (strict mode)
- **Module system:** ESM (`"type": "module"`, `.js` extensions in imports)
- **HTTP:** Hono on port 3200
- **Validation:** Zod schemas
- **Database:** better-sqlite3 (feature-flagged — folder store is primary for MVP)
- **Testing:** Vitest
- **Provider SDKs:** @anthropic-ai/sdk, openai (Ollama via protocol adapter)
- **Logging:** Structured JSON via `src/utils/logger.ts`

---

## Project Structure

```
valor-engine/
├── CLAUDE.md                    # THIS FILE
├── docs/
│   ├── MVP-SCOPE.md             # Authoritative spec (READ THIS)
│   └── AGENT-TEAM-PROMPT.md     # Task assignments for agent-team mode
│
├── agents/                      # Agent folders (source of truth)
│   ├── ROSTER.md                # Cached agent index
│   ├── gage/                    # One folder per agent
│   ├── mira/
│   ├── forge/
│   └── ...
│
├── missions/                    # Mission folders
│   └── {mission-id}/
│
├── src/
│   ├── index.ts                 # Entry point (Hono server, startup)
│   ├── config.ts                # Zod-validated config from env
│   │
│   ├── store/                   # Folder-based persistence (NEW — MVP)
│   │   ├── agent-store.ts       # AgentLoader, AgentWriter, AgentDiscovery, RosterManager
│   │   └── mission-store.ts     # MissionLoader, MissionWriter, MissionManager
│   │
│   ├── execution/               # Operative loop (EXISTING — adapt)
│   │   ├── operative-agent.ts   # OperativeAgent class, full loop
│   │   ├── phases.ts            # Phase runners (observe, plan, act, validate, reflect, evolve)
│   │   ├── types.ts             # OperativeConfig, MissionBrief, phase result types
│   │   ├── subagent.ts          # Sub-agent fan-out
│   │   ├── engram-bridge.ts     # Optional Engram adapter (null fallback)
│   │   ├── config-loader.ts     # Default config builder
│   │   └── index.ts             # executeInternalMission() entry point
│   │
│   ├── providers/               # LLM provider adapters (EXISTING — keep)
│   ├── bus/                     # Event bus (EXISTING — keep)
│   ├── api/                     # Hono API routes (EXISTING — adapt)
│   ├── db/                      # SQLite persistence (EXISTING — feature-flag, don't delete)
│   ├── auth/                    # Session middleware (EXISTING — keep)
│   ├── dashboard/               # Dashboard routes (EXISTING — adapt)
│   ├── ws/                      # WebSocket server (EXISTING — keep)
│   ├── telegram/                # Telegram bot (EXISTING — don't touch)
│   ├── callbacks/               # SIGINT integration (EXISTING — don't touch)
│   ├── cli/                     # CLI commands (NEW — MVP)
│   │
│   ├── orchestrator/            # Mission orchestration (EXISTING)
│   ├── gates/                   # Control gates (EXISTING)
│   ├── stream/                  # Stream supervision (EXISTING)
│   ├── monitors/                # Health monitors (EXISTING)
│   ├── director/                # Director LLM service (EXISTING)
│   ├── analyst/                 # Analyst service (EXISTING)
│   ├── dispatch/                # Mission dispatch (EXISTING)
│   ├── identity/                # Persona/SSOP (EXISTING)
│   ├── vector/                  # VECTOR Method / Oath (EXISTING)
│   ├── nats/                    # NATS JetStream (EXISTING — not required for MVP)
│   ├── mcp/                     # MCP server (EXISTING)
│   ├── types/                   # Shared type definitions
│   └── utils/                   # Logger, helpers
│
├── scripts/
│   ├── seed-agents.ts           # Migration: ROSTER.md YAML → agent folders (NEW)
│   └── ...
│
├── tests/                       # Vitest test files
├── data/                        # Runtime data (SQLite DB, logs)
├── gateways/                    # Gateway configs
├── deploy/                      # Deployment configs
└── infrastructure/              # IaC
```

---

## Scope Boundary — What VALOR Is and Is Not

VALOR is a **standalone orchestration engine**. No hard dependencies on other SIT projects:

- **Engram** — Optional. When installed, agents get per-agent memory via `engram-bridge.ts`. When not installed, `nullEngramAdapter` silently no-ops. Do not add as hard dependency.
- **Herd** — Not part of VALOR. The Ollama adapter speaks standard Ollama HTTP API. Works with bare Ollama, Herd, or any compatible proxy.
- **Operative** (the standalone package) — Not part of VALOR. VALOR has its own identity layer.

A user who installs VALOR and points it at an Anthropic API key should have a fully functional engine with zero additional SIT dependencies.

---

## Coding Standards

### TypeScript
- Strict mode — no `any`, no `as any`, no type assertions unless absolutely necessary
- All imports use `.js` extension (ESM): `import { foo } from './bar.js'`
- Use `unknown` instead of `any` for untyped data, then narrow with type guards
- Use `readonly` where possible

### File I/O
- **Atomic writes only.** Write to `{file}.tmp`, then `fs.rename()`. Never write in place.
- Markdown parsing should be simple string splitting — no heavy Markdown AST libraries.
- All file paths resolved relative to project root or config-specified directories.

### Logging
- NEVER use `console.log`, `console.warn`, or `console.error`
- Always use `import { logger } from '../utils/logger.js'`
- Include structured context: `logger.info('Agent loaded', { agentId, tier, division })`

### Testing
- Every source file gets a test file: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
- Use `describe`/`it` blocks with clear names
- Mock provider API calls — never make real API calls in unit tests
- Test both happy path and error cases

### Dependencies
- No new dependencies unless absolutely necessary
- No LangChain, no CrewAI, no AutoGen — this is purpose-built
- Git default branch is always `main` (never `master`)

---

## Key Existing Components

### Operative Loop (`src/execution/`)
The core of VALOR. Fully implemented. **Adapt, don't rewrite.**

- `OperativeAgent` — runs Observe→Plan→Act→Validate→Reflect→Evolve
- `runIteration()` — single loop pass
- `runMission()` — full loop until terminal state (completed/failed/escalated/iteration_limit)
- Budget enforcement via `actCyclesUsed` against `config.autonomy.budget`
- Evolve runs periodically (every 10 iterations)
- Sitreps published to event bus after every phase

### Provider Layer (`src/providers/`)
- `ProviderAdapter` interface with `complete()` method
- `createClaudeAdapter()` — Anthropic SDK
- `createOllamaAdapter()` — standard HTTP, works with Ollama/Herd/any compatible
- `registerProvider()` / `getBestProvider()` / `healthCheckAll()`
- Model resolution: `config.modelAssignment[taskType]` per agent

### Event Bus (`src/bus/`)
- `publish(envelope: EventEnvelope)` / `subscribe(type, handler)`
- Typed envelopes with source, target, payload, metadata
- Used for sitreps, mission events, agent status changes

### Engram Bridge (`src/execution/engram-bridge.ts`)
- `createEngramAdapter(agentId, callsign)` — real Engram when available
- `readOnlyAdapter(adapter)` — for sub-agents
- `nullEngramAdapter` — silent no-op fallback
- Background ticks: `tickExtraction()` (60s), `tickReflection()` (300s)

### SQLite (`src/db/`)
- Migrations, repositories for agents/missions/divisions/etc.
- **Being feature-flagged for MVP**, not deleted
- Will be re-enabled post-MVP for indexed queries

---

## What Needs Building (MVP)

See `docs/MVP-SCOPE.md` "What Needs Building" for the full checklist. Summary:

1. **Agent Folder Store** — `src/store/agent-store.ts`
   - AgentLoader, AgentWriter, AgentDiscovery, RosterManager

2. **Mission Folder Store** — `src/store/mission-store.ts`
   - MissionLoader, MissionWriter, MissionManager

3. **Seed Migration** — `scripts/seed-agents.ts`
   - Explode ROSTER.md YAML → agent folder structure

4. **Operative Loop Integration**
   - Wire folder stores into `executeInternalMission()`
   - Phases read/write agent memory + mission files

5. **API Route Adaptation**
   - CRUD against folders + roster rebuild
   - Feature-flag SQLite behind `config.storeBackend`

6. **CLI Commands** — `src/cli/`
   - `valor agent create/list`, `valor mission create/assign`, `valor status`

---

## Quick Reference

```bash
# Install
npm install

# Dev (watch mode)
npm run dev

# Start
npm start

# Tests
npm test
npm run typecheck

# Director service
npm run director:dev

# Inject a test mission
npm run inject
```

---

## Configuration

### Environment (`.env`)
```bash
VALOR_PORT=3200
VALOR_DB_PATH=./data/valor.db
LOG_LEVEL=info

# Providers (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_BASE_URL=http://localhost:11434

# Director
DIRECTOR_MODEL=gemma3:27b

# Optional
NATS_URL=nats://localhost:4222
SIGINT_URL=http://localhost:8082
DISABLED_GATES=
```

---

## Agent Roster

8 operatives defined in `agents/ROSTER.md`:

| Callsign | Role | Tier | Division |
|----------|------|------|----------|
| GAGE | Code Division Lead | 1 | Code |
| MIRA | Chief of Staff | 1 | Command |
| FORGE | Developer | 2 | Code |
| EDDIE | SIT Division Lead | 1 | SIT |
| ZEKE | Ranch Operations | 2 | Ranch |
| ROOK | R&D / Red Team | 1 | R&D |
| HERBIE | Financial Operations | 2 | Finance |
| PALADIN | Autonomous Ops | 2 | Autonomous |

See each agent's folder under `agents/` for full persona, agent config, tools, and memory.

---

*"We don't just complete missions. We validate, act, learn, optimize, and report."*
