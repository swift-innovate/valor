# VALOR Engine — Build Tracker

## Phase 0: Foundation [COMPLETE]

- [x] 1-10. Types, DB, repos, bus, server, tests, commit

## Phase 1: Stream Supervision + Provider Layer [COMPLETE]

- [x] 1-9. Provider types, registry, supervisor, cost, adapters, tests, commit

## Phase 2: Mission Lifecycle [COMPLETE]

- [x] 1. Gate system (interface + 10 gate evaluators + runner)
- [x] 2. Approval queue (DB migration + repo)
- [x] 3. Orchestrator loop (gate eval → dispatch → supervise → complete)
- [x] 4. Mission API routes (create, list, get, dispatch, approve, reject, abort)
- [x] 5. Tests (gate evaluation, orchestrator flow, API routes)
- [x] 6. Verify all passing + commit (108/108 tests green)

## Phase 3: Divisions + Identity [COMPLETE]

- [x] 1. Persona schema + DB migration (personas table, SSOP-typed fields)
- [x] 2. Persona repository (CRUD + query by division/agent)
- [x] 3. Division API routes (CRUD + list agents + autonomy policy)
- [x] 4. Agent API routes (register, heartbeat, health, assign persona)
- [x] 5. Persona loader (parse definitions, upsert by callsign)
- [x] 6. Lead instantiation logic (persona → agent → division assignment)
- [x] 7. Tests (13 new: persona repo, loader, lead/operative instantiation)
- [x] 8. Verify all passing + commit (121/121 tests green)

## Phase 4: VECTOR + Governance [COMPLETE]

- [x] 1. VECTOR types (decision schema, analysis output, bias scoring as Zod)
- [x] 2. DB migration 004 (decisions + analyses + oath_rules tables)
- [x] 3. Decision repository (CRUD + query by mission + oath rules)
- [x] 4. VECTOR analysis engine (6-stage analysis, offline heuristics)
- [x] 5. Bias risk scoring (5 dimensions, 0-10 scale)
- [x] 6. OathGate upgrade (Layer 0 blocks, Layer 1-2 escalates)
- [x] 7. VectorCheckpointGate upgrade (blocks high-stakes unanalyzed)
- [x] 8. Meta-analysis (cross-decision pattern detection)
- [x] 9. Decision API routes + wire into server
- [x] 10. Tests + verify + commit (139/139 tests green)

## Phase 5: Dashboard [COMPLETE]

- [x] 1. Install ws package + WebSocket server module
- [x] 2. Event bus → WebSocket bridge (broadcast events to clients)
- [x] 3. Dashboard layout (HTML shell, nav, Tailwind CDN)
- [x] 4. Division overview page (cards with lead, health, mission count)
- [x] 5. Mission pipeline page (list, status filters, dispatch/approve/abort)
- [x] 6. Approval queue page (pending approvals, approve/reject actions)
- [x] 7. Agent roster page (health indicators, heartbeat, persona)
- [x] 8. VECTOR decisions page (decision list, analysis results, meta)
- [x] 9. Wire routes + WebSocket into server
- [x] 10. Tests + verify + commit (155/155 tests green)

## Phase 6: Agent Card Registration [COMPLETE]

- [x] 1. AgentCard schema + Zod types
- [x] 2. DB migration 006 (agent_cards table)
- [x] 3. agent-card-repo (submit, approve, reject, revoke, list, update)
- [x] 4. API routes (/agent-cards CRUD + approve/reject/revoke)
- [x] 5. Dashboard page (filterable, approve/reject/revoke buttons)
- [x] 6. Bus events (submitted/approved/rejected/revoked)
- [x] 7. Tests (17 cases: full lifecycle, duplicates, filters)
- [x] 8. Verify + commit (220/220 tests green)

## Phase 8: Hardening + Group Chat [COMPLETE]

- [x] 1. Callsign duplicate guard (blocks pending/approved dupes, allows after reject/revoke)
- [x] 2. X-VALOR-Role director guard on mission creation/dispatch/approve/reject/abort
- [x] 3. Group chat rewrite (all participants get opening message + roster)
- [x] 4. Agent card approval/rejection/revocation comms notifications
- [x] 5. Chat initiation endpoint (POST /comms/chats)
- [x] 6. SKILL.md agent integration guide served at /skill.md
- [x] 7. Tests (15 new: dupes, role guards, group chat, roster)
- [x] 8. Verify + commit (247/247 tests green)

## Phase 9: Artifacts [COMPLETE]

