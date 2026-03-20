# Task: Inter-Agent Communication & Comms Log

> Priority: HIGH — Follows agent-cards task. Agents need to talk to each other.
> Dependency: Agent Cards system must be built first (agents need to exist).

## Context

Read `CLAUDE.md` first — respect the Scope Boundary section.

VALOR's event bus already persists all events to SQLite and broadcasts them over WebSocket to the dashboard. Inter-agent communication should ride on this existing infrastructure — not build a parallel messaging system.

## Design Principles

1. **Messages are events.** Agent-to-agent messages are `EventEnvelope` entries with specific types. They flow through the existing bus, get persisted, and broadcast to the dashboard automatically.
2. **Conversations are threads.** Messages are grouped by `conversation_id`. A conversation is a thread between two or more agents (or between an agent and the Director).
3. **Everything is logged.** There is no off-the-record communication. The audit trail is non-negotiable.
4. **Agents don't talk directly.** All messages route through the engine. No peer-to-peer. This is how the engine maintains visibility and control.

## What to Build

### 1. Message Schema

Add a message type that lives on top of EventEnvelope. This is NOT a new table — messages are events with `type: "comms.*"` and structured payloads.

```typescript
// src/types/comms.ts

export const CommsMessageSchema = z.object({
  // Routing
  from_agent_id: z.string(),
  to_agent_id: z.string().nullable(),    // null = broadcast to division or all
  to_division_id: z.string().nullable(), // if set, message goes to all agents in division
  
  // Content
  subject: z.string(),                   // Short subject line
  body: z.string(),                      // Message content (markdown OK)
  priority: z.enum(["routine", "priority", "flash"]),  // flash = urgent
  
  // Threading
  conversation_id: z.string(),           // Groups messages into threads
  in_reply_to: z.string().nullable(),    // Event ID of message being replied to
  
  // Classification
  category: z.enum([
    "task_handoff",      // "Here's a task for you"
    "status_update",     // "Here's where I am on X"
    "request",           // "I need X from you"
    "response",          // "Here's what you asked for"
    "escalation",        // "This needs Director attention"
    "advisory",          // "FYI, heads up"
    "coordination",      // "Let's sync on X"
  ]),
});
export type CommsMessage = z.infer<typeof CommsMessageSchema>;
```

These messages are published as events with type `comms.message` and the `CommsMessage` as the payload. The `EventEnvelope` already has `source`, `target`, `conversation_id`, and `in_reply_to` — use those for routing. The payload carries the message-specific fields.

### 2. Comms API Routes (`src/api/comms.ts`)

**Send messages:**
- `POST /comms/messages` — Send a message from one agent to another
  - Body: `CommsMessage` fields
  - Validates both agents exist and are approved
  - Publishes `comms.message` event on the bus
  - Returns the created event

**Read threads:**
- `GET /comms/conversations` — List all conversations (unique conversation_ids with latest message, participant agents, message count)
- `GET /comms/conversations/:conversationId` — Get all messages in a thread, ordered chronologically
- `GET /comms/conversations/:conversationId/latest` — Get the most recent message in a thread

**Agent inbox:**
- `GET /comms/agents/:agentId/inbox` — All messages targeted at this agent (across all conversations), newest first
- `GET /comms/agents/:agentId/sent` — All messages sent by this agent

**Filters supported on all list endpoints:**
- `?category=task_handoff` — filter by category
- `?priority=flash` — filter by priority
- `?since=2026-03-19T00:00:00Z` — messages after timestamp
- `?limit=50` — pagination

### 3. Comms Repository (`src/db/repositories/comms-repo.ts`)

This repo queries the existing `events` table — it does NOT create a new table. Comms messages are events with `type = 'comms.message'`.

Key functions:
- `sendMessage(input: CommsMessage)` — validates, publishes event, returns event
- `getConversation(conversationId)` — queries events where `conversation_id` matches and `type = 'comms.message'`, ordered by timestamp
- `listConversations(filters?)` — aggregates unique conversation_ids with latest message, participant count, message count
- `getAgentInbox(agentId, filters?)` — events where target agent matches
- `getAgentSent(agentId, filters?)` — events where source agent matches

### 4. Event Types

