# Fix: Make Engram an Optional Dependency

## Problem

`package.json` has `"engram": "link:../engram"` which:
- Breaks in CI (no sibling directory)
- Breaks on any machine that isn't CITADEL
- Violates the scope boundary documented in CLAUDE.md

Meanwhile `src/execution/engram-bridge.ts` has a hard top-level import:
```typescript
import { Engram, formatForPrompt, type EngramOptions } from 'engram';
```

If the `engram` package isn't installed, TypeScript refuses to compile — the entire engine is broken, not just memory.

## Solution

Make Engram a **dynamic import** that fails gracefully at runtime. The engine compiles and runs without Engram installed. When Engram IS installed (locally or from npm), memory works. When it's NOT installed, `nullEngramAdapter` is used automatically.

### Step 1: Remove from dependencies, add to optionalDependencies

In `package.json`:
- Remove `"engram": "link:../engram"` from `dependencies`
- Add to `optionalDependencies`:
  ```json
  "optionalDependencies": {
    "engram": ">=0.1.0"
  }
  ```

This means `pnpm install` won't fail if engram isn't resolvable. Users who want memory run `pnpm add engram@file:../engram` (or from npm when published).

### Step 2: Rewrite engram-bridge.ts with dynamic import

Replace the static top-level import with a lazy dynamic import pattern:

```typescript
// src/execution/engram-bridge.ts

import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { logger } from '../utils/logger.js';
import type { EngramAdapter } from './types.js';
import { nullEngramAdapter } from './types.js';

// ─── Lazy Engram loader ─────────────────────────────────────────────────────
// Engram is an optional dependency. If not installed, all memory operations
// gracefully degrade to no-ops via nullEngramAdapter.

let engramModule: {
  Engram: any;
  formatForPrompt: any;
} | null | undefined = undefined; // undefined = not yet attempted, null = failed

async function loadEngram(): Promise<typeof engramModule> {
  if (engramModule !== undefined) return engramModule;
  try {
    const mod = await import('engram');
    engramModule = {
      Engram: mod.Engram,
      formatForPrompt: mod.formatForPrompt,
    };
    logger.info('Engram module loaded — agent memory enabled');
    return engramModule;
  } catch {
    engramModule = null;
    logger.info('Engram not installed — agent memory disabled (using nullEngramAdapter)');
    return null;
  }
}
```

The rest of the file stays largely the same, but every function that uses `Engram` or `formatForPrompt` calls `await loadEngram()` first and checks for null.

Key changes to existing functions:

**getOrCreate:**
```typescript
async function getOrCreate(agentId: string, callsign: string): Promise<any> {
  const existing = instances.get(agentId);
  if (existing) return existing;

  const mod = await loadEngram();
  if (!mod) throw new Error('Engram not available');

  mkdirSync(engramDir, { recursive: true });
  const dbPath = resolve(engramDir, `${callsign}.engram`);
  const engram = await mod.Engram.create(dbPath, {
    ollamaUrl: process.env.OLLAMA_BASE_URL ?? process.env.ENGRAM_OLLAMA_URL ?? 'http://starbase:40114',
    ...engramOptionOverrides,
  });

  instances.set(agentId, engram);
  logger.info('Engram instance created', { agent_id: agentId, callsign, db: dbPath });
  return engram;
}
```

**createEngramAdapter recall:**
```typescript
async recall(opts) {
  try {
    const mod = await loadEngram();
    if (!mod) return '';
    const engram = await getOrCreate(agentId, callsign);
    const response = await engram.recall(opts.query, {
      topK: Math.min(Math.floor(opts.budgetTokens / 200), 10),
    });
    return mod.formatForPrompt(response, { maxChars: opts.budgetTokens * 4 });
  } catch (err) {
    logger.warn('Engram recall failed', { agent_id: agentId, error: err instanceof Error ? err.message : String(err) });
    return '';
  }
},
```

**isEngramAvailable (new export):**
```typescript
export async function isEngramAvailable(): Promise<boolean> {
  const mod = await loadEngram();
  return mod !== null;
}
```

### Step 3: Remove type imports from 'engram'

The current file imports `type EngramOptions` from engram. Since this is a type-only import, TypeScript strips it at compile time BUT it still validates during type checking. Replace with a local type:

```typescript
// Local type to avoid compile-time dependency on engram package
type EngramOptions = Record<string, unknown>;
```

The `setEngramOptions` function is only used in tests — the loose typing is fine.

### Step 4: Update src/index.ts

The import `from "./execution/engram-bridge.js"` stays the same — that module is inside valor-engine. No change needed. The dynamic import of `engram` happens lazily inside the bridge when the first internal agent tries to use memory.

### Step 5: Update tests

The engram-bridge tests need to handle the case where `engram` IS installed (on CITADEL) and where it ISN'T (in CI). Two approaches:

**Option A (recommended):** Tests that exercise real Engram use `describe.skipIf` when `engram` isn't available:
```typescript
const engramAvailable = await isEngramAvailable();
describe.skipIf(!engramAvailable)('Engram bridge (real)', () => { ... });
```

**Option B:** Mock the dynamic import. Harder to maintain.

Tests that exercise the graceful degradation (null adapter fallback) should work regardless of whether engram is installed.

### Step 6: Update CLAUDE.md scope boundary

Soften the Engram scope boundary to reflect the new reality:

> Engram is an **optional dependency**. When installed, internal agents get per-agent memory (recall/retain/reflect). When not installed, all memory operations silently degrade to no-ops. The engine is fully functional without Engram — no features break, agents just don't remember between missions.

## Verification

1. Remove `node_modules/engram` and the `link:` entry, run `pnpm install` — should succeed
2. `pnpm run typecheck` — should pass (no compile-time dependency on engram)
3. `pnpm test` — engram-specific tests skip, all others pass
4. `pnpm add engram@file:../engram` — re-adds engram
5. `pnpm test` — all tests pass including engram-specific ones
6. Start the engine without engram installed, dispatch an internal mission — should work, logs "Engram not installed — agent memory disabled"

## Do NOT

- Remove engram-bridge.ts or the execution module — keep all the code, just make the import dynamic
- Add try/catch around the package.json dependency — use optionalDependencies properly
- Create a mock/stub engram package — the nullEngramAdapter already handles this
- Change the EngramAdapter interface — it stays the same, only the bridge implementation changes

## Claude Code Prompt

```
Read CLAUDE.md, then read tasks/optional-engram-dependency.md.

Make Engram an optional dependency:
1. In package.json: move engram from dependencies to optionalDependencies, remove the link: path
2. In src/execution/engram-bridge.ts: replace the static top-level import with a dynamic import pattern that fails gracefully when engram isn't installed
3. Remove the type-only import of EngramOptions from engram — define a local type instead
4. Add isEngramAvailable() export
5. Update tests to skip engram-specific tests when the package isn't installed
6. Update CLAUDE.md scope boundary to reflect engram as optional
7. Run: pnpm run typecheck && pnpm test
8. Verify the engine compiles cleanly without engram in node_modules
```
