# VALOR Director Safety Gate Specification

**Document:** VM-007  
**Operative:** Crazy-Eddie  
**Status:** COMPLETE  
**Last Updated:** 2026-03-21  
**References:** [director-model-selection.md](./director-model-selection.md), [PHASE-1-NATS.md](./PHASE-1-NATS.md)

---

## Background

Benchmark analysis (VM-005) found that **all tested models except qwen3.5:27b failed financial transaction safety prompts**. Even Gemma3:27b (recommended Director model) cannot reliably recognize and refuse high-risk mission patterns. This is not a model capability gap — it is a fundamental architectural requirement.

Safety gates run **before the Director LLM sees any input**. They are synchronous, deterministic, and require zero inference. If a gate fires, the mission is intercepted and the Principal is notified. The LLM never executes the mission.

---

## Architecture

```
Principal input (Telegram message / NATS publish)
  │
  ▼
┌─────────────────────┐
│   Safety Gate Layer  │  ← runs first, always
│   (regex + rules)    │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
  PASS          INTERCEPT
    │             │
    ▼             ▼
Director LLM   Escalate to Principal via Telegram
               Block execution
               Log intercept
               Wait for APPROVED override (or timeout → abort)
```

---

## Gate Categories

### P0 — Financial Transactions (BLOCK immediately, escalate)

Missions involving financial transfers, payments, purchases, or monetary movements.

```typescript
export const P0_FINANCIAL_PATTERNS: RegExp[] = [
  // Wire transfers, bank operations
  /\b(wire\s+transfer|bank\s+transfer|ACH|SWIFT|routing\s+number)\b/i,

  // Payment execution
  /\b(send|transfer|move|wire)\s+\$?\d+(\.\d{2})?\b/i,
  /\b(pay|payment|payout)\s+(to|for)\s+\w/i,
  /\bpurchase\s+(order|invoice|PO)\s*#?\d+/i,

  // Cryptocurrency
  /\b(send|transfer|move)\s+(BTC|ETH|SOL|USDC|crypto|bitcoin|ethereum)\b/i,
  /\b(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/,  // ETH/BTC addresses

  // Account credentials
  /\b(credit\s+card|debit\s+card|card\s+number|CVV|expir(y|ation))\b/i,
  /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/,  // Card number pattern

  // Invoices and billing
  /\b(submit|pay|approve|process)\s+(invoice|bill|charge)\b/i,
  /\bcharg(e|ing)\s+(customer|client|account)\b/i,

  // Refunds and reversals
  /\b(issue|process|send)\s+(refund|chargeback|reversal)\b/i,
];
```

**On match:** Block immediately. Send Telegram alert to Principal with exact mission text and matched pattern. Log intercept with timestamp. Do not forward to Director LLM. Await APPROVED override with 10-minute timeout, then auto-abort.

---

### P1 — Mass Communications & Destructive Operations (BLOCK, escalate)

Bulk outreach or irreversible system operations.

```typescript
export const P1_MASS_COMMS_PATTERNS: RegExp[] = [
  // Bulk email / SMS
  /\b(blast|broadcast|bulk\s+email|mass\s+email|mass\s+SMS|email\s+all|SMS\s+all)\b/i,
  /\bsend\s+(to\s+)?(all|everyone|entire\s+list|subscriber|mailing\s+list)\b/i,
  /\b(newsletter|campaign)\s+(send|launch|fire|blast)\b/i,
  /\bsubscriber(s)?\s+(count|list).*send\b/i,

  // Destructive operations — data
  /\b(delete|drop|truncate|wipe|purge)\s+(all|entire|database|table|bucket|volume)\b/i,
  /\b(rm\s+-rf|format\s+c:|del\s+\/[sq])\b/i,
  /\bfactory\s+reset\b/i,

  // Destructive operations — infrastructure
  /\b(terminate|destroy|delete)\s+(all\s+)?(instance|server|node|cluster|stack|environment)\b/i,
  /\b(shutdown|poweroff|kill)\s+(all|every|production|prod)\b/i,
  /\bdestroy\s+infrastructure\b/i,

  // Credentials rotation / revocation at scale
  /\b(rotate|revoke|invalidate)\s+(all|every)\s+(key|token|credential|secret|API\s+key)\b/i,
];
```

**On match:** Block. Escalate to Principal via Telegram. Log intercept. Await APPROVED override with 5-minute timeout, then auto-abort.

---

### P2 — Public Content Publishing (WARN, escalate, proceed on approval)

Actions that publish content publicly or on behalf of the organization.

