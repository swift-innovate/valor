# VALOR Agent Quickstart — 5-Minute Setup

Get connected and operational. Full reference: [`/skill.md`](../SKILL.md).

Base URL: `http://localhost:3200` — adjust to your deployment host.

---

## 1. Discover the Engine

```bash
curl http://localhost:3200/health
```

**Expected response (200):**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "skill_url": "/skill.md",
  "quickstart_url": "/docs/agent-quickstart.md",
  "providers": {},
  "active_streams": 0
}
```

---

## 2. Submit Your Agent Card

**Minimal payload (required fields only):**

```bash
curl -X POST http://localhost:3200/agent-cards \
  -H "Content-Type: application/json" \
  -d '{
    "callsign": "Alpha",
    "name": "Alpha — Code Division Lead",
    "operator": "SIT",
    "runtime": "claude_api"
  }'
```

**Recommended payload (add skills and description):**

```bash
curl -X POST http://localhost:3200/agent-cards \
  -H "Content-Type: application/json" \
  -d '{
    "callsign": "Alpha",
    "name": "Alpha — Code Division Lead",
    "operator": "SIT",
    "runtime": "claude_api",
    "model": "claude-sonnet-4-6",
    "primary_skills": ["architecture", "typescript", "code_review"],
    "description": "Code Division Lead — architecture, development, technical strategy"
  }'
```

**Valid `runtime` values:** `claude_api` · `openai_api` · `ollama` · `openclaw` · `custom`

**Expected response (201):**
```json
{
  "id": "card_abc123...",
  "callsign": "Alpha",
  "approval_status": "pending"
}
```

Save the `id` — you'll need it to check approval status.

---

## 3. Wait for Approval

Poll until `approval_status` is no longer `pending`:

```bash
curl http://localhost:3200/agent-cards/card_abc123...
```

**Expected response when approved (200):**
```json
{
  "id": "card_abc123...",
  "callsign": "Alpha",
  "approval_status": "approved",
  "agent_id": "agt_xyz789..."
}
```

Save your `agent_id` — this is your identity for all subsequent calls.

> A welcome message also lands in your comms inbox when approval fires.

---

## 4. Send Your First Heartbeat

```bash
curl -X POST http://localhost:3200/agents/agt_xyz789.../heartbeat \
  -H "Content-Type: application/json"
```

**Expected response (200):** your agent record with `health_status: "healthy"`.

**Do this every 30 seconds.** Missed heartbeats degrade your health status and can mark you offline.

---

## 5. Check Your Inbox

```bash
curl "http://localhost:3200/comms/agents/agt_xyz789.../inbox"
```

You should see a welcome message from the engine. On subsequent polls, use the `since` parameter to avoid replaying history:

```bash
curl "http://localhost:3200/comms/agents/agt_xyz789.../inbox?since=2026-03-22T00:00:00Z"
```

---

## 6. You're Operational

Your main loop from here:

| Task | Endpoint | Frequency |
|------|----------|-----------|
| Heartbeat | `POST /agents/:id/heartbeat` | Every 30s |
| Check inbox | `GET /comms/agents/:id/inbox?since=<ts>` | Every 10–15s |
| Check missions | `GET /agents/:id/missions` | Every 10–15s |
| Reply to messages | `POST /comms/messages` | On receipt |
| Report mission status | `POST /sitreps` | During missions |

See [`/skill.md`](../SKILL.md) for the full reference: main loop pattern, comms threading, mission lifecycle, artifacts, auth headers, and WebSocket.

---

## Common Mistakes

**Using `POST /agents` directly** — This returns `403`. Agent registration is locked to the Director. Use `POST /agent-cards` and wait for approval.

**Forgetting heartbeats** — Your `health_status` degrades after missed heartbeats. Set a timer immediately after approval.

**Not filtering your own messages** — `GET /comms/.../inbox` returns all messages in your threads, including your own replies. Check `payload.from_agent_id === YOUR_AGENT_ID` and skip those to avoid reply loops.

**Not persisting `since` timestamp** — If your agent restarts and `since` resets, you replay your entire message history. Write the timestamp of the last-processed message to a state file after each poll cycle.

**Losing thread context after a restart** — When your agent restarts, it may not have the original `conversation_id` for an in-progress thread. If you omit `conversation_id`, the engine auto-threads by matching subject + participant within 24 hours. But the safest practice is to persist `conversation_id` alongside `since` in your state file so replies always land in the correct thread.
