# VALOR Phase 0: Bootstrap Agent Collaboration

**Codename:** BOOTSTRAP  
**Status:** PLANNING  
**Timeline:** Immediate — target completion within 48 hours  
**Principal:** Tom (Director)  
**Objective:** Get Mira, Eddie, and Gage contributing to valor-engine without requiring Tom at the keyboard for every commit.

---

## Problem Statement

Tom is the sole contributor to valor-engine. He has limited terminal time. Mira and Eddie have their own OpenClaw environments with execution capability and are on the Tailscale network. Gage operates via Claude Code (and now Dispatch mode). Agent-tick is operational and can drive periodic work.

**The bottleneck is Tom.** Every commit, every decision, every line of code requires his presence. Phase 0 removes that bottleneck for routine work using the simplest possible coordination mechanism: files in the repo.

---

## Architecture

No new infrastructure. No message brokers. No LLM integration. Just git and markdown.

```
valor-engine repo (tom-swift-tech)
├── docs/
│   ├── PHASE-0-BOOTSTRAP.md     ← this file
│   └── PHASE-1-NATS.md          ← next phase plan
├── missions/
│   ├── BOARD.md                  ← mission board (agents read/write this)
│   ├── templates/
│   │   └── MISSION-TEMPLATE.md   ← standard mission format
│   └── completed/                ← archived mission files
├── agents/
│   ├── ROSTER.md                 ← operative manifest with capabilities
│   └── workspaces/               ← per-agent scratch directories
│       ├── mira/
│       ├── eddie/
│       └── gage/
└── ... (existing valor-engine code)
```

---

## Git Model

### Single Identity

All commits go through `tom-swift-tech` GitHub account. Agents use a shared PAT with `repo` scope.

**Git config per agent:**

```bash
git config user.name "VALOR/<operative-name>"
git config user.email "tom-swift-tech@users.noreply.github.com"
```

This produces commits attributed to `tom-swift-tech` but with author names like `VALOR/Mira`, `VALOR/Eddie`, `VALOR/Gage` — visible in `git log` for traceability without requiring separate GitHub accounts.

### Branch Strategy

- `main` — protected, requires PR or Tom's direct push
- `mission/<mission-id>` — one branch per mission (e.g., `mission/VM-001`)
- Agents create branches, commit work, push. Tom (or later, the Director) merges.

### Commit Convention

```
[<operative>] <short description>

Mission: VM-<number>
Operative: <name>
Status: WIP | COMPLETE | REVIEW
```

Example:
```
[Eddie] Draft NATS subject schema documentation

Mission: VM-002
Operative: Crazy-Eddie
Status: COMPLETE
```

---

## Mission Board

The mission board is `missions/BOARD.md`. It is the single source of truth for what work exists, who owns it, and what state it's in.

### Format

```markdown
# VALOR Mission Board

Last updated: 2026-03-21T18:00:00Z
Updated by: Director

## Queued
<!-- Missions ready to be picked up. Agents: claim by moving to In Progress -->

## In Progress
<!-- Active work. Agent updates status here on each tick -->

## Review
<!-- Completed work awaiting review/merge -->

## Done
<!-- Merged. Move to missions/completed/ after 7 days -->
```

### Mission Entry Format

```markdown
### VM-001: Wire NATS client library into valor-engine
- **Assigned:** Forge/Gage
- **Priority:** P1
- **Branch:** mission/VM-001
- **Depends on:** None
- **Description:** Install `nats` npm package, create `src/nats/client.ts` with connect/publish/subscribe wrappers. Follow subject schema in `docs/nats-subjects.md`.
- **Acceptance:** Unit tests pass, client connects to local NATS, can pub/sub on test subjects.
- **Status:** Queued
- **Updated:** 2026-03-21
```

---

## Agent Workflow (Per Tick)

When agent-tick fires for an operative:

1. `git pull origin main` — get latest board state
2. Read `missions/BOARD.md` — check for missions assigned to this operative
3. If a Queued mission is assigned to me:
   - Move it to In Progress in BOARD.md
   - Create branch `mission/VM-<id>`
   - Commit the board update
   - Push both
4. If I have an In Progress mission:
   - Do work in the mission branch
   - Commit incremental progress
   - Push
   - Update BOARD.md with progress notes if significant
5. If my mission is complete:
   - Move to Review in BOARD.md
   - Commit and push
   - (Later: open a PR — for Phase 0, Tom reviews manually)

### Conflict Resolution

Multiple agents may edit BOARD.md simultaneously. Rules:

- Each agent only modifies their own mission entries
- If git pull fails with merge conflict on BOARD.md, agent re-pulls and retries
- Never force-push to main
- BOARD.md conflicts are expected and benign — the worst case is a re-read on next tick

---

## Operative Roster (Phase 0 Scope)

