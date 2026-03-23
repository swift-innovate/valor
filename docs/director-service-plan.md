# Director LLM Service — Activation Plan

**Mission:** VM-030 — Make the Director LLM a Running Service  
**Author:** Gage (Code Division Lead)  
**Date:** 2026-03-22  
**Priority:** P0 — Required for daily VALOR use  
**Estimated Effort:** 3–5 days  

---

## Executive Summary

The Director LLM is the single most critical gap preventing VALOR from daily use. The good news: **~90% of the code already exists.** The Director pipeline (safety gates → dual-gear classifier → NATS dispatcher), the service script (`scripts/director-service.ts`), the Telegram gateway, the operative consumer template, and the startup/shutdown scripts are all built and tested. What's missing is **integration testing with real infrastructure and deployment hardening.**

This plan closes the gap in 5 phases over 3–5 days.

---

## Current State — What Already Exists

| Component | File | Status |
|-----------|------|--------|
| Safety gates (P0/P1/P2 regex, whitelist) | `src/director/safety-gates.ts` | ✅ Built + tested |
| LLM adapter (Ollama HTTP, timeout/retry, typed errors) | `src/director/llm-adapter.ts` | ✅ Built |
| Classifier (dual-gear, confidence threshold, JSON recovery) | `src/director/classifier.ts` | ✅ Built + tested (mocked LLM) |
| Dispatcher (ROUTE/DECOMPOSE/ESCALATE → NATS) | `src/director/dispatcher.ts` | ✅ Built + tested |
| Director pipeline (`handleMission()`) | `src/director/index.ts` | ✅ Built + tested (E2E with mock) |
| System prompt with dynamic roster | `src/director/system-prompt.md` + `roster.ts` | ✅ Built |
| Director service process | `scripts/director-service.ts` | ✅ Built (never run against real infra) |
| Operative consumer template | `src/consumers/operative-consumer.ts` | ✅ Built (stub execution) |
| Telegram gateway (commands + sitrep relay) | `gateways/telegram/index.ts` | ✅ Built (never deployed) |
| Startup script | `scripts/start-valor.sh` | ✅ Built |
| Shutdown script | `scripts/stop-valor.sh` | ✅ Built |
| E2E tests (5 scenarios, real NATS) | `tests/integration/e2e-mission-lifecycle.test.ts` | ✅ Passing (mocked LLM) |
| NATS validation script | `scripts/validate-nats.ts` | ✅ Built + passing |

### What Has NOT Been Tested

1. `director-service.ts` against a real NATS server + real Ollama
2. Telegram gateway end-to-end (bot → NATS → Director → sitrep → bot)
3. Operative consumer picking up a real dispatched mission
4. The full startup script on the target deployment host
5. Ollama with `gemma3:27b` and `nemotron-cascade-2:latest` loaded and responding to the Director prompt format

---

## Phase 1 — Verify Infrastructure Connectivity (Day 1, ~2 hours)

**Goal:** Confirm all services are reachable and models are loaded.

### 1.1 — Verify Ollama Models on CITADEL

```bash
# From the deployment host (mirapc or future valor-vm)
curl http://starbase:40114/api/tags | jq '.models[].name'
```

**Required models:**
- `gemma3:27b` (Gear 1 — fast classifier)
- `nemotron-cascade-2:latest` (Gear 2 — reasoning fallback)

If missing, pull them:
```bash
ssh citadel "ollama pull gemma3:27b"
ssh citadel "ollama pull nemotron-cascade-2:latest"
```

### 1.2 — Test Director LLM Adapter Directly

Create a one-shot test script: `scripts/test-director-llm.ts`

```typescript
/**
 * Smoke test: Call Gear 1 with a simple mission and print the response.
 * Usage: OLLAMA_BASE_URL=http://starbase:40114 npx tsx scripts/test-director-llm.ts
 */
import { callGear1 } from "../src/director/llm-adapter.js";
import { buildRosterPromptSection } from "../src/director/roster.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptTemplate = readFileSync(
  resolve(__dirname, "../src/director/system-prompt.md"),
  "utf-8",
);

// Build prompt with live roster (or empty roster if no agent cards)
const roster = buildRosterPromptSection();
const systemPrompt = promptTemplate.replace("{{OPERATIVE_ROSTER}}", roster);

console.log("System prompt length:", systemPrompt.length, "chars");
console.log("Roster section:", roster.slice(0, 200));
console.log("\nCalling Gear 1...\n");

const start = Date.now();
const response = await callGear1(
  systemPrompt,
  'Mission: "Check the ranch temperature sensors and report status"',
);

console.log("Duration:", Date.now() - start, "ms");
console.log("Model:", response.model);
console.log("Eval count:", response.evalCount);
console.log("\nRaw response:\n", response.content);

// Try parsing
try {
  const parsed = JSON.parse(response.content);
  console.log("\nParsed decision:", parsed.decision);
  console.log("Confidence:", parsed.confidence);
  console.log("Routing:", parsed.routing);
} catch {
  console.log("\n⚠️ Response is not valid JSON — classifier will attempt recovery");
}
```

