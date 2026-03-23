# Mission Lifecycle & Strategy — Eddie's Perspective

**Mission:** VM-712-3  
**Operative:** Crazy-Eddie  
**For:** VM-712 Onboarding Document synthesis

---

## The Mission Lifecycle

### 1. Classification

When a mission arrives the Director LLM reads it and classifies: domain, complexity, priority, and whether safety gates apply. The Director does not execute — it classifies, decomposes, and routes.

### 2. Decomposition

Complex missions break into sub-tasks with dependencies. Each maps to one operative. Dependencies are explicit — agents don't guess order, the brief tells them what must complete first.

### 3. Routing

Each sub-task routes to the operative whose `primary_skills` match. From experience: marketing/email → Eddie, code/infra → Forge/Gage, research/scheduling → Mira, financial analysis → Herbie, memory validation → Tracer. Ambiguous routing escalates to Director.

### 4. Control Gates (Pre-Dispatch)

Before any mission reaches an operative, deterministic code checks run — no LLM:
- **P0** Financial transactions → blocked, Principal escalation
- **P1** Destructive operations, mass comms → blocked  
- **P2** Public publishing → flagged, Director approval
- **OathGate / VectorCheckpointGate** → ethical and high-stakes blocks

Gates exist because no model reliably handles safety edge cases.

### 5. Dispatch & Execution

Mission arrives in operative's VALOR inbox. Operative: acknowledges pickup, sends progress sitreps, publishes completion + ReviewSubmission. Engine supervises the stream — silence triggers Director alert.

### 6. Review (Analyst)

Completed work goes to the Analyst (different model than executor — cross-model review catches what same-model misses). Verdicts: APPROVE, RETRY (with instructions, max 2 retries), or ESCALATE.

### 7. After-Action Review

Director or Principal reviews completed work and Analyst verdict, closes to `aar_complete`. Lessons captured here.

---

## Strategic Guidance for Agents

**Read the brief before asking questions.** Acceptance criteria are the contract. Execute on clear briefs. Ask one clarifying question only if genuinely ambiguous, then proceed.

**Sitrep early, sitrep often.** The Director has no visibility except sitreps. Report at 10%, 50%, 90%, 100%. Blockers get an immediate sitrep.

**Escalate decisions, not work.** Escalation is for judgment calls. The operative executes — the Director decides.

**Branches are your artifact layer.** Push code/docs to a branch. A file path in a sitrep beats pasting content into a message.

**The retry limit is real.** Two retries before auto-escalation. Read acceptance criteria before submitting.

**Context from the brief is everything.** Read `depends_on`, `parent_mission`, `context_refs`. A sub-task that ignores what the parent is trying to achieve produces technically correct but strategically useless output.

---

## Lessons from Operating in VALOR

1. Check inbox before starting work — new context may have arrived
2. Polling reliability matters — fix it the moment it breaks (systemd timer inline, not backgrounded)
3. VALOR is the audit trail — write like it will be reviewed
4. Collaboration through the bus works — VM-001 → VM-001-2 → VM-001-3 chain proved it
5. Don't impersonate the Director — escalate, don't decide unilaterally
