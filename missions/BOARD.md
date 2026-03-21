# VALOR Mission Board

Last updated: 2026-03-21T14:45:00Z  
Updated by: VALOR/Eddie

---

## Queued



### VM-004: Operative Manifest and Roster
- **Assigned:** Mira
- **Priority:** P2
- **Branch:** mission/VM-004
- **Depends on:** None
- **Description:** Create `agents/ROSTER.md` with a structured capability manifest for each operative. Include: name, callsign, division, capabilities (tagged list), preferred model tier, tool access level, escalation rules, domain keywords for routing. This manifest feeds the Director's system prompt.
- **Acceptance:** All 8 operatives documented. Format is human-readable AND parseable (YAML frontmatter per operative section). Tom approves accuracy.
- **Status:** Queued
- **Updated:** 2026-03-21

---

## In Progress

### VM-005: Director Benchmark Analysis
- **Assigned:** Mira
- **Priority:** P1
- **Branch:** mission/VM-005
- **Depends on:** Benchmark results from CITADEL (running now)
- **Description:** Analyze benchmark scorecard results when available. Write `docs/director-model-selection.md` with: score comparison table, latency analysis, category-by-category breakdown, Gear 1 vs Gear 2 recommendation, failure mode notes per model.
- **Acceptance:** Clear model recommendation backed by data. Tom approves selection.
- **Status:** Blocked — awaiting benchmark completion
- **Updated:** 2026-03-21
- **Notes:** Benchmark script running on CITADEL against qwen3, deepseek-r1, llama4:scout, nemotron-cascade-2. Results will land in `results/scorecard_*.md`.

---

## Blocked

<!-- Missions waiting on dependencies -->

### VM-002: NATS TypeScript Client Module
- **Assigned:** Gage
- **Priority:** P1
- **Branch:** mission/VM-002
- **Depends on:** VM-001 (NATS schema doc)
- **Description:** Install `nats` npm package in valor-engine. Create `src/nats/client.ts` with: connection manager, typed publish/subscribe helpers per message schema, JetStream consumer setup, reconnect handling. Follow interfaces defined in VM-001.
- **Acceptance:** Module compiles, connects to local NATS, can pub/sub on all defined subjects. Basic integration test suite.
- **Status:** Blocked on VM-001
- **Updated:** 2026-03-21

### VM-003: Agent-Tick NATS Consumer Prototype
- **Assigned:** Gage
- **Priority:** P2
- **Branch:** mission/VM-003
- **Depends on:** VM-002
- **Description:** Create a reference agent-tick consumer in TypeScript that subscribes to `valor.missions.<operative>.pending`, acknowledges pickup, executes a stub task, and publishes a sitrep. This becomes the template for wiring all operatives.
- **Acceptance:** Prototype picks up a published test mission and returns a sitrep through NATS.
- **Status:** Blocked on VM-002
- **Updated:** 2026-03-21

---

## Review

<!-- Completed work awaiting review/merge -->

### VM-001: NATS Subject Schema Design
- **Assigned:** Crazy-Eddie
- **Priority:** P1
- **Branch:** mission/VM-001
- **Depends on:** None
- **Description:** Create `docs/nats-subjects.md` documenting the full NATS subject hierarchy for VALOR. Include subject patterns, message payload schemas (TypeScript interfaces), and examples for: mission dispatch, sitreps, comms, system heartbeat, analyst review loop. Reference the Phase 1 plan for architecture context.
- **Acceptance:** Document is comprehensive enough for Gage to implement the TypeScript client against. All message types have defined interfaces. Subject naming conventions are documented.
- **Status:** Review
- **Updated:** 2026-03-21
- **Deliverable:** `docs/nats-subjects.md`

---

## Done

<!-- Merged to main. Archive to missions/completed/ after 7 days -->
