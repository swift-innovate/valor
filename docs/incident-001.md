# Incident 001: Stuck Mission — Telegram Gateway Not Receiving Completion

**Date:** 2026-03-21
**Severity:** P1
**Status:** Resolved

## Timeline

| Time (UTC) | Event |
|---|---|
| 18:55:55 | Telegram gateway starts, connects to NATS |
| 18:56:53 | `/mission` command dispatched from Telegram: "Debug the login timeout in the Telegram gateway to @valor_mc_bot" |
| 18:56:53 | Director receives inbound mission VM-003 |
| 18:56:53 | Director calls Ollama (gemma3:27b). Model requires VRAM reload because `llama3.1:8b` had permanent `keep_alive` hogging GPU memory |
| 18:57:07 | Director LLM responds after 13.4s (normally ~2.5s). Routes to forge, confidence 8 |
| 18:57:07 | Forge consumer picks up VM-003-3, acks, publishes pickup |
| 18:57:13 | Forge consumer completes mission (5s stub), publishes to `valor.missions.forge.complete` and `valor.review.pending` |
| 18:57:13+ | **Telegram gateway never receives completion** — mission appears stuck to user |

## Root Causes

### 1. Subject Mismatch (Primary)

The operative consumer published mission completion to:
- `valor.missions.forge.complete` (mission lifecycle stream)
- `valor.review.pending` (review submission)

The Telegram gateway subscribed to:
- `valor.sitreps.>` (sitrep stream)
- `valor.review.verdict.>` (verdicts only, not submissions)
- `valor.system.events`

**Gap:** No COMPLETE sitrep was published to `valor.sitreps.*`, and the gateway had no subscription on `valor.missions.*.complete`. The completion event went to the MISSIONS JetStream stream but the gateway never saw it.

### 2. Ollama VRAM Contention (Contributing)

`llama3.1:8b-instruct-q4_K_M` was loaded with permanent `keep_alive`, occupying VRAM. When the Director needed `gemma3:27b`, Ollama had to unload and reload, causing 13.4s latency instead of the normal ~2.5s. This wasn't the root cause of the stuck mission, but it degraded the user experience and made the problem feel worse.

### 3. No LLM Timeout (Contributing)

The Director's Ollama HTTP call had no timeout. If the model reload had hung instead of being slow, the Director would have blocked indefinitely with no error surfacing to the user.

## Fixes Applied

### Fix 1: Operative consumer publishes COMPLETE sitrep
`src/consumers/operative-consumer.ts` — Added `publishSitrep()` call with status `COMPLETE` before the existing `publishMissionComplete()`. The gateway, subscribed to `valor.sitreps.>`, now receives mission completions.

### Fix 2: Telegram gateway subscribes to mission lifecycle
`gateways/telegram/index.ts` — Added subscriptions for:
- `valor.missions.*.active` — operative pickup notifications
- `valor.missions.*.complete` — mission completion (belt-and-suspenders with sitrep)
- `valor.missions.*.failed` — mission failure notifications

### Fix 3: 60-second Ollama timeout
`src/director/llm-adapter.ts` — Added `AbortController` with 60s timeout on the fetch call. Throws a typed error on timeout instead of hanging indefinitely.

### Fix 4: Director publishes error sitrep on failure
`scripts/director-service.ts` — The catch block in the inbound mission handler now publishes a FAILED sitrep to `valor.sitreps.*` so the Telegram gateway (and user) sees Director pipeline errors instead of silent failures.

### Fix 5: Unloaded stale model
Ran `curl -d '{"model": "llama3.1:8b-instruct-q4_K_M", "keep_alive": 0}' http://starbase:40114/api/generate` to free VRAM for the Director's primary model.

## Lessons

1. **Every user-visible state change must publish to a subject the gateway subscribes to.** The MISSIONS JetStream stream is for durable lifecycle tracking; the sitrep stream is for real-time notification. Both must be covered.
2. **All external HTTP calls need timeouts.** Ollama model reloads can take 30s+ depending on VRAM state. Without a timeout, a hung model blocks the entire Director pipeline silently.
3. **Model VRAM management matters.** Persistent `keep_alive` on secondary models causes contention. Future: track loaded models and unload unused ones proactively, or set reasonable `keep_alive` TTLs.
