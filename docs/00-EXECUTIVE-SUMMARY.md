# Executive Summary -- VALOR Engine Unified Architecture

> For: The Director | Generated: 2026-03-05

---

## Current State

The valor-engine repository contains **12 components** spanning two complete orchestration engines (VALOR v1 and v3), reference provider adapters (cloud API, local Ollama), a persona extraction tool (Soulsmith), three overlapping dashboards, three agent configurations, and two specification documents. The code is high-quality -- TypeScript strict mode, Zod schemas, good documentation -- but the components share **zero actual code, no common types, and no unified communication protocol**. VALOR v1 brings battle-tested communication (VCP protocol, MCP tools, Telegram gateway, named operatives) while VALOR v3 brings mature governance (8 control gates, AAR peer review, cost tracking, budget enforcement, approval queues). Neither alone solves the whole problem. The core failure -- OpenClaw's silent stream failures -- remains unsolved in both.

## Recommended Architecture

A **7-layer engine** that merges the best of both VALOR generations and unifies all components under a single typed event bus:

```
Director (Human) -- via Telegram, Dashboard, CLI
        |
[Communication Bus] -- Typed EventEnvelope, pub/sub, guaranteed delivery
        |
[Core Engine] -- Mission lifecycle, stream supervisor, failure router, WAL
        |
  +-----------+-----------+-----------+----------+
  | Provider  | Identity  | Memory    | Decision | Division
  | Layer     | Layer     | Layer     | Layer    | Schema
  |           |           |           | (VECTOR) |
  | Claude API| Soulsmith | Namespaced| Gate     | Registration
  | Ollama    | SSOP      | state     | eval     | Autonomy
  | OpenClaw  | Personas  | WAL/audit | Approval | Escalation
  | HA/Custom |           |           |          |
  +-----------+-----------+-----------+----------+
        |
[Agents] -- Mira, Gage, Zeke, Rook, Eddie (independent processes)
```

**Key design decisions:**
- **SQLite** as the single state authority (replacing JSON files, in-memory maps, and Convex)
- **Hono** as the HTTP framework (lightweight, proven)
- **Zod** as the single source of truth for all types
- **EventEnvelope v2.0** evolving from VCP 1.1.0 as the canonical message format
- **10 control gates** (v3's 8 + OathGate from v1 + VECTOR checkpoint)
- **Stream supervision on every provider interaction** -- the core capability that eliminates silent failures

## Critical Path

| # | Phase | Duration | What It Delivers |
|---|-------|----------|-----------------|
| 0 | **Foundation** | ~5 days | Shared types (Zod), SQLite state layer, Communication Bus |
| 1 | **Stream + Providers** | ~5-7 days | StreamSupervisor, ProviderAdapter interface, Claude API + Ollama adapters |
| 2 | **Mission Lifecycle** | ~5-7 days | Mission state machine, 10 gates, AAR pipeline, approval queue |
| 3 | **Divisions + Identity** | ~5-7 days | Division registry, persona registry, lead instantiation |
| 4 | **VECTOR + Governance** | ~4-5 days | Decision engine, bias scoring, checkpoints, OATH integration |
| 5 | **Dashboard** | ~8-10 days | Unified Mission Control (merge 3 dashboards) |
| 6 | **Mira Migration** | ~5-7 days | OpenClaw adapter, Telegram gateway, Mira governed by engine |

**Total: ~37-48 days**

## Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Mira disruption during migration | High | 4-stage migration (observe -> shadow -> govern -> integrate). Every stage has a zero-risk rollback. |
| VALOR v1 + v3 merge complexity | High | Don't merge codebases. Extract the best subsystems from each and compose them in the new engine. |
| Scope creep (federation, credit ledger, etc.) | Medium | Schemas designed now, implementation deferred. Phase 0 types include federation placeholders but no code. |
| Local model integration friction | Low | Ollama adapter speaks the standard Ollama HTTP protocol. Works with bare Ollama or any compatible proxy. |
| Dashboard consolidation effort | Medium | Start from v3 Dashboard (strongest base), add features incrementally. |

## First Week Deliverables

By the end of Phase 0 (~5 days), the engine will have:

1. **All core Zod schemas** -- Mission, Agent, Division, Event, Error, VECTOR, WAL types compiled and tested
2. **SQLite database** with migrations, WAL mode, and repository CRUD for all core entities
3. **Communication Bus** with pub/sub, pattern matching, and event replay
4. **`/health` endpoint** on Hono showing engine status
5. **Test suite** validating schema conformance, DB operations, and event routing

This foundation immediately proves: the type system works, persistence works, and events flow. Everything built after is composition on this base.

---

## Next Milestone: MCP Integration

The agent communication layer is migrating from REST polling to **Model Context Protocol (MCP)**. This replaces the current `GET /agents/:id/inbox` polling loop + `X-VALOR-Role` header auth with:

- **Session-based identity** — agents authenticate once on MCP connect, no per-request headers
- **Typed tool discovery** — agents auto-discover 10 VALOR tools via JSON Schema (check_inbox, accept_mission, submit_sitrep, send_message, etc.)
- **Server push notifications** — SSE-based real-time mission assignments and directives, with polling fallback
- **Synchronous execution** — tool calls return results immediately, no async polling loops

The REST API remains for the human dashboard. MCP is agent-facing only. See [`06-MCP-INTEGRATION.md`](06-MCP-INTEGRATION.md) for full design.

---

## Document Index

| Document | Purpose |
|----------|---------|
| [`01-DISCOVERY.md`](01-DISCOVERY.md) | Component-by-component analysis of all 12 repo components |
| [`02-DEPENDENCIES.md`](02-DEPENDENCIES.md) | Cross-component dependency matrix, redundancies, interface mismatches |
| [`03-ARCHITECTURE.md`](03-ARCHITECTURE.md) | 7-layer integration architecture with TypeScript interfaces and mermaid diagrams |
| [`04-GAPS.md`](04-GAPS.md) | Use-as-is / needs-rework / build-new / deprecate categorization |
| [`05-BUILD-PLAN.md`](05-BUILD-PLAN.md) | Phased build order, migration path, rollback plan, starter scaffold |
| [`06-MCP-INTEGRATION.md`](06-MCP-INTEGRATION.md) | MCP server design, tool schemas, migration from REST polling |
