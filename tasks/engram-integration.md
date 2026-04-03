# Phase 3: Engram Integration for Internal Operatives

## Context

Phase 1-2 delivered internal mission execution via `src/execution/`. The OperativeAgent runs a 6-phase loop but its Engram adapter is a no-op (`nullEngramAdapter`). This phase wires real Engram memory into the operative loop.

## Architecture Decision: Library Import, Not MCP

Engram provides two integration paths:
1. **MCP stdio server** (`engram-mcp`) — spawns a child process, communicates via JSON-RPC over stdin/stdout
2. **Direct library import** — `import { Engram } from 'engram'`

**We use the direct library import.** valor-engine and the OperativeAgent run in the same process. MCP stdio adds process management overhead, serialization latency, and failure modes that don't exist with a direct import. The Engram class uses `better-sqlite3` (synchronous, WAL mode) which is already a valor-engine dependency.

Each internal agent gets its own `.engram` file — isolated memory, no cross-contamination. The agent's callsign determines the filename: `data/engram/{callsign}.engram`.

## Source Material

- Engram library: `G:\Projects\SIT\engram\src\engram.ts` — the `Engram` class (create, retain, recall, reflect, processExtractions, forget, supersede, close)
- Engram types: retain options (memoryType, sourceType, trustScore, source, context), recall options (topK, minTrust, memoryTypes, after, before)
- Operative adapter pattern: `G:\Projects\SIT\operative\src\core\engram-adapter.ts` — shows recall-before-LLM, retain-after-LLM, background extraction/reflection ticks
- Current stub: `src/execution/types.ts` has `EngramAdapter` interface and `nullEngramAdapter`

## What to Build

### 3.1 Add Engram Dependency

```bash
cd G:\Projects\SIT\valor-engine
pnpm add engram@file:../engram
```

This creates a local file link. Engram must be built first (`cd ../engram && npm run build`). If the file: link causes cross-project issues, copy `G:\Projects\SIT\engram\dist\` into a `vendor/engram/` directory and reference that instead.

### 3.2 Create `src/execution/engram-bridge.ts`

This is the real EngramAdapter implementation that replaces the null stub. It wraps the Engram class to match the existing `EngramAdapter` interface and adds:
- Per-agent Engram instance management (create on first use, cache in a Map)
- Automatic `.engram` file creation in `data/engram/`
- recall() that formats results for system prompt injection
- retain() that writes phase results with appropriate trust scores and memory types
- Background tick support for extraction and reflection
- Graceful shutdown (close all instances)

```typescript
// src/execution/engram-bridge.ts

import { Engram } from 'engram';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { logger } from '../utils/logger.js';
import type { EngramAdapter } from './types.js';

const ENGRAM_DIR = resolve(process.cwd(), 'data', 'engram');
const instances = new Map<string, Engram>();

// Ensure directory exists on module load
mkdirSync(ENGRAM_DIR, { recursive: true });

/**
 * Get or create an Engram instance for an agent.
 * Each agent gets its own .engram SQLite file — fully isolated memory.
 */
async function getOrCreate(agentId: string, callsign: string): Promise<Engram> {
  const existing = instances.get(agentId);
  if (existing) return existing;

  const dbPath = resolve(ENGRAM_DIR, `${callsign}.engram`);
  const engram = await Engram.create(dbPath, {
    ollamaUrl: process.env.OLLAMA_BASE_URL ?? process.env.ENGRAM_OLLAMA_URL ?? 'http://starbase:40114',
  });

  instances.set(agentId, engram);
  logger.info('Engram instance created', { agent_id: agentId, callsign, db: dbPath });
  return engram;
}

/**
 * Create a real EngramAdapter for an internal agent.
 * Returns an adapter that wraps a per-agent Engram instance.
 */
