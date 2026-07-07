### VM-023: Reflex-Tier Inference Bake-Off — BitNet vs Small Dense Models
- **Assigned:** Rook
- **Priority:** P2
- **Branch:** mission/VM-023
- **Depends on:** None
- **Description:**
  Evaluate whether BitNet b1.58-class models (ternary-quantized, CPU-first) can serve as a viable **reflex tier** in the VALOR distributed intelligence architecture. Reflex tier is defined as sub-100ms, zero-VRAM inference running locally on the node that needs the answer — enabling Pi sensors, LXCs, and edge nodes to handle classification and routing decisions without a NATS round-trip to the GPU fleet.

  This is a data-gathering mission. We are not committing infrastructure to BitNet until we have numbers. The question we're answering is: **does BitNet 2B on CPU beat Qwen 2.5 1.5B Q4 on quality-per-watt for the tasks we actually run, and is the operational cost of a second inference stack justified?**

  **Contenders (inference stacks):**
  1. BitNet b1.58 2B4T (Microsoft) via `bitnet.cpp` — CPU only
  2. Qwen 2.5 1.5B Q4_K_M via `llama-server` — CPU only
  3. Llama 3.2 1B Q4_K_M via `llama-server` — CPU only (control/baseline)
  4. Stretch: Phi-3.5-mini Q4 via `llama-server` — CPU only (quality upper bound at this size)

  **Task set (5 representative reflex-tier workloads):**
  1. **Inbox triage** — classify Telegram/email messages as `urgent | informational | noise`. ~200 examples, Mira's historical traffic is a good corpus.
  2. **Tool-call vs chat** — binary classifier: is this user message a tool invocation intent or conversational? ~150 examples from VALOR comms logs.
  3. **Tier routing** — given a task description, select target tier (`reflex | trivial | routine | reasoning | frontier`). ~100 synthetic + 50 real. This is the recursive case — reflex deciding whether to escalate.
  4. **Entity pre-extraction** — extract named entities (people, projects, systems) from a sentence for Engram pipeline pre-seeding. ~150 examples, compare to Engram's current extractor as ground truth.
  5. **Sensor anomaly classification** — given a structured sensor reading (temp, motion, timestamp), classify as `normal | notable | alert`. ~200 synthetic examples modeled on Zeke's ranch telemetry format.

  **Hardware targets (run each contender on each):**
  - **CITADEL** (Ryzen 9 / 5090) — CPU only, big headroom. Establishes ceiling performance.
  - **minipc** (small form factor, 4080) — CPU only. Representative of "local tier" node doing reflex work while its GPU handles bigger jobs.
  - **LXC200** (Mira's container on pve2) — real deployment target. Limited cores, no GPU. This is the honest test.
  - **Pi 5** (stretch goal, optional) — edge deployment ceiling. If BitNet runs usefully on a Pi 5, the architecture story changes meaningfully.

  **Metrics to capture per (model × task × node):**
  - Quality: accuracy against golden set (labels produced by Gemma3:27B + manual spot check on 10% sample)
  - Latency: TTFT, total completion time, tokens/sec — p50, p95, p99 over 100 runs per task
  - Resource: peak RAM, sustained CPU %, power draw if measurable
  - Cold-start: time from "model not loaded" to first token
  - Concurrency: max parallel requests before p95 latency degrades 2x

  **Operational dimensions (qualitative):**
  - bitnet.cpp maturity: hot model swap, health checks, stability under 24h soak
  - Integration effort: how much glue to wire into Herd's dispatcher
  - Fallback behavior: confidence scoring, escalation path when reflex tier says "I don't know"

- **Acceptance:**
  1. `docs/research/reflex-tier-bakeoff.md` with full methodology, raw results, and analysis
  2. CSV or SQLite dataset of per-run metrics — reproducible, not just summary stats
  3. Test harness committed to `tests/research/reflex-bakeoff/` — we should be able to re-run this in 6 months when the landscape shifts
  4. Explicit recommendation with confidence level: **adopt / conditional adopt / don't adopt**, with the conditions spelled out if conditional
  5. If recommendation is adopt or conditional adopt: a follow-on mission brief for integration into Herd's dispatcher and mira-core's reflex helper

- **Status:** Queued
- **Updated:** 2026-04-19

- **Notes:**
  - Run the harness as automation, not manual prompts. We want this reproducible.
  - Don't skip the LXC200 numbers — it's the deployment target that matters. CITADEL data is for framing, not decision-making.
  - If bitnet.cpp falls over on any target node, that's a finding, not a failure — document it and move on.
  - Flag any BitNet quality cliff where it does great on 4 task types and fails one — that shapes where we'd actually deploy it vs where we wouldn't.
  - Director (Tom) makes the adopt/don't-adopt call based on your recommendation. Your job is clean data and honest analysis.
