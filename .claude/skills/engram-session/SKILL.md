---
name: engram-session
description: Engram memory operations for VALOR operatives. Use at the start and end of every Claude Code session to persist operative context. Covers retain/recall/reflect operations, session summaries, and the observation pipeline. Trigger on: "start session", "end session", "remember this", "what did we work on", "save context", any Engram API usage.
origin: SIT
---

# Engram Session — VALOR

Engram is the operative memory system. Use it to persist context across sessions.

## Session Start — Recall

At the beginning of every session, load operative context:

```typescript
import { EngramClient } from '@swift-innovate/engram';

const engram = new EngramClient({ 
  db: process.env.ENGRAM_DB_PATH || '~/.valor/engram.db',
  operativeId: process.env.VALOR_OPERATIVE || 'gage'
});

// Load recent experience + world knowledge
const context = await engram.recall({
  types: ['world', 'experience'],
  limit: 20,
  tags: [currentProject]  // filter by project if available
});

// Inject into session context
console.log('=== ENGRAM CONTEXT ===');
context.entries.forEach(e => console.log(`[${e.type}] ${e.content}`));
```

## Session End — Retain

At the end of every session, persist what was learned:

```typescript
// Summarize the session work
await engram.retain({
  operativeId: 'gage',
  type: 'experience',
  content: `Session ${sessionId}: ${summary}`,
  tags: [project, 'session', new Date().toISOString().split('T')[0]]
});
```

## During Session — Observe

When noticing a pattern worth remembering:

```typescript
await engram.retain({
  operativeId: 'gage',
  type: 'observation',
  content: 'Always use Zod schemas at the boundary of external data in valor-engine',
  tags: ['typescript', 'validation', 'pattern']
});
```

## Memory Types

| Type | Use for | Example |
|---|---|---|
| `world` | Stable facts about the project | "valor-engine uses Node 20, TypeScript 5.4" |
| `experience` | Session outcomes, decisions | "Switched from axios to native fetch in herd-pro" |
| `observation` | Patterns noticed mid-work | "Rust borrow checker prefers Option over null-check" |
| `opinion` | Operative preferences/judgments | "Avoid deep nesting in operative handlers" |

## Reflect — Extract Patterns (batch)

Run periodically to distill observations into world knowledge:

```typescript
await engram.reflect({
  operativeId: 'gage',
  sourceTypes: ['observation', 'experience'],
  targetType: 'world',
  minConfidence: 0.7
});
```

## Trust / Provenance

Before acting on recalled memory, check provenance:

```typescript
const entry = await engram.recall({ id: memoryId });

// Don't act blindly on old or low-trust memories
if (entry.trust < 0.5 || entry.staleDays > 30) {
  // Verify before using
}
```

## CLI Quick Reference

```bash
# Recall recent context for gage
engram recall --operative gage --limit 10

# Retain a quick note
engram retain --operative gage --type observation --content "..." --tags "project,pattern"

# Run reflection pass
engram reflect --operative gage

# View memory graph
engram graph --operative gage
```