export function createEngramAdapter(agentId: string, callsign: string): EngramAdapter {
  return {
    async recall(opts) {
      try {
        const engram = await getOrCreate(agentId, callsign);
        const result = await engram.recall(opts.query, {
          topK: Math.min(Math.floor(opts.budgetTokens / 200), 10), // rough estimate: ~200 tokens per result
        });

        // Format results for prompt injection
        const parts: string[] = [];

        if (result.results?.length) {
          parts.push('## Relevant Memories');
          for (const r of result.results.slice(0, 8)) {
            const trust = r.trustScore != null ? ` [trust: ${r.trustScore.toFixed(1)}]` : '';
            parts.push(`- ${r.text}${trust}`);
          }
        }

        if (result.opinions?.length) {
          parts.push('## Agent Opinions');
          for (const o of result.opinions.slice(0, 3)) {
            parts.push(`- ${o.text}`);
          }
        }

        if (result.observations?.length) {
          parts.push('## Observations');
          for (const o of result.observations.slice(0, 3)) {
            parts.push(`- ${o.text}`);
          }
        }

        if (result.entities?.length) {
          parts.push('## Known Entities');
          parts.push(result.entities.map((e: any) => e.name).join(', '));
        }

        return parts.length > 0 ? parts.join('\n') : '';
      } catch (err) {
        logger.warn('Engram recall failed', {
          agent_id: agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      }
    },

    async retain(opts) {
      try {
        const engram = await getOrCreate(agentId, callsign);
        const result = await engram.retain(opts.content, {
          memoryType: opts.type,
          sourceType: 'agent_generated',
          trustScore: opts.type === 'experience' ? 0.7 : 0.5,
          source: `mission:${opts.tags?.[0] ?? 'unknown'}`,
          context: opts.domain,
        });
        return result?.chunkId ?? '';
      } catch (err) {
        logger.warn('Engram retain failed', {
          agent_id: agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      }
    },
  };
}

/**
 * Run extraction tick for all active Engram instances.
 * Call this periodically (e.g., every 60s) from the engine's tick loop.
 */
export async function tickExtraction(): Promise<void> {
  for (const [agentId, engram] of instances) {
    try {
      await engram.processExtractions(5);
    } catch (err) {
      logger.debug('Engram extraction tick failed', {
        agent_id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Run reflection for all active Engram instances.
 * Call this less frequently (e.g., every 5 min).
 */
export async function tickReflection(): Promise<void> {
  for (const [agentId, engram] of instances) {
    try {
      await engram.reflect();
    } catch (err) {
      logger.debug('Engram reflection tick failed', {
        agent_id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Close all Engram instances. Called on engine shutdown.
 */
export function closeAllEngram(): void {
  for (const [agentId, engram] of instances) {
    try {
      engram.close();
      logger.debug('Engram closed', { agent_id: agentId });
    } catch {
      // Non-fatal on shutdown
    }
  }
  instances.clear();
}

/**
 * Get status of all active Engram instances.
 */
export function getEngramStatus(): { agentId: string; active: boolean }[] {
  return [...instances.keys()].map(id => ({ agentId: id, active: true }));
}
```

**Important:** The above is a reference implementation, not copy-paste. Claude Code must adapt it to the actual Engram API signatures from the source at `G:\Projects\SIT\engram\src\engram.ts`. Check the actual `Engram.create()` signature, `recall()` return shape, and `retain()` options.

### 3.3 Wire into `executeInternalMission` (src/execution/index.ts)

Update `executeInternalMission` to create a real EngramAdapter instead of using the null stub:

```typescript
import { createEngramAdapter } from './engram-bridge.js';

// In executeInternalMission, replace:
//   const operative = new OperativeAgent(operativeConfig, provider);
// With:
const engram = createEngramAdapter(agentId, agent.callsign);
const operative = new OperativeAgent(operativeConfig, provider, engram);
```

The OperativeAgent constructor already accepts an optional `EngramAdapter` — Phase 1 built that. Now we're passing a real one.

### 3.4 Wire Background Ticks into Engine Lifecycle

In `src/index.ts`, add periodic ticks and shutdown cleanup:

```typescript
import { tickExtraction, tickReflection, closeAllEngram } from './execution/engram-bridge.js';

// After server starts, start Engram background ticks
const engramExtractionInterval = setInterval(() => {
  tickExtraction().catch(err => logger.debug('Engram extraction tick error', { error: String(err) }));
}, 60_000); // every 60 seconds

const engramReflectionInterval = setInterval(() => {
  tickReflection().catch(err => logger.debug('Engram reflection tick error', { error: String(err) }));
}, 300_000); // every 5 minutes

// In shutdown():
clearInterval(engramExtractionInterval);
clearInterval(engramReflectionInterval);
closeAllEngram();
```

### 3.5 Health Endpoint Update

Add Engram status to the `/health` response:

```typescript
import { getEngramStatus } from './execution/engram-bridge.js';

// In the health endpoint handler:
engram_agents: getEngramStatus(),
```

### 3.6 Verify Engram is Working in the Observe Phase

The existing `runObserve` in `src/execution/phases.ts` should already call `ctx.engram.recall()` and inject the result into the prompt. Verify this path works by checking:
1. The PhaseContext gets the real Engram adapter (not the null one)
2. The recall results appear in the observe prompt
3. The reflect phase calls `ctx.engram.retain()` with the reflection summary

### 3.7 Engram Retain in Reflect Phase

The existing `runReflect` in `src/execution/phases.ts` should call `ctx.engram.retain()` if the config says to retain on reflect. Verify this is wired — check `config.engram.retainOnPhases` includes `'reflect'` in the defaults from `config-loader.ts` (it should — Phase 1 set this).

## Phase 3b: Sub-Agent Engram Access

Sub-agents (Phase 4) will need scoped Engram access. Plan for this now:

- The parent agent's Engram instance should be passable to sub-agents via their context
- Sub-agents get **read-only** recall access to the parent's memory (they can query but not write)
- Sub-agent outputs that the parent deems valuable get retained by the parent in its reflect phase
- Sub-agents do NOT get their own `.engram` files — they're ephemeral

This means the `EngramAdapter` interface may need a `readOnly()` wrapper:

```typescript
export function readOnlyAdapter(adapter: EngramAdapter): EngramAdapter {
  return {
    recall: adapter.recall,
    async retain() { return ''; }, // no-op for sub-agents
  };
}
```

Add this to `engram-bridge.ts` now so Phase 4 can use it.

## Testing

### Unit Tests (`tests/execution/engram-bridge.test.ts`)

1. **Instance creation** — calling `createEngramAdapter` creates a `.engram` file in `data/engram/`
2. **Recall with results** — mock Engram.recall returning results, verify formatted string includes memories
3. **Recall empty** — no results returns empty string
4. **Retain** — verify retain calls Engram with correct options (memoryType, sourceType, trustScore)
5. **Multiple agents** — two different agents get separate Engram instances
6. **Shutdown** — `closeAllEngram()` closes all instances and clears the map
7. **Read-only adapter** — `readOnlyAdapter` allows recall but retain is a no-op

### Integration Test

8. **Full loop with Engram** — create an OperativeAgent with a real EngramAdapter (pointed at a temp `.engram` file), run a mission, verify:
   - Observe phase recalls (even if empty on first run)
   - Reflect phase retains the reflection summary
   - Second run of the same query recalls the retained content

For integration tests, use a temp directory for `.engram` files and clean up after.

## Do NOT

- Use Engram's MCP stdio server — import the library directly
- Share Engram instances between agents — each agent gets its own `.engram` file
- Make Engram a hard startup requirement — if Engram import fails or Ollama embedding model is unreachable, log a warning and fall back to `nullEngramAdapter`
- Block the mission loop waiting for extraction or reflection — those run on background intervals
- Store `.engram` files in `node_modules` or temp — use `data/engram/` which persists

## Verification

After implementation:

```bash
pnpm test
pnpm run typecheck
```

Then manually:

1. Start valor-engine: `pnpm dev`
2. Verify `data/engram/` directory was created
3. Create an internal agent and dispatch a mission (same as Phase 2 verification)
4. Check that `data/engram/{callsign}.engram` was created during mission execution
5. Run a second mission for the same agent — verify the observe phase now has memory context from the first mission
6. Check the health endpoint includes `engram_agents` status

## Claude Code Prompt

```
Read CLAUDE.md, then read tasks/integration-operative-engine.md Phase 3 section AND tasks/engram-integration.md (this file).

Execute Phase 3: Engram integration.

1. Add engram as a local dependency: pnpm add engram@file:../engram
   - If this fails, check that G:\Projects\SIT\engram has been built (cd ../engram && npm run build)
2. Create src/execution/engram-bridge.ts — real EngramAdapter using direct Engram library import
   - READ G:\Projects\SIT\engram\src\engram.ts to verify the actual Engram.create() signature and recall()/retain() API
   - READ G:\Projects\SIT\operative\src\core\engram-adapter.ts for the proven adapter pattern
   - Each agent gets its own .engram file in data/engram/{callsign}.engram
   - Include readOnlyAdapter() for future sub-agent use
   - Include tickExtraction(), tickReflection(), closeAllEngram()
3. Update src/execution/index.ts — pass real EngramAdapter to OperativeAgent instead of null
4. Update src/index.ts — add background tick intervals and shutdown cleanup
5. Update health endpoint to include engram status
6. Write tests in tests/execution/engram-bridge.test.ts
7. Run pnpm test and pnpm run typecheck

Key: If Engram import fails at runtime (e.g., Ollama embedding model unreachable), fall back to nullEngramAdapter gracefully. Never crash the engine because memory is unavailable.
```
