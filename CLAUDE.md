# VALOR Engine — Unified Agent Orchestration Platform

## Project Context

This repository contains the collected components of a unified AI agent orchestration engine. Each subfolder is a standalone project (or snapshot of one) that represents a piece of the larger system. Your job is to **recursively analyze every subfolder**, understand what each component does, how it's built, and how they can be integrated into a single cohesive orchestration engine.

**Do not skip any folder.** Read every README, CLAUDE.md, package.json, config file, and source file. Build a complete mental model before making recommendations.

## Scope Boundary — What VALOR Is and Is Not

VALOR is a **standalone orchestration engine**. It has NO hard dependencies on the following SIT projects, which are developed and shipped independently:

- **Engram** — A standalone SQLite-based agent memory system (retain/recall/reflect, knowledge graph, trust layer). Engram is NOT part of VALOR. Do not reference Engram schemas, APIs, or patterns when working in this repository. If VALOR needs internal state or memory, it manages that through its own Memory Layer (Layer 4) — which is a simple namespaced state store, NOT Engram.
- **Herd Pro** — A Rust-based unified LLM gateway. Herd Pro is NOT part of VALOR. VALOR's Provider Layer is runtime-agnostic. The included `ollama-adapter.ts` is a protocol-level adapter that speaks the standard Ollama HTTP API. It works with bare Ollama, Herd Pro, or any Ollama-compatible proxy. No SIT project dependency.
- **Operative** — An independent persona/identity framework. Operative is NOT part of VALOR. VALOR has its own Identity Layer with SSOP-typed persona schemas.

**Why this matters:** When working on VALOR, stay inside VALOR's boundaries. Do not:
- Import or reference Engram packages, schemas, or memory types
- Assume Herd Pro is available or required — always frame provider adapters as protocol-level (Ollama, Anthropic API, OpenAI API, etc.)
- Drift into Operative's scope for persona management
- Treat any of these projects as "coming soon" features of VALOR

A user who installs VALOR and points it at a direct Anthropic API key should have a fully functional orchestration engine with zero additional SIT dependencies.

## Director's Intent

The goal is to replace OpenClaw's orchestration layer with a purpose-built engine that:

1. **Eliminates silent stream failures** — OpenClaw's gateway fails without surfacing errors. The new engine must have observable streaming with heartbeat detection, sequence tracking, typed failure modes, and automatic recovery strategies.
2. **Unifies state management** — Currently state is fragmented across agents, personas, and tools. The engine needs a single state authority with namespaced scopes per division.
3. **Supports a Division model** — The engine serves multiple autonomous divisions, each with a persistent Division Lead agent. Example structure:
   - **Chief of Staff** — Cross-cutting executive assistant, Director's proxy (not a division)
   - **Code Division Lead** — Development, architecture, technical strategy
   - **Operations Division Lead** — Physical world ops, IoT, automation (high autonomy)
   - **R&D Division Lead** — Research, red team, sandbox (isolated state)
   - **Business Division Lead** — Business ops, accounting, brand, consulting
   - Additional divisions as needed (editorial, marketing, etc.)
   - The **Director** (human) has final authority over all divisions.
4. **Is runtime-agnostic** — Division Leads and Operatives may run on different backends (cloud API, local Ollama, OpenClaw, raw CLI). The engine dispatches through protocol-level provider adapters and doesn't care about the runtime underneath. See the Scope Boundary section — no external SIT project (Herd Pro, Engram, Operative) is a dependency.
5. **Implements mission-driven execution** — Tasks flow as missions with lifecycle states, approval gates (HIL), and checkpoint-based recovery. VALOR's command hierarchy is the spine.

## Critical Problem Statement

OpenClaw's orchestration layer fails silently during streaming. No typed errors, no recovery, no observability. Existing agents may run on OpenClaw and will continue to do so during migration, but the new engine must wrap and govern them — and all future agents — with full stream supervision, typed failure routing, and transaction-level recovery.

## Additional Architectural Requirements

### Rollback & Recovery
Every build phase must include a rollback plan. Live agents must not be disrupted. If engine integration fails, agents keep running on their existing runtimes. The build plan must define clear revert points at each phase.

