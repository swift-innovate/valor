# VALOR Engine — Agent Team Prompt

> Copy this into Claude Code as the project prompt when using `/agent-team` mode.
> It references `docs/MVP-SCOPE.md` for the full spec — agents should read that file.

---

## System Prompt

```
You are implementing the VALOR Engine MVP — a folder-based agent runtime built in TypeScript (Node.js 20+, ESM, Hono, Zod, better-sqlite3).

## Project Context

VALOR is an agent orchestration engine. The MVP introduces a "folder-is-the-agent" model where each agent is a directory of structured Markdown files, and each mission carries its own memory independently of the agent executing it.

**Read `docs/MVP-SCOPE.md` first.** It is the authoritative spec for this work. Everything below is a summary to orient you.

## What Already Exists (do not rebuild)

The codebase has working infrastructure. Your job is to adapt it, not replace it.

- **Operative loop** (`src/execution/operative-agent.ts`, `src/execution/phases.ts`) — fully implemented Observe→Plan→Act→Validate→Reflect→Evolve cycle with typed results, budget enforcement, rolling history. This is solid. Adapt, don't rewrite.
- **Provider layer** (`src/providers/`) — Claude + Ollama adapters, provider registry, health checks. Keep as-is.
- **Event bus** (`src/bus/event-bus.ts`) — typed publish/subscribe. Keep as-is.
- **Engram bridge** (`src/execution/engram-bridge.ts`) — optional, degrades to nullEngramAdapter. Leave the bridge, don't depend on it.
- **Sub-agent fan-out** (`src/execution/subagent.ts`) — parallel dispatch with read-only memory. Keep as-is.
- **Telegram gateway** (`src/telegram/`) — operational. Don't touch.
- **SIGINT integration** (`src/callbacks/`) — operational. Don't touch.
- **Auth** (`src/auth/`) — basic session middleware. Keep as-is.
- **Hono server + API routes** (`src/api/`, `src/index.ts`) — 15+ route groups on port 3200. Adapt, don't replace.
- **Dashboard / WebSocket** (`src/dashboard/`, `src/ws/`) — operational. Adapt.
- **SQLite persistence** (`src/db/`) — being replaced by folder model for MVP, but DO NOT DELETE. It will be feature-flagged.
- **Agent roster** (`agents/ROSTER.md`) — 8 agents with YAML capability blocks. Will be migrated to folder structure.

## What Needs Building

### 1. Agent Folder Store (`src/store/agent-store.ts`)
- `AgentLoader.fromDirectory(agentPath)` — reads `agents/{id}/persona.md`, `rules.md`, `tools.md` → returns hydrated `OperativeConfig`
- `AgentWriter.writeMemory(agentPath, phase, content)` — atomic writes to `memory/working.md`, `memory/reflections.md`, `memory/long-term.md`
- `AgentDiscovery.scan(agentsDir)` — reads directory, validates each subfolder has `persona.md`, returns agent list
- `RosterManager.rebuild(agentsDir)` — regenerates `agents/ROSTER.md` from all agent folders

### 2. Mission Folder Store (`src/store/mission-store.ts`)
- `MissionLoader.fromDirectory(missionPath)` — reads `missions/{id}/brief.md`, `decisions.md`, `progress.md` → returns hydrated `MissionBrief`
- `MissionWriter.appendDecision(missionPath, decision)` — append to `decisions.md`
- `MissionWriter.appendProgress(missionPath, entry)` — append to `progress.md`
- `MissionWriter.writeHandoff(missionPath, summary)` — write `handoff.md`
- `MissionManager.create(title, objective)` — generates mission folder with `brief.md`
- `MissionManager.assign(missionId, agentId)` — updates `brief.md` assigned agent
- `MissionManager.complete(missionId)` — writes handoff, updates status

### 3. Seed Migration Script (`scripts/seed-agents.ts`)
- Parse existing `agents/ROSTER.md` YAML blocks
- Generate folder structure per agent: `persona.md`, `rules.md`, `tools.md`, `memory/` directory
- Rebuild `ROSTER.md` in new cached-index format

### 4. Operative Loop Integration
- Wire `AgentLoader` into `executeInternalMission()` replacing `getAgent()` from SQLite
- Wire `MissionLoader` into `executeInternalMission()` replacing `getMission()` from SQLite
- Observe phase: inject agent `memory/working.md` + mission `brief.md` + `progress.md` as context
- Act phase: append outcomes to mission `progress.md`
- Reflect phase: append to agent `memory/reflections.md`, significant decisions to mission `decisions.md`
- Evolve phase: append to agent `memory/long-term.md`
- Mission terminal states: write `handoff.md`, update `brief.md` status
- All file writes: atomic (write temp file, rename)

### 5. API Route Adaptation (`src/api/`)
- Agent CRUD endpoints → read/write agent folders + trigger roster rebuild
- Mission CRUD endpoints → read/write mission folders
- Mission assignment → update `brief.md`, return mission context
- Status endpoint → aggregate from roster + active mission folders
- Feature-flag SQLite behind config: `config.storeBackend: 'folder' | 'sqlite'`

### 6. CLI Commands (`src/cli/`)
- `valor agent create {callsign}` — generate folder from template, rebuild roster
- `valor agent list` — read roster, print table
- `valor mission create "{title}"` — generate mission folder with brief.md
- `valor mission assign {mission_id} {callsign}` — update brief, log assignment
- `valor status` — aggregated health (agents, missions, providers)

## File Contracts

See `docs/MVP-SCOPE.md` "File Contracts" section for the exact Markdown format of:
- `persona.md`, `rules.md`, `tools.md` (agent files)
- `memory/working.md`, `memory/reflections.md`, `memory/long-term.md`
- `brief.md`, `decisions.md`, `progress.md`, `handoff.md` (mission files)
- `ROSTER.md` (cached index format)

These formats are the contract. Loaders must parse them. Writers must produce them.

## Architecture Rules

- **TypeScript strict mode.** No `any`, no `as any`. Use `unknown` + type guards.
- **ESM modules.** All imports use `.js` extension.
- **Zod for validation.** Parsed Markdown fields validate through Zod schemas.
- **Atomic file writes.** Write to `{file}.tmp`, then `fs.rename()`. Never write in place.
- **No new dependencies** unless absolutely necessary. The stack is Hono + Zod + better-sqlite3 + provider SDKs.
- **Engram stays optional.** Never add it as a hard dependency. The nullEngramAdapter pattern continues.
- **SQLite stays in the codebase.** Feature-flag it, don't delete it.
- **Git default branch is `main`** (never `master`).
- **Structured logging only.** Use `logger` from `src/utils/logger.ts`. No `console.log`.

## Agent Team Task Assignment

Divide work by module boundary. Each agent owns one vertical slice:

**Agent 1 — Agent Store + Seed Migration (Phases 1 + 3)**
- `src/store/agent-store.ts` (AgentLoader, AgentWriter, AgentDiscovery, RosterManager)
- `scripts/seed-agents.ts`
- Tests: `tests/store/agent-store.test.ts`

**Agent 2 — Mission Store (Phase 2)**
- `src/store/mission-store.ts` (MissionLoader, MissionWriter, MissionManager)
- Tests: `tests/store/mission-store.test.ts`

**Agent 3 — Operative Loop Integration (Phase 4)**
- Modify `src/execution/index.ts` `executeInternalMission()` to use folder stores
- Modify `src/execution/phases.ts` to read/write agent and mission files
- Depends on: Agent 1 + Agent 2 outputs (interfaces only — can stub)
- Tests: `tests/execution/folder-integration.test.ts`

**Agent 4 — API Routes + CLI (Phases 5 + 6)**
- Modify `src/api/` routes to use folder stores
- Create `src/cli/` with commander or yargs
- Feature-flag config: `config.storeBackend`
- Depends on: Agent 1 + Agent 2 outputs (interfaces only — can stub)
- Tests: `tests/api/folder-routes.test.ts`, `tests/cli/commands.test.ts`

Agents 1 and 2 can work in parallel. Agents 3 and 4 depend on interfaces from 1 and 2 but can stub them and work in parallel with each other.

## Definition of Done

- All new code has tests (vitest)
- `npm run typecheck` passes with zero errors
- `npm test` passes
- Agent folder CRUD works: create agent folder, read it back, modify memory, read updated memory
- Mission folder CRUD works: create mission, assign, append progress/decisions, complete with handoff
- Operative loop reads from folders and writes back to folders
- ROSTER.md regenerates correctly on agent changes
- SQLite code is feature-flagged, not deleted
- Existing Telegram/SIGINT/auth/dashboard continue to function
```

---

## Usage

```bash
# In the valor-engine project root:
claude --agent-team

# Or paste the prompt above into your Claude Code session and run:
# /agent-team
```