**Success criteria:**
- Response returns within 60 seconds
- Response is valid JSON (or recoverable by the classifier's `parseDirectorJson()`)
- Decision is `ROUTE` or `ESCALATE` (since there may be no agent cards registered yet)

### 1.3 — Verify NATS Server

```bash
# Start NATS if not running
cd G:\Projects\SIT\valor-engine
./infrastructure/bin/nats-server -c infrastructure/nats.conf &

# Validate streams
NATS_URL=nats://localhost:4222 npx tsx scripts/validate-nats.ts
```

**Success criteria:** All 27 validation tests pass.

### 1.4 — Ensure Agent Cards Exist

The Director's roster is built dynamically from approved agent cards in the database. Without agent cards, the roster is empty and the Director escalates everything.

Check existing cards:
```bash
curl http://localhost:3200/agent-cards
```

If empty, seed at least one operative for testing (e.g., Eddie or Mira) via the dashboard or a seed script. The `agent_cards` table needs rows with `approval_status = 'approved'`.

---

## Phase 2 — Live Director Service Test (Day 1–2, ~3 hours)

**Goal:** Run `director-service.ts` against real NATS + real Ollama and process a test mission.

### 2.1 — Start the Director Service

```bash
# Terminal 1: NATS (if not already running)
./infrastructure/bin/nats-server -c infrastructure/nats.conf

# Terminal 2: VALOR engine server (for DB access by roster.ts)
npx tsx src/index.ts

# Terminal 3: Director service
OLLAMA_BASE_URL=http://starbase:40114 \
DIRECTOR_MODEL=gemma3:27b \
DIRECTOR_GEAR2_MODEL=nemotron-cascade-2:latest \
NATS_URL=nats://localhost:4222 \
LOG_LEVEL=info \
npx tsx scripts/director-service.ts
```

### 2.2 — Inject a Test Mission via NATS

Create `scripts/inject-mission.ts`:

```typescript
/**
 * Inject a mission directly into the Director's NATS subject.
 * Usage: npx tsx scripts/inject-mission.ts "Check ranch sensors"
 */
import { getNatsConnection, closeNatsConnection, ensureStreams } from "../src/nats/index.js";

const missionText = process.argv[2] ?? "Check the ranch temperature sensors and report status";

const nc = await getNatsConnection({ servers: ["nats://localhost:4222"], name: "injector" });
await ensureStreams(nc);

const envelope = {
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  source: "test-injector",
  type: "mission.inbound",
  payload: { text: missionText, source_channel: "cli", principal_id: "director" },
};

nc.publish("valor.missions.inbound", new TextEncoder().encode(JSON.stringify(envelope)));
console.log(`✅ Mission injected: "${missionText}"`);

// Give NATS time to flush
await new Promise((r) => setTimeout(r, 1000));
await closeNatsConnection();
```

### 2.3 — Test Scenarios

Run each and observe Director service logs:

| # | Mission Text | Expected Decision | Expected Routing |
|---|-------------|-------------------|-----------------|
| 1 | "Check the ranch temperature sensors" | ROUTE | zeke (if registered) or ESCALATE |
| 2 | "Debug the login timeout in the Telegram gateway" | ROUTE | forge or gage |
| 3 | "Transfer $500 from checking to savings" | GATE INTERCEPT (P0) | No LLM call |
| 4 | "Launch the Fracture Code email campaign" | DECOMPOSE or ESCALATE (P1 gate) | Multiple sub-missions or gate |
| 5 | "Redesign the monitoring pipeline with alerting" | DECOMPOSE (possibly Gear 2) | Multiple agents |

**Success criteria for each:**
- Director logs show mission received on `valor.missions.inbound`
- Safety gates fire correctly for financial/mass-comm patterns
- LLM responds with valid JSON
- Mission briefs appear on the correct NATS subjects (`valor.missions.<operative>.pending`)
- Sitreps appear on `valor.sitreps.director`

### 2.4 — Record Issues

Create `docs/director-test-results.md` documenting:
- Actual response times per mission
- JSON parse success/failure rates
- Any model hallucinations (routing to non-existent operatives)
- Confidence scores and whether Gear 2 escalation triggers appropriately
- Any error conditions encountered

---

## Phase 3 — Confidence Threshold Tuning (Day 2–3, ~2 hours)

**Goal:** Calibrate the Gear 1 → Gear 2 escalation threshold.

### Current Setting

```
DIRECTOR_CONFIDENCE_THRESHOLD=5 (from config.ts default)
```

### Tuning Process

1. Run 10–15 diverse missions through the Director with `LOG_LEVEL=debug`
2. Record: mission text, Gear 1 confidence, Gear 1 decision, whether Gear 2 was needed
3. If Gear 2 triggers too often (>40% of missions), raise threshold to 4 or 3
4. If Gear 2 never triggers but routing quality is poor, lower to 6 or 7
5. If Gear 1 consistently produces good results at confidence 7+, threshold 5 is correct

### Model Substitution (if needed)

If `gemma3:27b` is too slow or produces poor JSON, consider:
- Gear 1: `qwen3:14b` or `llama3.1:8b` (faster, may sacrifice quality)
- Gear 2: `deepseek-r1:32b` or keep `nemotron-cascade-2`

The adapter is model-agnostic — just change `DIRECTOR_MODEL` env var.

---

## Phase 4 — End-to-End Pipeline Validation (Day 3–4, ~4 hours)

**Goal:** Prove the complete flow: Telegram → Director → NATS → Consumer → Sitrep → Telegram.

### 4.1 — Start Full Stack

Use the startup script:
```bash
# Ensure .env has:
#   TELEGRAM_BOT_TOKEN=<your bot token>
#   PRINCIPAL_TELEGRAM_ID=8551062231
#   OLLAMA_BASE_URL=http://starbase:40114
#   NATS_URL=nats://localhost:4222

bash scripts/start-valor.sh
```

Verify all 6 steps complete (NATS, streams, server, director, consumers, telegram).

### 4.2 — Telegram Dispatch Test

From your phone or Telegram desktop:

```
/mission Check the ranch temperature sensors
```

**Expected flow:**
1. Telegram gateway receives command, publishes to `valor.missions.inbound`
2. Director service picks up, classifies → ROUTE to zeke
3. Director publishes mission brief to `valor.missions.zeke.pending`
4. Director publishes sitrep (classification result) to `valor.sitreps.director`
5. Telegram gateway relays sitrep back to your chat
6. If operative consumer is running for zeke, it picks up and acknowledges

### 4.3 — Safety Gate Test via Telegram

```
/mission Transfer $200 from checking to cover the feed bill
```

**Expected:** Gate fires immediately, escalation message appears in Telegram with APPROVED/ABORT buttons.

### 4.4 — Decomposition Test

```
/mission Plan and execute the April email campaign for Operatives subscribers
```

**Expected:** Director decomposes into research → draft → approval sub-missions, each published to the appropriate operative's NATS subject.

### 4.5 — Consumer Lifecycle Test

Start a consumer for at least one operative:
```bash
npx tsx src/consumers/operative-consumer.ts --operative eddie --nats nats://localhost:4222
```

Dispatch a mission routed to eddie. The consumer should:
1. Pick up the mission from JetStream
2. Publish pickup sitrep
3. Execute (stub — logs "simulating work")
4. Publish completion sitrep
5. Submit for review

---

## Phase 5 — Deployment Hardening (Day 4–5, ~3 hours)

**Goal:** Make the Director service production-ready for daily use.

### 5.1 — NATS Systemd Service

Create `/etc/systemd/system/nats.service` (or user service on mirapc):

```ini
[Unit]
Description=NATS Server for VALOR
After=network.target

[Service]
Type=simple
User=tom-s
WorkingDirectory=G:\Projects\SIT\valor-engine
ExecStart=G:\Projects\SIT\valor-engine\infrastructure\bin\nats-server -c infrastructure\nats.conf
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> **Note:** On Windows/WSL, use a startup script or Task Scheduler equivalent. On the future Proxmox VM (Linux), use the systemd unit above.

### 5.2 — Director Service Wrapper

The Director service needs to be resilient to:
- NATS disconnects (reconnection is handled by the NATS client)
- Ollama cold starts (model loading delay — already handled with retry logic)
- Unhandled exceptions (wrap main loop in try/catch, log, continue)

The current `director-service.ts` already handles most of this. One addition: **add a periodic health check tick** that pings Ollama and publishes a heartbeat sitrep.

Add to `director-service.ts` after the subscription setup:

```typescript
// Periodic health check — every 60 seconds
setInterval(async () => {
  const healthy = await checkOllamaHealth();
  if (!healthy) {
    logger.warn("Ollama health check failed — Director will retry on next mission");
  }
}, 60_000);
```

### 5.3 — Add `director` Script to package.json

```json
{
  "scripts": {
    "director": "node --import tsx scripts/director-service.ts",
    "director:dev": "tsx watch scripts/director-service.ts"
  }
}
```

### 5.4 — Smoke Test Script

Create `scripts/smoke-director.ts` — a quick post-deployment validator:

```typescript
/**
 * Smoke test: Inject a safe mission, wait for sitrep, verify.
 * Usage: npx tsx scripts/smoke-director.ts
 * Requires: Director service + NATS running.
 */
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
  subscribeComms,
} from "../src/nats/index.js";
import type { NatsSitrep } from "../src/nats/index.js";