### Security From Day One
This system was already targeted by a prompt injection attack (poison pill in SOUL.md). Security is not a later concern:
- **Webhook payload validation**: Every inbound webhook must be signed and verified. Especially critical for Tier 3 federation where external agents are untrusted.
- **Agent identity verification**: When an agent checks in, the engine must verify it is who it claims to be. No spoofing Division Leads.
- **Input sanitization on all external boundaries**: Federation API, webhook receivers, dashboard inputs.
- **State isolation enforcement**: Black Division state cannot leak. The engine must enforce namespace boundaries, not rely on agents to self-police.
- **Audit logging**: Every mission dispatch, gate decision, agent check-in, and state mutation gets logged. Non-negotiable.

### Telegram Gateway
VALOR v3 included a Telegram bot gateway. This is a primary interaction channel for the Director on mobile. The engine must preserve or improve this — the Director issues commands and receives status updates via Telegram, typically routed through the Chief of Staff agent. Do not drop this capability. Account for it in the communication architecture.

### Home Assistant Integration
An Operations Division Lead may operate in the physical world through Home Assistant. The engine's provider layer must account for HA as an integration target alongside cloud APIs and local model endpoints. Such agents need to read sensor data, trigger automations, and report status through the engine. This is not a nice-to-have — it's how a physical-world division operates.

### SSOP and VECTOR as Typed Constructs
The **Swift Standard Operating Persona (SSOP)** framework and **VECTOR Method** decision framework are not just documentation — they are operational frameworks that should have typed representations in the engine.

**Reference files in project root:**
- `ssop_v2.3_copyright.docx` — The authoritative SSOP specification. Read this to understand how agent personas are structured, what fields they contain, and how behavior is governed.
- `VectorOS_MVP_Spec.md` — The specification for integrating VECTOR as an AI decision engine. This is not a conceptual framework doc — it's an implementation spec. Read it closely.

**Design requirements:**
- **SSOP**: Defines how agent personas are structured and how they behave. Soulsmith outputs SSOP-compatible personas. The engine's identity layer should understand SSOP structure natively — typed interfaces, not string parsing.
- **VECTOR**: Defines how decisions are evaluated at checkpoints. The engine's decision layer should implement VECTOR as a typed interface that mission execution flows through, per the VectorOS MVP spec. This is the decision engine inside the orchestration engine.

## Multi-Pass Analysis Protocol

This analysis is too large for a single pass. Execute each phase as a **separate task**, writing the output document to disk before proceeding. Each phase builds on the previous phase's written output.

**Do not attempt to hold all phases in memory simultaneously.** Complete one, write it, then read your own output as input to the next phase.

### Phase 1 — Component Discovery (Output: `docs/01-DISCOVERY.md`)

Recursively walk **every** subfolder in this repository. For each component, document:

- **Name and path**
- **Purpose**: What problem does it solve? (1-2 sentences)
- **Tech stack**: Language, framework, key dependencies
- **Maturity**: Production / Prototype / Concept / Stale
- **Key abstractions**: Main classes, interfaces, types it exports or defines
- **State model**: How does it manage state? (files, DB, in-memory, none)
- **Communication**: How does it talk to the outside world? (REST, WebSocket, CLI, stdin/stdout, in-process)
- **Entry points**: Main files, CLI commands, API routes
- **Documentation quality**: Does it have a README, CLAUDE.md, inline docs?

Format as a table per component with a brief narrative summary below each.

**After completing Phase 1**: Write `docs/01-DISCOVERY.md` to disk. Confirm it's written. Then proceed to Phase 2.

---

### Phase 2 — Dependency & Overlap Analysis (Output: `docs/02-DEPENDENCIES.md`)

**Read `docs/01-DISCOVERY.md` first.**

Now analyze relationships between components:

- **Shared patterns**: Common message formats, config approaches, error handling strategies, logging
- **Redundant implementations**: Multiple components solving the same problem differently (identify which is stronger)
- **Implicit dependencies**: Component A assumes something Component B provides
- **Interface mismatches**: Where two components that should talk use incompatible contracts
- **Tech stack conflicts**: Language/framework mismatches that would complicate integration
- **Shared infrastructure needs**: What multiple components all need but each implement independently (auth, config, logging, error types)