Register these comms event types (they flow through the existing bus):

- `comms.message` — A message between agents (payload is `CommsMessage`)
- `comms.message.flash` — A flash-priority message (separate type so subscribers can filter urgently)
- `comms.conversation.created` — First message in a new conversation_id

### 5. Dashboard: Comms Log Page

Add a new dashboard page: `/dashboard/comms`

Add to `NAV_ITEMS` in `layout.ts`:
```typescript
{ href: "/dashboard/comms", label: "Comms", icon: "message-square" },
```

**Page layout:**

Two-panel design:
- **Left panel:** Conversation list — each row shows conversation_id (or auto-generated short name), participants (agent callsigns), last message preview, timestamp, message count, priority badge if any flash messages
- **Right panel:** Selected conversation thread — chronological messages with:
  - Sender callsign + avatar color
  - Timestamp
  - Category badge (task_handoff, request, etc.)
  - Priority indicator (flash gets a red accent)
  - Message body (rendered as text, not markdown for now)
  - Reply-to indicator if threaded

**Real-time updates:** The WebSocket bridge already broadcasts all events. The comms page should listen for `comms.message` events and append new messages to the active conversation without a page refresh. Use the same pattern as other dashboard pages — inline `<script>` that connects to `/ws` and updates the DOM.

**Agent filter:** Dropdown at top to filter conversations by agent (show only conversations where agent X is a participant).

### 6. Director Participation

The Director is not an agent but should be able to participate in comms:
- `POST /comms/messages` should accept `from_agent_id: "director"` as a special case
- Director messages appear in threads with a distinct visual treatment (gold accent, "DIRECTOR" badge)
- The EventActor type already supports `type: "director"` — use it

### 7. Tests

Add tests for:
- Send message between two agents (event created, persisted, correct payload)
- Send message to non-existent agent (400 error)
- Flash priority message creates both `comms.message` and `comms.message.flash` events
- Conversation listing aggregates correctly (participants, count, latest)
- Agent inbox returns only messages targeted at that agent
- Agent sent returns only messages from that agent
- Conversation thread returns messages in chronological order
- Director can send messages
- Division broadcast targets all agents in division
- Filter by category, priority, since, limit

## Flow Examples

### Agent-to-Agent Direct Message
```
Gage → VALOR Engine:
  POST /comms/messages
  {
    from_agent_id: "agt_gage123",
    to_agent_id: "agt_mira456", 
    subject: "Architecture review needed",
    body: "I've drafted the provider layer refactor. Can you review the approach before I proceed?",
    priority: "routine",
    conversation_id: "conv_abc123",
    in_reply_to: null,
    category: "request"
  }

Engine:
  → Validates both agents exist and are approved
  → Publishes EventEnvelope { type: "comms.message", source: {id: "agt_gage123", type: "agent"}, target: {id: "agt_mira456", type: "agent"}, ... }
  → Event persisted to SQLite events table
  → WebSocket broadcasts to dashboard
  → Dashboard comms page updates in real-time
```

### Director Flash Message
```
Director → VALOR Engine:
  POST /comms/messages
  {
    from_agent_id: "director",
    to_division_id: "code",
    subject: "Halt all deployments",
    body: "Production incident in progress. Freeze all changes until further notice.",
    priority: "flash",
    conversation_id: "conv_freeze001",
    in_reply_to: null,
    category: "advisory"
  }

Engine:
  → Publishes EventEnvelope { type: "comms.message", ... }
  → Also publishes EventEnvelope { type: "comms.message.flash", ... }
  → All agents in code division see this in their inbox
  → Dashboard shows flash indicator
```

## Wire Into Existing Infrastructure

- Routes go in `src/api/comms.ts`, exported from `src/api/index.ts`
- Mounted in `src/index.ts` as `app.route("/comms", commsRoutes)`
- Dashboard page in `src/dashboard/pages/comms.ts`, exported from pages index
- Dashboard route in `src/dashboard/index.ts`
- Nav item added to `src/dashboard/layout.ts`

## Do NOT

- Create a new database table for messages — use the existing events table
- Reference or import Engram, Herd Pro, or Operative
- Build a separate WebSocket channel — use the existing `/ws` bridge
- Add external dependencies