const nc = await getNatsConnection({ servers: ["nats://localhost:4222"], name: "smoke" });
await ensureStreams(nc);

let sitrepReceived = false;

// Subscribe to sitreps
const sub = nc.subscribe("valor.sitreps.director", {
  callback: (_err, msg) => {
    const text = new TextDecoder().decode(msg.data);
    console.log("📋 Sitrep received:", text.slice(0, 200));
    sitrepReceived = true;
  },
});

// Inject mission
const envelope = {
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  source: "smoke-test",
  type: "mission.inbound",
  payload: { text: "Check system health and report status", source_channel: "smoke" },
};
nc.publish("valor.missions.inbound", new TextEncoder().encode(JSON.stringify(envelope)));
console.log("✅ Smoke mission injected");

// Wait up to 90 seconds for sitrep
const deadline = Date.now() + 90_000;
while (!sitrepReceived && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
}

sub.unsubscribe();
await closeNatsConnection();

if (sitrepReceived) {
  console.log("\n\n✅ SMOKE TEST PASSED — Director is processing missions");
  process.exit(0);
} else {
  console.log("\n\n❌ SMOKE TEST FAILED — No sitrep received within 90s");
  console.log("Check: Is director-service.ts running? Is Ollama reachable?");
  process.exit(1);
}
```

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Ollama model too slow (>60s per classification) | Medium | Director times out | Already handled: 60s timeout → 30s wait → retry. Also consider faster Gear 1 model. |
| `gemma3:27b` produces invalid JSON | Medium | Classifier can't parse | Already handled: 3-tier JSON recovery (direct, code block, brace extraction). Monitor and tune prompt if >20% failure. |
| NATS server not running on boot | High | Entire pipeline dead | Phase 5.1 — systemd service or startup script. |
| No agent cards in DB | High | Director escalates everything | Phase 1.4 — seed cards before testing. |
| Telegram bot token expired or invalid | Low | Gateway won't start | Verify token with `curl https://api.telegram.org/bot<TOKEN>/getMe` before deployment. |
| Model routes to non-existent operative | Medium | Mission goes nowhere | Already handled: `roster.ts` validates callsigns, forces ESCALATE if unregistered. |