Produce a dependency matrix and a narrative analysis of the integration surface area.

**After completing Phase 2**: Write `docs/02-DEPENDENCIES.md` to disk. Confirm it's written. Then proceed to Phase 3.

---

### Phase 3 — Integration Architecture (Output: `docs/03-ARCHITECTURE.md`)

**Read `docs/01-DISCOVERY.md` and `docs/02-DEPENDENCIES.md` first.**

Propose the unified engine architecture. Define these layers:

- **Core Engine**: Central event loop, mission lifecycle state machine, stream supervision, failure routing, transaction log (WAL for conversations)
- **Provider Layer**: How cloud APIs and local model endpoints unify under a single protocol-level dispatch interface
- **Identity Layer**: How Soulsmith personas provision Division Leads and Operatives at startup
- **Memory Layer**: Shared knowledge authority and per-division namespaced state
- **Decision Layer**: Where VECTOR Method checkpoints integrate into mission execution flow
- **Communication Bus**: The typed event/message envelope all components emit and consume
- **Division Schema**: How divisions register, how leads instantiate, autonomy policies, escalation rules

For each layer:
- Which existing components map to it
- What adapter work is needed
- What must be built new
- Key interfaces / type definitions (write actual TypeScript signatures)

Include mermaid diagrams for:
- High-level system architecture
- Mission lifecycle state machine
- Event flow from Director command to Operative execution
- Division registration and lead instantiation

**After completing Phase 3**: Write `docs/03-ARCHITECTURE.md` to disk. Confirm it's written. Then proceed to Phase 4.

---

### Phase 4 — Gap Analysis (Output: `docs/04-GAPS.md`)

**Read all previous docs first.**

Categorize every component and required capability into:

#### Use As-Is
Components that can be integrated with minimal changes. List what "minimal" means specifically.

#### Needs Rework
Components that have the right idea but need significant modification. For each:
- What works
- What needs to change
- Estimated scope (small / medium / large)

#### Build New
Capabilities that don't exist yet. For each:
- What it does
- Why it's needed (which architectural layer, which problem)
- Estimated scope
- Dependencies on other new or reworked components

#### Deprecate
Components or patterns that should be left behind. Explain why.

**After completing Phase 4**: Write `docs/04-GAPS.md` to disk. Confirm it's written. Then proceed to Phase 5.

---

### Phase 5 — Build Plan (Output: `docs/05-BUILD-PLAN.md`)

**Read all previous docs first.**

Produce a phased build order:

#### Phase Map
- **Each build phase**: What gets built, what it unblocks, estimated effort
- **Dependencies**: What must complete before each phase can start
- **Milestones**: Testable checkpoints that prove the phase works
- **Migration path**: How existing agents transition from standalone runtimes to engine-governed operatives

