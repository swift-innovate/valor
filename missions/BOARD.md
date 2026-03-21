# VALOR Mission Board

Last updated: 2026-03-21T18:35:00Z
Updated by: VALOR/Mira

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

### VM-014: Telegram Gateway NATS Bridge
- **Assigned:** Mira
- **Priority:** P1
- **Branch:** mission/VM-014
- **Depends on:** VM-001 (NATS schema), VM-002 (NATS client)
- **Description:** Update Telegram gateway to communicate through NATS instead of direct HTTP to Director. Publish `/mission` to `valor.missions.inbound`, `/status` to `valor.system.status`, `/ask` and free text to `valor.comms.direct.principal.mira`. Subscribe to `valor.sitreps.>` and `valor.system.events` for updates.
- **Acceptance:** Gateway bridges Telegram <-> NATS. No direct coupling to Director. Principal can dispatch missions and receive sitreps via Telegram.
- **Status:** Review
- **Updated:** 2026-03-21 17:30Z
- **Notes:** COMPLETE. Gateway fully implemented at `gateways/telegram/`. New types at `src/types/nats.ts`. Schema updated with `valor.missions.inbound` subject. Ready for integration with live NATS (VM-008). Thin bridge pattern - no business logic. Principal-only security.

### VM-015: Analyst Agent Review Loop
- **Assigned:** Crazy-Eddie
- **Priority:** P2
- **Branch:** mission/VM-015 (merged)
- **Depends on:** VM-002 (NATS client)
- **Description:** Analyst agent with multi-model review verdict.
- **Status:** Review
- **Updated:** 2026-03-21 18:30Z

### VM-016: Mission Control Dashboard NATS Integration
- **Assigned:** Mira
- **Priority:** P2
- **Branch:** mission/VM-016
- **Depends on:** VM-001 (NATS schema), VM-002 (NATS client)
- **Description:** Update Mission Control (Hono dashboard at src/dashboard/) to display real-time data from NATS. Replace static DB queries with live NATS subscriptions. Implement: NATS subscriber, in-memory state manager, SSE endpoint for push updates, live Overview page (fleet status, recent missions, activity feed), live Missions page (full board with filters).
- **Acceptance:** Dashboard displays real-time mission updates, operative heartbeats, sitreps, and system events from NATS. No polling. SSE push architecture. Connection status indicator.
- **Status:** Review
- **Updated:** 2026-03-21 18:30Z
- **Notes:** COMPLETE. NATSSubscriber connects on startup, NATSStateManager maintains in-memory state, SSE endpoint at /dashboard/sse, live Overview and Missions pages with auto-reconnect. Documentation at docs/dashboard-nats-integration.md. Ready for live NATS testing.

### VM-019: VALOR Operational Readiness Checklist
- **Assigned:** Mira
- **Priority:** P1
- **Branch:** mission/VM-019
- **Depends on:** None (audit of completed work)
- **Description:** Create comprehensive operational readiness document that answers: "Is VALOR ready for Tom to use as his daily command system?" Audit and document: startup procedure, health verification, known gaps, day-one workflow, backup/recovery, migration plan (workstation → Proxmox VM), outstanding issues from all completed missions.
- **Acceptance:** Clear yes/no answer with supporting evidence. If no, documented gap to production with prioritized action items and timeline.
- **Status:** Review
- **Updated:** 2026-03-21 13:00Z
- **Notes:** COMPLETE. Comprehensive readiness audit at `docs/operational-readiness.md`. **Answer: No, not ready yet.** Gap to production: 1-2 weeks (P0 items: Director LLM, NATS systemd, agent-tick deployment, E2E test). Covers all 7 required areas: startup (manual, no automation), health checks (NATS validation scripts), gaps (Director not running, agent-tick not deployed), workflow (current 15-30 min/mission vs. vision 3 min), backup (JetStream persists, no backup strategy), migration (4-7 hour estimate to Proxmox VM), outstanding issues (from VM-002 to VM-016). Priority action items: 4 P0 tasks, 4 P1 tasks, 4 P2 tasks. Recommendation: Focus on P0 first, then migrate to VM.

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
