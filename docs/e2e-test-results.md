# VALOR E2E Integration Test Results

**Mission:** VM-017
**Operative:** Gage
**Date:** 2026-03-21
**NATS Server:** v2.11.4 (infrastructure/bin/nats-server)
**LLM:** Mocked (vi.mock on llm-adapter)

---

## Summary

| Test | Scenario | Result | Duration |
|------|----------|--------|----------|
| 1 | Simple Route (Happy Path) | **PASS** | ~2s |
| 2 | Safety Gate Intercept | **PASS** | ~1s |
| 3 | Complex Decomposition | **PASS** | ~2s |
| 4 | Gear Escalation (Gear 1 → Gear 2) | **PASS** | <1s |
| 5 | Consumer Failure Recovery | **PASS** | ~6s |

**Result: 5/5 PASSED**

---

## Test Details

### Test 1: Simple Route (Happy Path)

**Input:** "Debug the login timeout issue in the Telegram gateway"

**Verified:**
- Safety gates pass (no pattern match)
- Director classifier returns ROUTE with `operative: "forge"`
- Confidence 9/10 — Gear 1 only (1 LLM call)
- MissionBrief published to `valor.missions.forge.pending`
- Consumer picks up, publishes MissionPickup to `valor.missions.forge.active`
- Consumer publishes sitrep (IN_PROGRESS → COMPLETE)
- ReviewSubmission published to `valor.review.pending`
- Full round-trip completes without error

### Test 2: Safety Gate Intercept

**Input:** "Transfer $200 from checking to cover the feed bill"

**Verified:**
- P0 (financial) gate fires — matched patterns: `Transfer $200`, `Transfer $200 from checking`
- LLM is NOT called (0 calls)
- ESCALATE sitrep published with gate identification
- Escalation message contains "SAFETY GATE"
- No MissionBrief published to any operative (Herbie consumer confirmed empty)

### Test 3: Complex Decomposition

**Input:** "Launch the Fracture Code marketing campaign — email, ads, and landing page"

**Verified:**
- Safety gates pass
- Director returns DECOMPOSE with 3 sub-missions
- Sub-mission dependency ordering correct:
  - Mira (research) → no dependencies
  - Eddie (email) → depends on Mira's task
  - Forge (landing page) → depends on Mira's task
- All 3 MissionBriefs published to correct operatives
- Parent mission tracking: all sub-missions reference `VM-E2E-003` as parent

### Test 4: Gear Escalation

**Input:** "Redesign the entire monitoring pipeline with new alerting and cross-division dashboards"

**Verified:**
- Gear 1 called first — returns confidence 2 (below threshold 5)
- Gear 2 called as fallback — returns confidence 8
- Total LLM calls: 2 (one per gear)
- Final result uses Gear 2 output (DECOMPOSE, 2 sub-missions)
- Dispatch creates 2 sub-missions successfully

### Test 5: Consumer Failure Recovery

**Verified:**
- Published mission to `valor.missions.zeke.pending`
- Consumer NAKs first delivery → JetStream redelivers after ack_wait (2s)
- Consumer NAKs second delivery → JetStream redelivers again
- Consumer ACKs third delivery → message settled
- Delivery count: 3 (matches max_deliver setting)
- JetStream redelivery works correctly within configured limits

---

## Architecture Validated

```
Telegram (simulated)
  │
  ▼
Safety Gates ──→ ESCALATE (if P0/P1/P2 match)
  │ PASS
  ▼
Classifier (Gear 1)
  │
  ├─ confidence ≥ 5 → Dispatch
  │
  └─ confidence < 5 → Classifier (Gear 2) → Dispatch
                                              │
                          ┌───────────────────┤
                          ▼                   ▼
                   ROUTE (single)    DECOMPOSE (multi)
                          │                   │
                          ▼                   ▼
              valor.missions.{op}.pending   N × valor.missions.{op}.pending
                          │                   │
                          ▼                   ▼
                   Consumer picks up   Consumers pick up (ordered by deps)
                          │
                          ▼
              Sitreps → Review → Complete
```

## Issues Found

None. All 5 scenarios passed on first run after mock setup was corrected.

## Notes

- LLM is mocked in tests — live model validation should be done on CITADEL with gemma3:27b
- NATS server is started/stopped per test suite run using infrastructure/bin/nats-server
- Test uses port 24222 to avoid conflicts with any running NATS instance
- JetStream redelivery timing depends on ack_wait — test uses 2s for speed
