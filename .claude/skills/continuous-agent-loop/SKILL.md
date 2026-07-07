---
name: continuous-agent-loop
description: Autonomous loop patterns for VALOR operatives running extended unattended tasks. Use when Paladin, Zeke, or Herbie need to run a multi-step pipeline without per-step Director input. Covers sequential pipeline, infinite agentic loop, PR loop, and DAG orchestration patterns. Trigger on: "run autonomously", "keep running until", "loop", "pipeline", "unattended".
origin: ECC-adapted/SIT
---

# Continuous Agent Loop — VALOR

Four loop patterns, ordered by complexity.

---

## Pattern 1: Sequential Pipeline
*Best for: Zeke (ranch tasks), Herbie (trading analysis), Mira (content pipeline)*

Chain `claude -p` calls in bash. Each step has a focused prompt and produces output for the next.

```bash
#!/bin/bash
# Example: Herbie paper trading analysis pipeline
set -euo pipefail

SESSION="herbie-$(date +%Y%m%d-%H%M)"
mkdir -p ~/.claude/sessions/$SESSION

# Step 1: Fetch market data
claude -p "Fetch current BTC/ETH prices and 24h volume from CoinGecko API. Output JSON only." \
  > ~/.claude/sessions/$SESSION/market-data.json

# Step 2: Analyze vs paper positions
claude -p "Given market data: $(cat ~/.claude/sessions/$SESSION/market-data.json)
Analyze against paper positions in positions.json. Output: hold/buy/sell recommendation with reasoning." \
  > ~/.claude/sessions/$SESSION/analysis.md

# Step 3: Update Engram with observation
claude -p "Record this trading session observation to Engram: $(cat ~/.claude/sessions/$SESSION/analysis.md)"

echo "Pipeline complete: $SESSION"
```

**Key rules:**
- Each step isolated — no shared state except files
- Set `-euo pipefail` — fail fast on errors
- Log session ID for Engram recall later

---

## Pattern 2: Infinite Agentic Loop
*Best for: Paladin (autonomous monitoring), Rook (continuous security scan)*

Two-prompt orchestration: decomposer + parallel workers.

```bash
#!/bin/bash
# Decomposer prompt — run once
TASKS=$(claude -p "
You are Paladin. Review the current VALOR system state.
Generate a JSON array of 3-5 independent monitoring tasks to run in parallel.
Each task: { id, prompt, priority }
Output JSON only.")

# Parallel workers
echo $TASKS | jq -c '.[]' | while read task; do
  PROMPT=$(echo $task | jq -r '.prompt')
  ID=$(echo $task | jq -r '.id')
  
  claude -p "$PROMPT" > /tmp/paladin-$ID.md &
done

wait  # All parallel tasks complete

# Synthesize results
claude -p "Synthesize these monitoring results: $(cat /tmp/paladin-*.md)
Report any anomalies to Director via Telegram."
```

**Key rules:**
- Decomposer produces genuinely independent tasks
- Workers have no inter-dependencies
- Synthesis step aggregates, doesn't re-run

---

## Pattern 3: PR Loop (Gage/Forge)
*Best for: Automated feature implementation with CI gates*

```bash
#!/bin/bash
MAX_ITERATIONS=5
ITER=0

while [ $ITER -lt $MAX_ITERATIONS ]; do
  ITER=$((ITER + 1))
  echo "=== Iteration $ITER ==="
  
  # Implement
  claude -p "Implement the next failing test. Run tests after. Report: PASS|FAIL|BLOCKED"
  
  # Check CI
  if npx jest --passWithNoTests 2>/dev/null; then
    echo "All tests passing — loop complete"
    break
  fi
  
  # Cost guard
  if [ $ITER -eq $MAX_ITERATIONS ]; then
    echo "Max iterations reached — escalate to Director"
  fi
done
```

---

## Pattern 4: DAG Orchestration (Crazy-Eddie / complex SIT pipelines)

For tasks with dependencies between steps — use a dependency graph.

```
Task A ──┐
Task B ──┼──► Task D ──► Task F (final)
Task C ──┘
         └──► Task E ──┘
```

Implementation: encode DAG as JSON, resolve execution order topologically, run independent nodes in parallel.

---

## De-Sloppify Pass

After any autonomous loop that writes code, run a cleanup pass:

```bash
claude -p "
Review the code written in this session. Remove:
- Unused imports
- Debug console.log statements  
- TODO comments that were addressed
- Duplicate logic
- Over-engineered abstractions

Do NOT change behavior. Tests must still pass after cleanup."
```

Run this AFTER the main loop, separately. Don't constrain the implementer.

---

## Loop Safety Rules

- Always set a max iteration count
- Always log session IDs for Engram recall
- Cost guard: estimate tokens per iteration × max iterations before starting
- Escalate to Director if blocked after N retries
- Never loop on destructive operations (delete, overwrite) without confirmation gate