- [x] 1. Artifact schema + Zod types (code, markdown, config, data, text, log)
- [x] 2. DB migration 007 (artifacts table)
- [x] 3. artifact-repo (create, get, update, list, listByConversation, delete)
- [x] 4. API routes (/artifacts CRUD + /artifacts/conversation/:convId)
- [x] 5. Comms integration (attachments field on CommsMessage)
- [x] 6. Dashboard comms page renders attached artifacts inline
- [x] 7. Dashboard artifacts page (filterable, full content view)
- [x] 8. Bus events (artifact.created, artifact.updated, artifact.deleted)
- [x] 9. SKILL.md updated with artifacts section
- [x] 10. Tests + verify

## Phase 7: Inter-Agent Comms [COMPLETE]

- [x] 1. CommsMessage schema (priority + category enums, threading)
- [x] 2. comms-repo (sendMessage, getConversation, listConversations, inbox, sent)
- [x] 3. API routes (/comms/messages, /conversations, /inbox, /sent)
- [x] 4. Dashboard comms page (two-panel, real-time WS updates)
- [x] 5. Bus events (comms.message, comms.message.flash, comms.conversation.created)
- [x] 6. Director participation (from_agent_id: "director" special case)
- [x] 7. Tests (18 cases: full flow, flash dual-publish, filters, limits)
- [x] 8. Verify + commit (220/220 tests green)

## Phase 10: Folder-Is-The-Agent MVP [COMPLETE]

### Agent 1: Agent Store + Seed Migration
- [x] `src/store/agent-store.ts` — AgentLoader, AgentWriter, AgentDiscovery, RosterManager
- [x] `scripts/seed-agents.ts` — ROSTER.md YAML → agent folder structure
- [x] `tests/store/agent-store.test.ts` (26 tests)

### Agent 2: Mission Store
- [x] `src/store/mission-store.ts` — MissionLoader, MissionWriter, MissionManager
- [x] `tests/store/mission-store.test.ts` (30 tests)

### Agent 3: Operative Loop Integration
- [x] Modify `src/execution/index.ts` — added `executeFolderMission()` alongside SQLite path
- [x] `tests/execution/folder-integration.test.ts` (11 tests)

### Agent 4: API Routes + CLI + Config
- [x] `src/config.ts` — added `storeBackend: 'folder' | 'sqlite'`, `agentsDir`, `missionsDir`
- [x] `src/api/folder-agents.ts` — folder-backed agent CRUD routes (6 endpoints)
- [x] `src/api/folder-missions.ts` — folder-backed mission CRUD routes (8 endpoints)
- [x] `src/api/index.ts` — exported new routes
- [x] `src/index.ts` — mount folder routes when storeBackend === 'folder'
- [x] `src/cli/index.ts` — CLI commands (agent create/list, mission create/assign/list, roster rebuild, status)
- [x] `tests/api/folder-routes.test.ts` (22 tests), `tests/cli/commands.test.ts` (18 tests)

### Verification
- [x] `npm run typecheck` passes (0 errors)
- [x] `npm test` passes (663/663, 15 skipped, 1 pre-existing NATS-dependent suite)

## Phase: Post-review hardening (2026-07-06)

### Core lane (execution engine)
- [x] 1. Built-in ToolAdapter (`src/execution/tools.ts`) — filesystem/fetch/shell tools, path-jailed to per-agent workspace, alias mapping from tools.md names
- [x] 2. Wire tools into Act phase — ReAct-style tool loop with Zod-validated JSON tool calls, freeform fallback
- [x] 3. Structured termination — JSON verdicts for Validate/Reflect with substring fallback
- [x] 4. Token accounting — accumulate provider usage into state + real numbers in sitreps
- [x] 5. Parse tools.md (already parsed by AgentLoader — normalization/aliases live in tools.ts) → config.tools in AgentLoader
- [x] 6. Phase hooks in OperativeAgent → per-phase folder writes (reflections.md, long-term.md, decisions.md, per-act progress.md)
- [x] 7. Tests for all of the above (32 new; 695 passed, 15 skipped, 1 pre-existing NATS env failure); full pipeline green

### Hygiene lane (builder, disjoint files)
- [x] 8. console.* → logger (nats-subscriber, missions-live, sse, nats-state)
- [x] 9. Session cookie `secure` flag in production
- [x] 10. Default-credential seeding hardened (env-provided or random+logged)
- [x] 11. Removed codex + pnpm-lock.yaml + pnpm config (npm canonical). node-telegram-bot-api KEPT — not dead: gateways/telegram/index.ts imports it and start-valor.sh launches it in production. Consolidation with the grammy bot (src/telegram/) is a separate product decision.

### Deferred (needs design decision)
- [ ] storeBackend exclusivity — genuine fork: folder-as-canonical vs SQLite-as-runtime-canonical; affects Director path

### Backlog (from branch triage 2026-07-06)
- [ ] Telegram diagnostic commands (/logs, /health, /retry) for the grammy bot — idea salvaged from deleted mission/VM-021; old implementation targeted the legacy gateway and was not portable