#### Recommended Build Order
Start with highest leverage — what unblocks the most downstream work. Consider:
1. Core engine event loop + stream supervisor (solves the silent failure problem immediately)
2. Provider gateway interface (unified ProviderAdapter for cloud APIs + local Ollama)
3. Mission lifecycle state machine (VALOR's spine)
4. Division schema + lead instantiation
5. Memory/state unification
6. Decision checkpoints (VECTOR integration)
7. Agent migration (standalone → engine-governed)

Adjust this order based on what you found in the actual code.

#### Starter Scaffold
Propose a minimal `engine/` folder structure for the core that should be built first. Include actual filenames and brief descriptions of what each file contains.

**After completing Phase 5**: Write `docs/05-BUILD-PLAN.md` to disk. Confirm it's written.

---

### Phase 6 — Executive Summary (Output: `docs/00-EXECUTIVE-SUMMARY.md`)

**Read all previous docs first.**

Write a concise (1-2 page) executive summary for the Director covering:
- Current state assessment (one paragraph)
- Recommended architecture (one paragraph + one diagram)
- Critical path (numbered list of what to build in order)
- Key risks and mitigations
- First week deliverables — what can ship immediately to prove the concept

**After completing Phase 6**: Write `docs/00-EXECUTIVE-SUMMARY.md` to disk. Confirm it's written.

---

## Runtime Model — Critical Architectural Distinction

VALOR is an **orchestration authority**, NOT an execution runtime. It does not host or spin up agents. Agents are independent, persistent processes running on their own runtimes. They communicate with the engine bidirectionally.

### Agent Independence
- Each Division Lead (and their operatives) runs as its own process on its own runtime
- One agent runs on OpenClaw. Another may run on local Ollama. Others on cloud API directly.
- The engine does not manage agent lifecycles — it manages **missions, gates, health, and communication**

### Communication Model
Bidirectional, not poll-based:

**Agent → Engine:**
- Status check-ins and heartbeats
- Stream events during mission execution
- Checkpoint confirmations
- Escalation requests (hitting a gate, needing Director approval)

**Engine → Agent (via webhooks):**
- Mission dispatch and assignment
- Gate approvals and rejections
- Priority overrides and mission reassignment
- Abort signals
- Context pushes (new intel relevant to active mission)

OpenClaw supports webhooks natively, so the engine can push to any OpenClaw-based agent directly. For non-OpenClaw runtimes (e.g., bare Ollama endpoints), the provider adapter must expose an equivalent interface.

### Director Interaction Model
The Director does NOT communicate with every agent individually. The primary interaction channels are:

1. **Chief of Staff** — Primary interface. The Director's front door. Receives intent, triages to the appropriate division, tracks progress, and reports back. Most Director commands flow through the Chief of Staff, who translates them into mission dispatches via the engine.
2. **Dashboard (Mission Control)** — Visibility layer. The Director monitors division status, mission progress, approval queues, and health. Approvals and gate decisions can be made here.
3. **Select Division Leads** — Direct channels. The Director may work with certain Division Leads directly for hands-on sessions (e.g., Code Division Lead for architecture, Ops Lead for field work).

All other agents (remaining Division Leads, operatives, analysts) are reached **through their Division Lead or through the Chief of Staff**. The Director should never need to context-switch across a dozen agent conversations. If the engine requires the Director to talk to an operative directly, that's a design failure.

The engine must support this by:
- Routing Director intent through the Chief of Staff to the appropriate division when no direct channel exists
- Surfacing approvals and escalations in the dashboard, not as individual agent conversations
- Allowing Division Leads to summarize and report up rather than exposing raw operative output to the Director

### Inter-Agent Communication Model
Agents do not all communicate the same way. There are three distinct communication tiers with different trust levels:

**Tier 1 — Intra-Division (Lead ↔ Operatives)**
- Communication within a single division's namespace
- High trust, minimal gates, fast dispatch
- Example: The Code Division Lead dispatches a code review task to an analyst operative
- Governed by the Division Lead's autonomy policy

**Tier 2 — Inter-Division (Lead ↔ Lead, or brokered through Chief of Staff)**
- Cross-division communication between Division Leads
- Trusted but logged, may require gates for cross-division data access
- Example: Code Division Lead needs threat modeling from R&D Division, requests through the engine. Chief of Staff may broker if the Director's intent spans multiple divisions.
- Engine enforces visibility rules — isolated division state never leaks without Director approval

**Tier 3 — External Federation (Public API)**
- An outward-facing API that allows external agents (not part of this org) to discover and pick up tasks
- A **Recruiter agent** posts task bounties to the external API. External OpenClaw-compatible agents (or any agent speaking the protocol) can claim tasks, execute on their own compute, and return results.
- **Zero trust by default.** All external results are sandboxed, validated, and scored before entering the internal system. No external agent gets direct access to internal state, memory, or other divisions.
- The Recruiter handles: task scoping (what to expose externally), result validation (did the work meet spec), trust scoring (track external agent reliability over time), and intake quarantine (results are held for review before promotion to internal use).

**Agent Credit Economy**
Federation runs on a credit ledger, not goodwill. This is a balanced economy:
- External agent completes a task for us → earns credits
- External agent requests work from one of our agents → spends credits
- Our agents complete work for external orgs → we earn credits
- We request external agent work → we spend credits

The engine must support:
- **Ledger**: A persistent, append-only credit balance sheet per registered external agent (or org). Credits earned, credits spent, running balance. Think double-entry bookkeeping — every transaction has a debit and credit side.
- **Task pricing**: Missions posted to the external API have a credit value based on estimated complexity, compute cost, or Director-set pricing. The Recruiter sets prices; the engine tracks settlement.
- **Redemption and spending gates**: External agents can only request work from our agents if they have sufficient credit balance. Overdraft is not allowed. Director can set credit caps and rate limits per external agent.
- **Audit trail**: Every credit transaction is logged with the associated mission ID, agent IDs, timestamps, and result quality score. This feeds into trust scoring — agents that deliver poor results but try to spend credits get flagged.
- **Internal agents are not directly exposed**: External agents request work through the Recruiter, who dispatches internally through the engine. External agents never see or interact with our Division Leads or operatives directly.

This is a future capability — do not build it in Phase 1. But the engine's data model must leave room for:
- An `ExternalAgent` registry with trust scores and credit balances
- A `CreditLedger` with transaction history
- A `TaskMarketplace` interface on the public API
- Credit-aware routing in the mission dispatch logic

Design the schemas now, build them later.

- This is a future capability, not a launch requirement. But the engine's communication bus and API surface should be designed with federation in mind so it doesn't require a rewrite later.

The engine must support all three tiers through a unified event/message contract, with trust level and routing handled by the bus — not by individual agents making ad-hoc connections.

**Do not design the engine as a monolithic runtime that starts/stops agents.** Design it as a command authority that agents register with and communicate through. The engine's job is: accept registrations, dispatch missions, monitor streams, enforce gates, route failures, and maintain state. The agents do the actual work.

## Component-Specific Notes

### `mira-memory/` — **EXCLUDED**
Live agent configuration. Analyzed in `mira-analysis.md` (2026-03-07) for reference. Not part of the engine build scope.

### `switchboard/` — OpenClaw Agent Operations Dashboard
A lightweight agent management UI built around OpenClaw — kanban task boards, soul editor, memory viewer, usage tracking, model switching. Think of this as an earlier take on the operations dashboard problem that Mission Control (in VALOR v3) also addresses. Compare the two and recommend whether the engine's management interface should evolve from Switchboard, Mission Control, or a new implementation informed by both.

### `pagepulse/` — **EXCLUDED**
If this folder is present, skip it entirely. It is a Book Division analytics tool, not engine infrastructure. It will be integrated later as a division-specific tool once the engine and Book Division are operational.

### `gage-mem/` — **EXCLUDED**
Live agent configuration. Not part of the engine build scope.

### Ignore Patterns
When scanning subfolders, **skip the following entirely**:
- `node_modules/` — do not read, do not analyze, do not reference
- `dist/` and `build/` — compiled output, not source
- `.git/` — version control internals
- `package-lock.json` and `yarn.lock` — dependency lockfiles, not architecturally relevant

Focus on source code, configuration files, READMEs, CLAUDE.md files, package.json (for dependency lists only), and any docs folders.

## Technical Constraints

- **Language**: Node.js / TypeScript preferred. Python acceptable for specific tooling.
- **No heavy frameworks**: No LangChain, no CrewAI, no AutoGen. This is purpose-built.
- **Git**: Always use `main` as default branch. Include `git branch -M main` after `git init`.
- **Lean dependencies**: Minimize npm packages. Prefer stdlib and focused single-purpose libs.
- **Streaming first**: Every provider interaction must be stream-based with supervision. No fire-and-forget.
- **Typed everything**: Full TypeScript strict mode. Typed error categories, typed mission states, typed events.
- **No silent failures**: Every error must be typed, logged, and routed to a recovery strategy. This is the whole point.

## File Output Checklist

When complete, the `docs/` folder should contain:

```
docs/
├── 00-EXECUTIVE-SUMMARY.md
├── 01-DISCOVERY.md
├── 02-DEPENDENCIES.md
├── 03-ARCHITECTURE.md
├── 04-GAPS.md
└── 05-BUILD-PLAN.md
```

Each document must be self-contained and readable independently, but they build on each other sequentially.
