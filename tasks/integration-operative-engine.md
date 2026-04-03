# Integration: Internal Operative Execution in valor-engine

## Context

valor-engine is a working orchestration platform with 15 API routes, SQLite persistence, event bus, gate system, Director LLM classification, Telegram gateway, WebSocket dashboard, and provider registry. It dispatches missions two ways:

- **Path A:** Agent has `endpoint_url` → webhook delivery
- **Path B:** No agent endpoint → direct provider stream (single LLM call, no loop)

Both paths assume agents are external or that a single LLM call suffices. Neither supports multi-phase autonomous mission execution inside the engine.

**This task adds Path C: internal OperativeAgent execution** — a multi-phase loop (Observe→Plan→Act→Validate→Reflect→Evolve) that runs in-process, publishes sitreps through the existing event bus, and transitions mission status through the existing state machine.

## Source Material

The OperativeAgent class and 6-phase loop already exist in `G:\Projects\SIT\valor\src\operative\`. The types and LLM provider interface are in `G:\Projects\SIT\valor\src\operative\types.ts` and `G:\Projects\SIT\valor\src\llm\types.ts`. These were designed for valor-engine integration — the interfaces are compatible.

The Operative framework at `G:\Projects\SIT\operative\` has additional mature patterns worth referencing: provider strategy routing (`src/core/conduit.ts`), sub-agent execution (`src/core/subagent.ts`), Engram adapter (`src/core/engram-adapter.ts`), and skill loading (`src/core/skill-loader.ts`). Reference these for patterns but do NOT import them as dependencies.

## Architecture Decision

All new code lives inside valor-engine. No new npm dependencies for the operative loop itself. The OperativeAgent uses valor-engine's existing `ProviderAdapter` interface (from `src/providers/types.ts`) — do NOT introduce the valor v2 `LLMProvider` interface. Write a thin adapter that maps valor-engine's `ProviderAdapter.complete()` to what the phase functions expect.

## What to Build

### Phase 1: OperativeAgent Core (src/execution/)

Create `src/execution/` with these files:

#### 1.1 `src/execution/types.ts`

Port from `G:\Projects\SIT\valor\src\operative\types.ts` with these changes:
- Remove the `LLMProvider` interface (use valor-engine's `ProviderAdapter` instead)
- Remove `EngramAdapter` for now (stub it — Engram integration is Phase 3)
- Keep all phase result types (ObserveResult, PlanResult, ActResult, ValidateResult, ReflectResult, EvolveResult)
- Keep OperativeConfig, MissionBrief, AgentState, LoopPhase
- Keep LoopConfig, AutonomyConfig, EngramConfig
- Add `internal: boolean` flag to distinguish internal agents in the agent registry

#### 1.2 `src/execution/phases.ts`

Port from `G:\Projects\SIT\valor\src\operative\loop\phases.ts` with these changes:
- The `PhaseContext` takes a valor-engine `ProviderAdapter` instead of `LLMProvider`
- Write a small adapter function that maps `ProviderAdapter.complete()` to the format the prompt builders expect (the response shapes are nearly identical — both have `content`, `model`, `usage`)
- The Engram calls in `runObserve` and `runReflect` should be no-ops that return empty string / empty array when no Engram adapter is configured. Use an optional `engram` field in PhaseContext.
- Keep all prompt builder functions (`buildObservePrompt`, `buildPlanPrompt`, etc.) as-is
- Keep all response parsers as-is

#### 1.3 `src/execution/operative-agent.ts`

Port from `G:\Projects\SIT\valor\src\operative\operative-agent.ts` with these changes:
- Constructor takes `ProviderAdapter` instead of `LLMProvider`
- Add `publishSitrep()` integration — after each phase completion, publish a sitrep event through valor-engine's event bus (`publish()` from `src/bus/index.js`)
- The `runMission()` method should:
  1. Accept a valor-engine `Mission` object (from `src/types/mission.ts`)
  2. Convert it to the internal `MissionBrief` format
  3. Run the phase loop (observe→plan→act→validate→reflect, with evolve on interval)
  4. Publish sitreps after each phase via the event bus
  5. Return a result indicating completion, failure, or escalation
- Budget enforcement: respect `autonomy.budget` for act cycle limits. When budget exhausted, escalate.
- Iteration limits: respect `loop.maxIterationsPerMission`. When exceeded, mark as failed.

#### 1.4 `src/execution/index.ts`

Export the public API:
- `OperativeAgent` class
- `executeInternalMission(missionId: string, agentId: string): Promise<void>` — the function the orchestrator calls
- Type exports

#### 1.5 `src/execution/config-loader.ts`

Load operative config from the agent's record in the DB. For Phase 1, use sensible defaults:

```typescript
function defaultOperativeConfig(agent: Agent, division: Division | null): OperativeConfig {
  return {
    id: agent.id,
    name: agent.callsign,
    tier: 2, // Default to Tier 2 (supervised)
    division: division?.name,
    loop: {
      persistence: 'mission-scoped',
      tickInterval: 1000,
      maxIterationsPerMission: 10,
      idleTimeout: 300_000,
    },
    autonomy: {
      budget: 5, // 5 act cycles before checkpoint
      escalationTarget: 'director',
      autoApprovePhases: ['observe', 'plan', 'reflect'],
      requiresCheckpoint: ['act'],
    },
    engram: {
      readDomains: ['shared'],
      writeDomains: ['shared'],
      recallBudget: 2000,
      retainOnPhases: ['reflect'],
    },
    modelAssignment: {
      default: agent.model ?? 'ollama/gemma3:12b',
    },
    tools: { enabled: [], disabled: [] },
  };
}
```

### Phase 2: Wire into Orchestrator

#### 2.1 Modify `src/orchestrator/orchestrator.ts`

After the existing Path A (webhook) and before Path B (direct stream), add Path C:

```typescript
// ── Path C: internal agent (no endpoint_url, runtime !== 'openclaw') → operative loop
if (agent && !agent.endpoint_url && agent.runtime !== 'openclaw') {
  transitionMission(missionId, "dispatched");

  appendAuditEntry({
    entity_type: "mission",
    entity_id: missionId,
    operation: "update",
    before_state: JSON.stringify({ status: "gated" }),
    after_state: JSON.stringify({ status: "dispatched", agent: agent.id, mode: "internal" }),
    actor_id: "orchestrator",
  });

  publish({
    type: "mission.dispatched",
    source: { id: "orchestrator", type: "system" },
    target: { id: agent.id, type: "agent" },
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, agent_id: agent.id, mode: "internal" },
    metadata: null,
  });

  // Fire and forget — the operative agent manages its own lifecycle
  // and publishes sitreps through the event bus
  executeInternalMission(missionId, agent.id).catch((err) => {
    logger.error("Internal mission execution failed", {
      mission_id: missionId,
      agent_id: agent.id,
      error: err instanceof Error ? err.message : String(err),
    });
    handleMissionFailure(missionId, err instanceof Error ? err.message : String(err));
  });

  return {
    dispatched: true,
    reason: `Dispatched to internal agent ${agent.callsign}`,
    mission: getMission(missionId)!,
  };
}
```

#### 2.2 Add `runtime` type: `"internal"`

Add `"internal"` to the `AgentRuntime` enum in `src/types/agent.ts`:

```typescript
export const AgentRuntime = z.enum([
  "openclaw",
  "ollama",
  "claude_api",
  "openai_api",
  "internal",  // ← NEW: agent runs inside valor-engine process
  "custom",
]);
```

#### 2.3 Sitrep Integration

The existing sitrep schema and API routes already handle phase-level updates. The OperativeAgent should publish sitreps with this shape (matching what the dashboard and Telegram gateway already consume):

```typescript
publish({
  type: "sitrep.published",
  source: { id: agentId, type: "agent" },
  target: null,
  conversation_id: null,
  in_reply_to: null,
  payload: {
    mission_id: missionId,
    operative: agentCallsign,
    status: "IN_PROGRESS", // or COMPLETED, FAILED, ESCALATED
    progress_pct: calculateProgress(currentPhase),
    summary: phaseResult.summary ?? phaseResult.output ?? phaseResult.reasoning,
    phase: currentPhase,
    iteration: state.iterationCount,
    tokens_used: { input: usage.input, output: usage.output },
    timestamp: new Date().toISOString(),
  },
  metadata: null,
});
```

### Phase 3: Engram Integration (after Phase 1-2 verified)

Wire the Engram MCP server into the OperativeAgent's observe and reflect phases. The Engram adapter pattern from `G:\Projects\SIT\operative\src\core\engram-adapter.ts` shows how — it calls `retain()` and `recall()` through the MCP connection. For valor-engine, use the existing MCP infrastructure in `src/mcp/`.

### Phase 4: Sub-agent Support (after Phase 3)

Port the sub-agent engine from `G:\Projects\SIT\operative\src\core\subagent.ts`. Sub-agents are lightweight parallel LLM calls with:
- Scoped tool grants (none/read-only/read-write/full)
- Recursion prevention (sub-agents cannot spawn sub-agents)
- Concurrent execution (max 5 parallel)
- Per-call token budgets

This enables a Division Lead agent to decompose work and fan out to cheaper models.

## Testing Strategy

### Phase 1 Tests (`tests/execution/`)

1. **OperativeAgent unit test** — construct with mock provider, run a mission, verify phase sequence fires in order (observe→plan→act→validate→reflect)
2. **Phase function tests** — each phase function with mock provider, verify prompt construction and response parsing
3. **Budget enforcement** — verify agent stops after N act cycles and publishes escalation event
4. **Iteration limit** — verify mission fails after maxIterationsPerMission
5. **Sitrep publishing** — verify events published to bus after each phase

### Phase 2 Tests

6. **Orchestrator routing** — agent with `runtime: 'internal'` and no `endpoint_url` routes to Path C
7. **End-to-end** — create mission via API, assign to internal agent, verify mission transitions through states and sitreps appear in the event log

## Do NOT

- Import or depend on the `operative` npm package — absorb the code
- Import or depend on the `valor` (v2) package — port the relevant files
- Introduce LangGraph, LangChain, or any Python dependencies
- Change the existing Path A (webhook) or Path B (direct stream) behavior
- Modify the existing provider adapter interface
- Add NATS requirements for internal execution (use the event bus)
- Change the database schema beyond adding 'internal' to the AgentRuntime enum migration
- Build a CLI or terminal interface — this is server-side only
- Skip writing tests

## Verification

After Phase 1-2:

```bash
pnpm test
pnpm run typecheck
```

Then manually:

1. Start valor-engine: `pnpm dev`
2. Create an internal agent via API:
   ```bash
   curl -X POST http://localhost:3200/agents \
     -H "Content-Type: application/json" \
     -d '{"callsign": "gage", "runtime": "internal", "model": "ollama/gemma3:12b", "capabilities": ["code", "research"]}'
   ```
3. Create and dispatch a mission:
   ```bash
   curl -X POST http://localhost:3200/missions \
     -H "Content-Type: application/json" \
     -H "X-VALOR-Role: director" \
     -d '{"title": "Test internal execution", "objective": "Summarize the VALOR architecture", "assigned_agent_id": "<agent_id_from_step_2>", "priority": "normal"}'
   ```
4. Dispatch it:
   ```bash
   curl -X POST http://localhost:3200/missions/<mission_id>/dispatch \
     -H "X-VALOR-Role: director"
   ```
5. Watch the dashboard or query sitreps to see phase progression
6. Verify mission reaches `complete` or `aar_pending` status

## Claude Code Prompt

```
Read CLAUDE.md first, then read tasks/integration-operative-engine.md.

Execute Phase 1 only:
1. Create src/execution/ directory
2. Port types from G:\Projects\SIT\valor\src\operative\types.ts (adapt to valor-engine's ProviderAdapter)
3. Port phases from G:\Projects\SIT\valor\src\operative\loop\phases.ts (adapt provider interface)
4. Port OperativeAgent from G:\Projects\SIT\valor\src\operative\operative-agent.ts (add event bus sitrep publishing)
5. Create config-loader with sensible defaults
6. Create index.ts with executeInternalMission function
7. Write tests for operative-agent, phases, and budget enforcement
8. Run pnpm test and pnpm run typecheck

Do NOT modify the orchestrator yet — that's Phase 2. Get the execution module building and testing green first.
```