---

## Success Criteria

**Phase complete when:**

1. ✅ `pnpm run director` starts and logs "Director service ready"
2. ✅ A mission injected via `scripts/inject-mission.ts` produces a valid ROUTE/DECOMPOSE/ESCALATE within 60s
3. ✅ Safety gates block financial transactions without calling the LLM
4. ✅ The Telegram `/mission` command triggers the full pipeline and returns a sitrep
5. ✅ The smoke test (`scripts/smoke-director.ts`) passes on a clean start
6. ✅ The Director survives Ollama being temporarily unreachable (retries, doesn't crash)

---

## Dependency Chain

```
Phase 1 (infra check) ──→ Phase 2 (live test) ──→ Phase 3 (tuning)
                                                        │
                                                        ↓
                                              Phase 4 (E2E pipeline)
                                                        │
                                                        ↓
                                              Phase 5 (hardening)
```

Phases 1–2 can be done in a single session. Phase 3 runs concurrently with early Phase 4 testing. Phase 5 is independent cleanup.

---

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/test-director-llm.ts` | One-shot LLM smoke test |
| `scripts/inject-mission.ts` | CLI mission injector for testing |
| `scripts/smoke-director.ts` | Post-deployment smoke test |
| `docs/director-test-results.md` | Test results log (created during Phase 2) |

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `director` and `director:dev` scripts |
| `scripts/director-service.ts` | Add periodic Ollama health check interval |

## Files Already Complete (No Changes Needed)

- `src/director/` — entire directory
- `src/nats/` — entire directory
- `src/consumers/operative-consumer.ts`
- `gateways/telegram/index.ts`
- `scripts/start-valor.sh`
- `scripts/stop-valor.sh`
- `tests/integration/e2e-mission-lifecycle.test.ts`

---

**Bottom line:** This isn't a build — it's an integration and activation. The code is there. We need to wire it to real infrastructure, validate it works with real models, tune the confidence threshold, and harden for daily use.

Let's light this thing up. 🚀