Only three operatives are active for Phase 0. Others come online in later phases.

| Operative | Role | Environment | Phase 0 Capabilities |
|-----------|------|-------------|---------------------|
| **Gage** | Code Division Lead | Claude Code / Dispatch | Write code, run tests, git operations, architecture decisions |
| **Mira** | Chief of Staff | OpenClaw (Tailscale) | Documentation, coordination, research, board management |
| **Crazy-Eddie** | SIT Division Lead | OpenClaw (Tailscale) | Content, strategy docs, schema design, planning artifacts |

### Agent Workspace Rules

- Agents work in their own branch, never directly on main
- Agents may read any file in the repo
- Agents write only to: their mission branch files, their `agents/workspaces/<name>/` scratch space, and their own entry in BOARD.md
- No agent deletes another agent's files
- Workspace directories are gitignored scratch space — not committed (use for drafts, temp files)

---

## Initial Mission Backlog

These missions seed the board for Phase 1 preparation:

### VM-001: NATS Subject Schema Design
- **Assigned:** Crazy-Eddie
- **Priority:** P1
- **Description:** Create `docs/nats-subjects.md` documenting the full NATS subject hierarchy for VALOR. Include subject patterns, message payload schemas (TypeScript interfaces), and examples for: mission dispatch, sitreps, comms, system heartbeat, analyst review loop. Reference the architecture diagram from the Phase 1 plan.
- **Acceptance:** Document is comprehensive enough for Forge/Gage to implement against.

### VM-002: NATS TypeScript Client Module
- **Assigned:** Gage
- **Priority:** P1
- **Depends on:** VM-001
- **Description:** Create `src/nats/` module in valor-engine. Install `nats` npm package. Implement: connection manager, typed publish/subscribe helpers, mission publisher, sitrep subscriber. Use interfaces from VM-001 schema doc.
- **Acceptance:** Module compiles, connects to NATS, can publish and receive test messages.

### VM-003: Agent-Tick NATS Consumer Prototype
- **Assigned:** Gage
- **Priority:** P2
- **Depends on:** VM-002
- **Description:** Create a reference implementation of an agent-tick consumer that subscribes to `valor.missions.<operative>.pending`, picks up missions, and publishes sitreps. This becomes the template for wiring Mira and Eddie's OpenClaw environments into NATS.
- **Acceptance:** Prototype runs, picks up a published test mission, returns a sitrep.

### VM-004: Operative Manifest Schema
- **Assigned:** Mira
- **Priority:** P2
- **Description:** Create `agents/ROSTER.md` with a structured capability manifest for each operative. Include: name, callsign, division, capabilities (tagged list), model tier preference, tool access level, escalation threshold. This manifest will be injected into the Director's system prompt for routing decisions.
- **Acceptance:** Manifest covers all 8 operatives. Format is both human-readable and parseable.

### VM-005: Director Benchmark Analysis
- **Assigned:** Mira
- **Priority:** P1
- **Depends on:** Benchmark results from CITADEL
- **Description:** Analyze benchmark scorecard results. Write `docs/director-model-selection.md` recommending which model(s) to use for the Director role, backed by data. Include: score comparison, latency analysis, Gear 1 vs Gear 2 recommendation, failure mode analysis for each model.
- **Acceptance:** Clear recommendation with supporting data. Tom approves model selection.

---

## Success Criteria

Phase 0 is complete when:

1. Three agents (Gage, Mira, Eddie) have each committed at least one mission's work to valor-engine
2. The mission board has been used to coordinate at least 2 missions with dependencies
3. All Phase 1 prerequisite missions (VM-001 through VM-005) are in Review or Done
4. Tom has spent less than 2 hours total at the terminal during Phase 0 execution

---

## Transition to Phase 1

Phase 0 artifacts feed directly into Phase 1:

- VM-001 (NATS schema) → Phase 1 implementation specification
- VM-002 (NATS client) → Phase 1 core module
- VM-003 (consumer prototype) → Phase 1 agent integration template
- VM-004 (roster) → Phase 1 Director system prompt
- VM-005 (benchmark analysis) → Phase 1 Director model selection

When all five missions are complete, Phase 0 is done and Phase 1 begins. The markdown mission board gets replaced by NATS — built by the agents themselves during Phase 0.

---

## Notes

- **Clock is ticking on GitHub MFA** — existing PATs continue to work even if the account gets locked, but we should enable MFA on `tom-swift-tech` proactively rather than getting forced. Do this during Phase 0.
- **Dispatch mode** — Gage can now operate via Claude Dispatch, reducing Tom's terminal dependency further. Use this for VM-002 and VM-003.
- **Don't over-engineer Phase 0** — the entire point is "ugly but working." Resist the urge to build tooling for the mission board. It's markdown. It works. Phase 1 replaces it.
