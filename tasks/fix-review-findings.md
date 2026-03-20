# Task: Fix Three Review Findings — Stream Errors, Ollama Model Discovery, Agent Validation

> Priority: CRITICAL — Fix before any new feature work.
> Source: Codex + Claude Code review, 2026-03-20

Read `CLAUDE.md` first — respect the Scope Boundary section.

## Finding 1 (HIGH): Provider error streams can advance missions to complete

### Problem

When a provider adapter yields an `error` event and the iterator then exhausts, the
supervisor's post-loop path may still call `handleStreamComplete()` in edge cases.

The current code has a `total_errors > 0` check after the loop, which handles the
basic case. But there are two remaining holes:

**Hole A:** If an adapter emits error events during streaming but the iterator does
NOT exhaust immediately (e.g., more events follow the error, or a completion event
is emitted after errors), the `error` case in the switch only increments a counter
and continues processing. The stream can still reach a `completion` event and call
`handleStreamComplete()` even though errors occurred.

**Hole B:** The `error` case does not update the `last_heartbeat` timestamp. A long
sequence of errors without token events will eventually trigger the health monitor's
heartbeat timeout — but only if the health monitor interval fires during processing.
There's a race condition.

### Fix

In `src/stream/supervisor.ts`, modify the `error` case in the switch to be more
aggressive:

```typescript
case "error":
  session.total_errors++;
  logger.error("Stream error event", {
    mission_id: session.mission_id,
    data: event.data,
  });
  // If we accumulate too many errors, fail immediately instead of
  // waiting for the iterator to exhaust.
  if (session.total_errors >= 3) {
    handleStreamFailure(
      session,
      `Too many stream errors (${session.total_errors})`,
    );
    return;
  }
  break;
```

Also, modify the `completion` case to check for prior errors:

```typescript
case "completion":
  if (session.total_errors > 0) {
    logger.warn("Completion received but errors occurred during stream", {
      mission_id: session.mission_id,
      total_errors: session.total_errors,
    });
    // Still treat as complete — the provider explicitly signaled completion.
    // But log the warning so it's visible in audit.
  }
  handleStreamComplete(session);
  return;
```

The post-loop fallback code (after the for-await) should remain as-is — it already
checks `total_errors > 0` and routes to failure. This is the safety net for when
an adapter yields error and returns without a completion event.

## Finding 2 (HIGH): Ollama agents with a specific model are undispatchable

### Problem

`ollama-adapter.ts` initializes `capabilities.models` to `[]`. The health check
fetches `/api/tags` but the original code never populated the models list from the
response. The `getBestProvider()` function in `registry.ts` filters providers by
`capabilities.models.includes(criteria.model)`, so if an agent has `model: "llama3.1:8b"`,
the Ollama provider will never match because its models list is empty.

### Fix

In `src/providers/adapters/ollama-adapter.ts`, the `healthCheck()` method needs to
populate `adapter.capabilities.models` from the `/api/tags` response.

The Ollama `/api/tags` endpoint returns:
```json
{ "models": [{ "name": "llama3.1:8b", "size": 4661226496, ... }, ...] }
```

Update the healthCheck to populate models:

```typescript
async healthCheck(): Promise<ProviderHealth> {
  const start = Date.now();
  try {
    const res = await fetch(statusUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return {
        status: "degraded",
        latency_ms: Date.now() - start,
        last_check: new Date().toISOString(),
        details: { http_status: res.status },
      };
    }
    const data = await res.json() as { models?: Array<{ name: string }> };
    
    // Populate the models list from /api/tags response so the registry
    // can route by model name. Without this, agents with a specific model
    // assigned can never be dispatched against this provider.
    if (Array.isArray(data.models)) {
      adapter.capabilities.models = data.models.map((m) => m.name);
    }
    
    return {
      status: "healthy",
      latency_ms: Date.now() - start,
      last_check: new Date().toISOString(),
      details: data,
    };
  } catch (err) {
    // ... existing error handling
  }
}
```

**Additionally:** The `getBestProvider()` function in `registry.ts` should treat an
empty models list as "accepts any model" rather than "accepts no model". Add a
fallback:

```typescript
// In getBestProvider, change the model filter:
if (criteria.model && p.capabilities.models.length > 0 && !p.capabilities.models.includes(criteria.model)) return false;
```

This way, a provider with `models: []` (models not yet discovered) doesn't get
excluded — it just hasn't been health-checked yet. Once health check runs and
populates the list, proper routing kicks in.

## Finding 3 (MEDIUM): PUT /agents/:id writes before validating

### Problem

`src/api/agents.ts` route `PUT /agents/:id` passes raw request JSON into
`updateAgent()`. The repository function in `agent-repo.ts` runs the SQL UPDATE
first, THEN calls `AgentSchema.parse()` on the merged result. If the payload
contains an invalid `runtime` value or malformed `capabilities`, the invalid data
is already persisted before validation throws. Subsequent reads will 500.

### Fix

In `src/db/repositories/agent-repo.ts`, validate BEFORE writing:

```typescript
export function updateAgent(
  id: string,
  updates: Partial<Omit<Agent, "id" | "created_at" | "updated_at">>,
): Agent | null {
  const existing = getAgent(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  // Validate BEFORE writing to DB — reject bad data early
  const validated = AgentSchema.parse(merged);

  getDb()
    .prepare(
      `UPDATE agents SET callsign = @callsign, division_id = @division_id, runtime = @runtime,
       endpoint_url = @endpoint_url, model = @model, health_status = @health_status,
       last_heartbeat = @last_heartbeat, persona_id = @persona_id, capabilities = @capabilities,
       updated_at = @updated_at WHERE id = @id`,
    )
    .run({
      id,
      callsign: validated.callsign,
      division_id: validated.division_id,
      runtime: validated.runtime,
      endpoint_url: validated.endpoint_url,
      model: validated.model,
      health_status: validated.health_status,
      last_heartbeat: validated.last_heartbeat,
      persona_id: validated.persona_id,
      capabilities: JSON.stringify(validated.capabilities),
      updated_at: now,
    });

  return validated;
}
```

Also add validation in the API route layer as a defense-in-depth measure.
In `src/api/agents.ts`, the PUT handler should catch Zod validation errors
and return 400 instead of letting them bubble as 500:

```typescript
agentRoutes.put("/:id", async (c) => {
  const body = await c.req.json();
  try {
    const agent = updateAgent(c.req.param("id"), body);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: err.issues }, 400);
    }
    throw err;
  }
});
```

## Verification

After all three fixes, run `pnpm test` and verify all tests pass.

Add new test cases:
1. Stream supervisor: error-only stream triggers failure (no false completion)
2. Stream supervisor: 3+ error events triggers early abort
3. Ollama adapter: healthCheck populates models from /api/tags response
4. getBestProvider: provider with empty models list matches any model
5. Agent update: invalid runtime returns 400, DB unchanged
6. Agent update: malformed capabilities returns 400, DB unchanged

## Do NOT

- Reference or import Engram, Herd Pro, or Operative
- Restructure the stream supervisor beyond these targeted fixes
- Change mission lifecycle or gate logic
