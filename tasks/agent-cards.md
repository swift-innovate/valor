# Task: Agent Card & Registration Approval System

> Priority: HIGH — This unblocks all agent interaction with VALOR.

## Context

Read `CLAUDE.md` first — respect the Scope Boundary section.

VALOR currently has agent CRUD (`POST /agents`, heartbeat, etc.) but no approval workflow. Any `POST /agents` instantly creates a registered agent. We need a gated registration flow where agents present a **card** (their identity + capabilities) and an admin approves or rejects them before they can participate.

## What to Build

### 1. Agent Card Schema

Add a new Zod schema and DB table for agent cards. An agent card is the identity document an agent presents to VALOR. Think of it as a business card + resume.

```typescript
// src/types/agent-card.ts

export const AgentCardSchema = z.object({
  id: z.string(),
  
  // Identity
  callsign: z.string().min(1),           // "Gage", "Mira", "Zeke"
  name: z.string().min(1),               // Full display name
  operator: z.string().min(1),           // Who operates this agent — "SIT", "tom@example.com", org name
  version: z.string().default("1.0.0"),  // Card version for updates
  
  // Capabilities
  primary_skills: z.array(z.string()),   // ["code_review", "architecture", "typescript", "devops"]
  runtime: AgentRuntime,                 // "claude_api", "ollama", "openclaw", "custom"
  model: z.string().nullable(),          // "claude-sonnet-4-20250514", "llama3.1:8b", etc.
  endpoint_url: z.string().nullable(),   // Where to reach this agent (webhook URL, etc.)
  
  // Description
  description: z.string(),               // One-liner: "Code Division Lead — architecture, dev, technical strategy"
  
  // Governance
  approval_status: z.enum(["pending", "approved", "rejected", "revoked"]),
  approved_by: z.string().nullable(),    // Who approved — "director", admin ID
  approved_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  
  // Metadata
  submitted_at: z.string(),
  updated_at: z.string(),
});
```

### 2. DB Migration (`006-agent-cards.sql`)

```sql
CREATE TABLE IF NOT EXISTS agent_cards (
  id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  name TEXT NOT NULL,
  operator TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  primary_skills TEXT NOT NULL DEFAULT '[]',
  runtime TEXT NOT NULL,
  model TEXT,
  endpoint_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_cards_status ON agent_cards(approval_status);
CREATE INDEX IF NOT EXISTS idx_agent_cards_callsign ON agent_cards(callsign);
```

### 3. Agent Card Repository (`src/db/repositories/agent-card-repo.ts`)

Standard CRUD plus:
- `submitCard(input)` — creates with `approval_status: "pending"`
- `approveCard(id, approvedBy)` — sets approved, creates the actual agent record in `agents` table
- `rejectCard(id, reason)` — sets rejected with reason
- `revokeCard(id)` — sets revoked, deregisters the linked agent
- `listCards(filters?)` — filter by status, callsign, operator
- `getCardByCallsign(callsign)` — lookup by callsign

**Critical:** When a card is approved, `approveCard` should automatically:
1. Create the agent in the `agents` table using the card's info
2. Link the agent back to the card (add `agent_card_id` column to agents table, or store `agent_id` on the card)
3. Publish a `agent.card.approved` event on the bus

When a card is revoked, `revokeCard` should:
1. Set the linked agent's `health_status` to `deregistered`
2. Publish `agent.card.revoked` event

### 4. API Routes (`src/api/agent-cards.ts`)

**Agent-facing (submit and check status):**
- `POST /agent-cards` — Submit a new card (returns pending status)
- `GET /agent-cards/:id` — Check card status
- `PUT /agent-cards/:id` — Update a pending card (can't update after approval)

**Admin-facing (review and manage):**
- `GET /agent-cards` — List all cards (filterable by `?status=pending`)
- `POST /agent-cards/:id/approve` — Approve a card (body: `{ approved_by }`)
- `POST /agent-cards/:id/reject` — Reject a card (body: `{ reason }`)
- `POST /agent-cards/:id/revoke` — Revoke a previously approved card

Wire into `src/api/index.ts` and `src/index.ts`.

### 5. Event Bus Integration

Publish these events on card state changes:
- `agent.card.submitted` — when a new card is submitted
- `agent.card.approved` — when admin approves (payload includes the new agent_id)
- `agent.card.rejected` — when admin rejects (payload includes reason)
- `agent.card.revoked` — when admin revokes access

### 6. Dashboard Page

Add an Agent Cards section to the dashboard (similar pattern to the existing approval queue page):
- Show pending cards with approve/reject buttons
- Show all cards with status badges (pending/approved/rejected/revoked)
- Display card details: callsign, name, operator, skills, runtime, description

### 7. Modify Existing Agent Registration

The current `POST /agents` endpoint should be restricted:
- Agents can no longer self-register directly via `POST /agents`
- The only way to create an agent is through the card approval flow
- Keep `POST /agents` for internal/system use but document that agent-facing registration goes through `/agent-cards`

Alternatively, redirect `POST /agents` to create a pending card instead of a direct agent record. Your call on which is cleaner — but the approval gate must exist.

### 8. Tests

Add tests for:
- Card submission (creates with pending status)
- Card approval (creates agent, publishes event)
- Card rejection (stores reason, publishes event)
- Card revocation (deregisters agent, publishes event)
- Can't update an approved card
- Can't approve an already-rejected card
- List filtering by status
- Duplicate callsign handling

## Flow Summary

```
Agent presents card (POST /agent-cards)
  → Card stored as "pending"
  → Event: agent.card.submitted
  → Shows in dashboard approval queue

Admin reviews card
  → Approve: agent record created, card status = approved
    → Event: agent.card.approved
    → Agent can now heartbeat, receive missions, submit sitreps
  → Reject: card status = rejected with reason
    → Event: agent.card.rejected
    → Agent informed on next status check

Later, if needed:
  → Admin revokes: agent deregistered, card status = revoked
    → Event: agent.card.revoked
```

## Do NOT

- Reference or import Engram, Herd Pro, or Operative
- Change the provider layer
- Modify existing mission or gate logic
- Add any external dependencies beyond what's already in package.json
