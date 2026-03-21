# VALOR Mission Board

Last updated: 2026-03-21T16:45:00Z
Updated by: VALOR/Gage

---

## Queued

### VM-001: NATS Subject Schema Design
- **Assigned:** Crazy-Eddie
- **Priority:** P1
- **Branch:** mission/VM-001
- **Depends on:** None
- **Description:** Create `docs/nats-subjects.md` documenting the full NATS subject hierarchy for VALOR. Include subject patterns, message payload schemas (TypeScript interfaces), and examples for: mission dispatch, sitreps, comms, system heartbeat, analyst review loop. Reference the Phase 1 plan for architecture context.
- **Acceptance:** Document is comprehensive enough for Gage to implement the TypeScript client against. All message types have defined interfaces. Subject naming conventions are documented.
- **Status:** Queued
- **Updated:** 2026-03-21

---

## In Progress

<!-- No missions currently in progress -->

---

## Blocked

<!-- Missions waiting on dependencies -->

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

### VM-002: NATS TypeScript Client Module
- **Assigned:** Gage
- **Priority:** P1
- **Branch:** mission/VM-002
- **Depends on:** VM-001 (NATS schema doc)
- **Description:** Install `nats` npm package in valor-engine. Create `src/nats/client.ts` with: connection manager, typed publish/subscribe helpers per message schema, JetStream consumer setup, reconnect handling. Follow interfaces defined in VM-001.
- **Acceptance:** Module compiles, connects to local NATS, can pub/sub on all defined subjects. Basic integration test suite.
- **Status:** Review
- **Updated:** 2026-03-21 16:45Z
- **Notes:** Complete. 6 files in src/nats/: types, client, streams, publishers, consumers, barrel export. model_tier aligned to local|efficient|balanced|frontier. Uses @nats-io v3.3.x packages. Typechecks clean.

### VM-007: Director Safety Gate Implementation Spec
- **Assigned:** Crazy-Eddie
- **Priority:** P1
- **Branch:** mission/VM-007
- **Depends on:** VM-005 (benchmark analysis)
- **Description:** Design pre-LLM safety gate system. Pattern-based checks that run before Director sees a mission. P0 (financial), P1 (mass comms/destructive), P2 (public publish). Includes bypass mechanism and test cases.
- **Acceptance:** Gage can implement the gate runner from this spec alone.
- **Status:** Review
- **Updated:** 2026-03-21
- **Deliverable:** `docs/safety-gates.md`

---

## Done

<!-- Merged to main. Archive to missions/completed/ after 7 days -->

### VM-004: Operative Manifest and Roster
- **Assigned:** Mira
- **Priority:** P2
- **Branch:** mission/VM-004 (merged)
- **Completed:** 2026-03-21
- **Deliverable:** `agents/ROSTER.md`
- **Summary:** Complete capability manifest for all 8 VALOR operatives (Mira, Crazy-Eddie, Forge, Gage, Zeke, Rook, Herbie, Paladin). YAML frontmatter format with capabilities, domain keywords, model tier preferences, tool access, escalation rules, and limitations. Safety-critical escalation patterns documented for Director hard-coding.

### VM-005: Director Benchmark Analysis
- **Assigned:** Mira
- **Priority:** P1
- **Branch:** mission/VM-005 (merged)
- **Completed:** 2026-03-21
- **Deliverable:** `docs/director-model-selection.md`
- **Summary:** Comprehensive analysis of 7 local LLM models for Director role. **Final recommendation: Gemma3:27B (single-gear architecture)** — 79/98 (80.6%), 7.5s latency, best decomposition among reliable models. Alternative: Qwen3:8B + Nemotron dual-gear. Critical safety finding: hard-coded pre-LLM gates REQUIRED for financial transactions, mass communications, destructive operations, public content. Document includes complete analysis, failure modes, safety gate implementation examples.
