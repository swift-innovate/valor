# VALOR Mission Board

Last updated: 2026-03-21T17:45:00Z
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

---

## Blocked

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

### VM-012: Director LLM Integration
- **Assigned:** Gage
- **Priority:** P0
- **Branch:** mission/VM-012
- **Depends on:** VM-005, VM-006, VM-007, VM-002
- **Description:** Build the Director's brain: safety gates, LLM adapter (Ollama), classifier (Gear 1/2 with confidence scoring), dispatcher (NATS publish). Full pipeline: mission text → gates → classify → dispatch.
- **Status:** Review
- **Updated:** 2026-03-21 17:45Z
- **Notes:** COMPLETE. 5 files in src/director/. Safety gates: 20/20 test cases from VM-007 spec pass. Classifier: dual-gear with JSON recovery. Dispatcher: ROUTE/DECOMPOSE/ESCALATE → NATS. Config fields added for model selection and confidence threshold.

### VM-008: Deploy NATS Server and Validate VM-002
- **Assigned:** Gage
- **Priority:** P0
- **Branch:** main
- **Depends on:** VM-002
- **Description:** Deploy nats-server, create JetStream streams, validate the NATS TypeScript client module end-to-end against a live server. Full lifecycle: publish mission, consume, publish sitrep.
- **Status:** Review
- **Updated:** 2026-03-21 17:15Z
- **Notes:** COMPLETE. 27/27 checks passed against nats-server v2.11.4. Full lifecycle validated: connect → streams → consumers → mission publish/consume → sitrep → review → heartbeat → comms → status request/reply → graceful shutdown. Validation script at `scripts/validate-nats.ts`.

### VM-002: NATS TypeScript Client Module
- **Assigned:** Gage
- **Priority:** P1
- **Branch:** mission/VM-002 (merged)
- **Depends on:** VM-001 (NATS schema doc)
- **Description:** Install `nats` npm package in valor-engine. Create `src/nats/client.ts` with: connection manager, typed publish/subscribe helpers per message schema, JetStream consumer setup, reconnect handling. Follow interfaces defined in VM-001.
- **Acceptance:** Module compiles, connects to local NATS, can pub/sub on all defined subjects. Basic integration test suite.
- **Status:** Review
- **Updated:** 2026-03-21 17:00Z
- **Notes:** Complete. 6 files in src/nats/: types, client, streams, publishers, consumers, barrel export. model_tier aligned to local|efficient|balanced|frontier. Uses @nats-io v3.3.x packages. Typechecks clean.

### VM-006: Director System Prompt Assembly
- **Assigned:** Mira
- **Priority:** P1
- **Branch:** mission/VM-006
- **Depends on:** VM-004 (Roster), VM-005 (Model Selection)
- **Description:** Draft the Director's complete system prompt for LLM inference.
- **Status:** Review
- **Updated:** 2026-03-21 15:40Z
- **Notes:** COMPLETE. System prompt at src/director/system-prompt.md.

### VM-007: Director Safety Gate Implementation Spec
- **Assigned:** Crazy-Eddie
- **Priority:** P1
- **Branch:** mission/VM-007
- **Depends on:** VM-005 (benchmark analysis)
- **Description:** Design pre-LLM safety gate system.
- **Status:** Review
- **Updated:** 2026-03-21
- **Deliverable:** `docs/safety-gates.md`

---

## Done

### VM-004: Operative Manifest and Roster
- **Assigned:** Mira
- **Priority:** P2
- **Branch:** mission/VM-004 (merged)
- **Completed:** 2026-03-21
- **Deliverable:** `agents/ROSTER.md`
- **Summary:** Complete capability manifest for all 8 VALOR operatives.

### VM-005: Director Benchmark Analysis
- **Assigned:** Mira
- **Priority:** P1
- **Branch:** mission/VM-005 (merged)
- **Completed:** 2026-03-21
- **Deliverable:** `docs/director-model-selection.md`
- **Summary:** Final recommendation: Gemma3:27B (single-gear architecture). Hard-coded pre-LLM gates REQUIRED.
