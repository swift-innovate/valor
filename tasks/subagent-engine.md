# Phase 4: Sub-Agent Execution Engine

## Context

Phase 3 gave internal agents Engram memory. Phase 4 gives them the ability to delegate — a Division Lead agent can spin up lightweight sub-agents to fan out work across cheaper models.

## Source Material

The sub-agent engine already exists in the Operative framework:
- `G:\Projects\SIT\operative\src\core\subagent.ts` — profiles, task dispatch, concurrent execution, tool grants, recursion prevention

Port the patterns, not the code. The Operative version depends on its own LLM routing (`generateLLM`) and tool system. Our version uses valor-engine's `ProviderAdapter` directly.

## Architecture

Sub-agents are **not** OperativeAgents. They don't run the 6-phase loop. They are:
- A single `provider.complete()` call with a focused system prompt
- Optional tool access (scoped by profile)
- Optional read-only Engram access (parent's memory)
- Concurrent execution (up to 5 parallel)
- No memory of their own — results return to the parent

The parent agent's Act phase orchestrates sub-agents. When the plan says "research 3 topics in parallel," the Act phase creates 3 SubagentTasks and dispatches them.

## What to Build

### 4.1 `src/execution/subagent.ts`

```typescript
export interface SubagentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;           // override parent's model — use a cheaper one
  maxTokens?: number;       // per-call token limit
}

export interface SubagentTask {
  id: string;
  instruction: string;
  profile?: string;         // named profile
  systemPrompt?: string;    // override profile
  model?: string;           // override profile
}

export interface SubagentResult {
  id: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}
```

Key functions:
- `registerProfile(profile: SubagentProfile): void`
- `dispatchSubagents(tasks: SubagentTask[], provider: ProviderAdapter, engramAdapter?: EngramAdapter): Promise<SubagentResult[]>`

`dispatchSubagents` runs tasks concurrently (max 5 at a time) using `Promise.allSettled`. Each task:
1. Resolves its profile (or uses defaults)
2. Optionally calls `engramAdapter.recall()` to inject parent memory context
3. Calls `provider.complete()` with the focused prompt
4. Returns the result

Sub-agents CANNOT dispatch sub-agents (recursion prevention). The system prompt must NOT include dispatch_subagent instructions.

### 4.2 Model Routing for Sub-Agents

Sub-agents should use cheaper models by default. The `SubagentProfile.model` field lets the parent specify. The dispatch function should:
- Check if the specified model is available via `getBestProvider({ model })`
- Fall back to the parent's provider if the specified model isn't available
- Log which model each sub-agent used

This is where Herd Pro shines — route sub-agent calls to the 4070 while the parent runs on the 5090. The provider registry already supports this.

### 4.3 Wire into Act Phase

The Act phase (`src/execution/phases.ts`) needs a path for sub-agent delegation. When the Plan phase produces actions tagged as parallelizable or delegatable, the Act phase can dispatch sub-agents instead of making a single LLM call.

This is a future enhancement to the plan/act prompt engineering — for Phase 4, expose `dispatchSubagents` from the execution module and add a helper that the OperativeAgent can call during its act phase:

```typescript
// In operative-agent.ts, add a method:
async delegateToSubagents(tasks: SubagentTask[]): Promise<SubagentResult[]> {
  const readOnlyEngram = this.engram ? readOnlyAdapter(this.engram) : undefined;
  return dispatchSubagents(tasks, this.provider, readOnlyEngram);
}
```

### 4.4 Sitrep for Sub-Agent Activity

When sub-agents run, publish a sitrep so the dashboard shows fan-out activity:

```typescript
publish({
  type: 'sitrep.subagent',
  source: { id: parentAgentId, type: 'agent' },
  payload: {
    mission_id: missionId,
    subagent_count: tasks.length,
    completed: results.filter(r => !r.error).length,
    failed: results.filter(r => r.error).length,
    models_used: [...new Set(results.map(r => r.model))],
  },
});
```

### 4.5 Sub-Agent Engram Pattern (from Phase 3b)

Use the `readOnlyAdapter()` from `engram-bridge.ts`:
- Sub-agents can recall the parent's memory for context
- Sub-agents CANNOT retain — only the parent retains what it deems valuable from sub-agent results
- This prevents sub-agents from polluting the parent's memory with low-quality traces

## Testing

1. **Basic dispatch** — 3 tasks, mock provider, verify all 3 complete
2. **Concurrency limit** — 10 tasks with max 5 concurrent, verify batching
3. **Error isolation** — 1 of 3 tasks fails, verify other 2 still return results
4. **Model override** — task specifies a different model, verify provider called with that model
5. **Read-only Engram** — sub-agent gets recall results, retain is a no-op
6. **Sitrep published** — verify subagent sitrep event on the bus

## Do NOT

- Give sub-agents their own OperativeAgent instances or phase loops
- Allow sub-agents to spawn sub-agents
- Give sub-agents write access to Engram
- Create sub-agent `.engram` files
- Block the parent's loop waiting for all sub-agents — use a timeout

## Claude Code Prompt

```
Read CLAUDE.md, then read tasks/subagent-engine.md (this file).

Execute Phase 4:
1. Create src/execution/subagent.ts with SubagentProfile, SubagentTask, SubagentResult types and dispatchSubagents function
2. Add delegateToSubagents method to OperativeAgent in src/execution/operative-agent.ts
3. Use readOnlyAdapter from engram-bridge.ts for sub-agent Engram access
4. Publish sitrep.subagent events through the event bus
5. Export from src/execution/index.ts
6. Write tests in tests/execution/subagent.test.ts
7. Run pnpm test and pnpm run typecheck
```