```typescript
export const P2_PUBLIC_PUBLISH_PATTERNS: RegExp[] = [
  // Social media posting
  /\b(post|publish|tweet|share)\s+(to|on)\s+(Twitter|X|LinkedIn|Instagram|Facebook|TikTok)\b/i,
  /\b(social\s+media|social\s+post)\s+(publish|go\s+live|schedule)\b/i,

  // Blog / website publishing
  /\b(publish|go\s+live|deploy)\s+(blog\s+post|article|press\s+release)\b/i,
  /\b(update|change|edit)\s+(homepage|landing\s+page|public\s+site)\b/i,

  // PR and announcements
  /\b(press\s+release|public\s+statement|announcement)\s+(send|publish|release)\b/i,
  /\bsend\s+(PR|press\s+release)\s+to\b/i,

  // Domain / DNS changes
  /\b(update|change|modify)\s+(DNS|domain|subdomain|A\s+record|CNAME)\b/i,

  // App store / marketplace
  /\b(submit|publish|release)\s+(to\s+)?(App\s+Store|Play\s+Store|marketplace)\b/i,
  /\bapp\s+(release|submission|update)\s+(v\d|version)\b/i,
];
```

**On match:** Do not block immediately. Send Telegram alert to Principal with mission text and matched pattern. Forward to Director LLM with a prepended system note: `"NOTE: This mission triggered a P2 safety gate (public content publishing). Principal has been notified. Proceed only if Principal confirms APPROVED."` Await APPROVED before any publish action. 2-minute timeout, then hold pending.

---

## Gate Behavior

### Intercept Flow

```typescript
interface GateIntercept {
  mission_text: string;
  matched_gate: "P0" | "P1" | "P2";
  matched_patterns: string[];      // Which regex patterns fired
  intercept_id: string;            // UUID for this intercept event
  intercepted_at: string;          // ISO 8601
  status: "PENDING" | "APPROVED" | "ABORTED";
  override_by: string | null;      // Principal identifier if overridden
  override_at: string | null;      // ISO 8601
}
```

### Telegram Escalation Format

```
⛔ VALOR SAFETY GATE — P0 FINANCIAL
─────────────────────────────────────
Mission intercepted at: 2026-03-21 14:32:07 UTC
Intercept ID: gate_abc123

Mission text:
"Transfer $500 to contractor via PayPal"

Matched: wire transfer / payment pattern

To approve: Reply APPROVED gate_abc123
To abort: Reply ABORT gate_abc123
Auto-aborts in: 10 minutes
```

P2 format is softer:
```
⚠️ VALOR SAFETY GATE — P2 PUBLIC CONTENT
─────────────────────────────────────────
Mission flagged for Principal review.
Intercept ID: gate_xyz789

Mission text:
"Publish the product launch blog post to swiftinnovate.tech"

Matched: public content publishing pattern

Director LLM is holding. To proceed: Reply APPROVED gate_xyz789
Auto-holds until approved (no auto-abort for P2).
```

### Logging

Every intercept is logged to the gate log regardless of outcome:

```typescript
interface GateLogEntry {
  intercept_id: string;
  timestamp: string;
  gate_level: "P0" | "P1" | "P2";
  mission_text: string;
  matched_patterns: string[];
  outcome: "ABORTED" | "APPROVED" | "TIMEOUT_ABORTED" | "HOLDING";
  override_by: string | null;
  duration_ms: number;
}
```

Log destination: append-only file at `logs/safety-gate.jsonl`. Never deleted, never truncated. This is the audit trail.

---

## Bypass Mechanism

### Principal Override

The Principal (Tom) can override any intercepted gate by replying to the Telegram escalation message with:

```
APPROVED gate_<intercept_id>
```

The gate listener parses incoming Telegram messages for this pattern:

```typescript
const OVERRIDE_PATTERN = /^APPROVED\s+gate_([a-zA-Z0-9]+)$/i;
const ABORT_PATTERN = /^ABORT\s+gate_([a-zA-Z0-9]+)$/i;
```

**On APPROVED match:**
1. Look up intercept by ID in the intercept store
2. Verify the sender is a known Principal (whitelist of Telegram user IDs)
3. Mark intercept as `APPROVED`, record `override_by` and `override_at`
4. Forward original mission to Director LLM with prepended note: `"NOTE: Safety gate P{level} was triggered and manually overridden by Principal at {timestamp}. Proceed with mission."`
5. Log the override

**On ABORT match:**
1. Look up intercept
2. Mark as `ABORTED`
3. Reply to Principal: `"✅ Mission aborted. Intercept gate_<id> closed."`

**Principal whitelist** — Telegram user IDs authorized to override gates. Configured via environment variable `VALOR_PRINCIPAL_IDS` (comma-separated):

```
VALOR_PRINCIPAL_IDS=8551062231,other_id
```

Overrides from unknown Telegram IDs are ignored and logged as unauthorized attempts.

### Timeout Behavior

| Gate | Default Timeout | On Timeout |
|------|----------------|-----------|
| P0 | 10 minutes | Auto-abort, send Telegram confirmation |
| P1 | 5 minutes | Auto-abort, send Telegram confirmation |
| P2 | None | Hold indefinitely until Principal responds |

P2 missions hold until explicitly approved or aborted — they are not time-critical in the same way as P0/P1, and it's better to wait than to abort a valid publishing task.

---

## Test Cases

The following mission strings test gate behavior. Format: `[expected gate or PASS]` + mission text.

### Should Trigger P0

1. `[P0]` `"Wire $2,000 to John's contractor account at Chase routing 021000021"`
2. `[P0]` `"Process the invoice from DigitalOcean and pay it"`
3. `[P0]` `"Send 0.5 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e"`
4. `[P0]` `"Issue a refund to the customer for their $149 purchase"`
5. `[P0]` `"Transfer budget from Q1 to Q2 account"`

### Should Trigger P1

6. `[P1]` `"Send a bulk email to all 347 Operatives subscribers about the product launch"`
7. `[P1]` `"Delete all records from the events table in the production database"`
8. `[P1]` `"Terminate all staging EC2 instances to save costs"`
9. `[P1]` `"Mass SMS all customers about the service outage"`
10. `[P1]` `"Wipe the S3 bucket and re-upload with the new assets"`

### Should Trigger P2

11. `[P2]` `"Publish the new blog post about VALOR architecture to swiftinnovate.tech"`
12. `[P2]` `"Tweet the Augmented Games win announcement from the SIT account"`
13. `[P2]` `"Update the DNS A record for api.swiftinnovate.tech to point to the new server"`
14. `[P2]` `"Submit the iOS app update to the App Store"`

### Should PASS (no gate triggered)

15. `[PASS]` `"Research competitor pricing for AutoSelfHost and write a summary"`
16. `[PASS]` `"Review the PR from Gage and leave comments"`
17. `[PASS]` `"Draft a blog post about VALOR architecture for Tom to review"`
18. `[PASS]` `"Update the internal BOARD.md with mission status"`
19. `[PASS]` `"Run the test suite and report results"`
20. `[PASS]` `"Create a budget forecast spreadsheet for Q2 planning"`

---

## False Positive Handling

Common phrases that could accidentally trigger gates — and why they don't (or how to handle them if they do).

### P0 False Positives

| Phrase | Why it might match | Mitigation |
|--------|-------------------|-----------|
| `"document the payment flow for the API"` | "payment" keyword | Pattern requires action verb before payment object (`pay|send|process`) — "document" doesn't match |
| `"review the invoice format"` | "invoice" keyword | Pattern requires action verb (`submit|pay|approve|process`) before "invoice" — "review" doesn't match |
| `"calculate transfer time between checkpoints"` | "transfer" keyword | Pattern requires `\$` or `\d+` amount adjacent to "transfer" — no amount present |
| `"add Stripe integration to the checkout page"` | "credit card" adjacent | Card number pattern requires digit-group format; "Stripe" + "checkout" won't match the regex |

### P1 False Positives

| Phrase | Why it might match | Mitigation |
|--------|-------------------|-----------|
| `"send a status update to all team members in Slack"` | "send...all" | Tighten pattern to require "list", "subscriber", or count before "all" — internal Slack is not mass comms |
| `"delete the test branch from the repo"` | "delete" keyword | Pattern requires "all/entire/database/table" after delete — a branch doesn't match |
| `"shut down the dev server for maintenance"` | "shutdown" keyword | Pattern requires "all/every/production/prod" after shutdown — "dev server" doesn't match |

### P2 False Positives

| Phrase | Why it might match | Mitigation |
|--------|-------------------|-----------|
| `"post a comment on the GitHub PR"` | "post" keyword | Pattern requires platform name (Twitter, LinkedIn, etc.) after post — GitHub is not in the list |
| `"share the benchmark results with Mira"` | "share" keyword | Pattern requires social platform after "share...on" — sharing to an agent doesn't match |
| `"update the readme"` | "update" + site adjacent | Pattern requires explicit public domain or page reference |

### General Strategy

If a legitimate mission triggers a gate, the correct behavior is: **Principal approves it via the override mechanism**. False positives are not bugs — they are expected edge cases in a conservative system. The override exists precisely for this. The cost of a false positive (10 seconds to type `APPROVED gate_xyz`) is far lower than the cost of a false negative (an unintended financial transaction or mass email).

**If a specific legitimate phrase triggers gates repeatedly**, add it to a whitelist in the gate configuration:

```typescript
export const GATE_WHITELIST: RegExp[] = [
  /\bdocument\s+the\s+payment\s+flow\b/i,
  // Add specific recurring false positives here
];
```

Whitelist patterns are checked before gate patterns. If a whitelist pattern matches, all gates are skipped.

---

## Implementation Notes for Gage (VM-008)

1. **Gate evaluation is synchronous** — run all patterns before any async work
2. **Evaluate in priority order** — P0 → P1 → P2. Stop at first match (a mission can only trigger one gate level)
3. **Pattern arrays are immutable at runtime** — load once, never reload without restart
4. **Intercept store** — in-memory Map<intercept_id, GateIntercept> is sufficient for Phase 1; intercepts are short-lived
5. **Telegram listener** — the existing Telegram channel integration should be extended to watch for `APPROVED|ABORT gate_` messages from whitelisted Principal IDs
6. **Do not log mission text to stdout** — gate intercept logs go to `logs/safety-gate.jsonl` only; sensitive financial details should not appear in process logs
7. **Gate configuration** — patterns should be importable from a single `src/gates/patterns.ts` file; no hardcoding in the gate runner itself
