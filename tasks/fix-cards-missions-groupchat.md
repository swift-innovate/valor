# Task: Fix Agent Card Spoofing, Lock Down Mission Creation, Fix Group Chat

> Priority: HIGH — Security + usability fixes before live agent testing.

Read `CLAUDE.md` first — respect the Scope Boundary section.

## Problem 1: Fake Agent Cards (Callsign Spoofing)

Anyone can submit an agent card for any callsign. There's no duplicate check. 
Someone could submit a card for "Mira" or "Eddie" and if an admin approves it
without checking, a fake agent gets registered.

### Fix

In `src/db/repositories/agent-card-repo.ts`, `submitCard()` must check for
existing approved or pending cards with the same callsign.

Add this check at the start of `submitCard()`, before the INSERT:

```typescript
// Check for existing active card with this callsign
const existing = getDb()
  .prepare(
    "SELECT id, approval_status FROM agent_cards WHERE callsign = @callsign AND approval_status IN ('pending', 'approved') LIMIT 1"
  )
  .get({ callsign: input.callsign }) as { id: string; approval_status: string } | undefined;

if (existing) {
  if (existing.approval_status === "approved") {
    throw new Error(`Callsign "${input.callsign}" is already registered and approved (card: ${existing.id})`);
  } else {
    throw new Error(`Callsign "${input.callsign}" already has a pending card (card: ${existing.id})`);
  }
}
```

In `src/api/agent-cards.ts`, the POST handler should catch this and return 409:

```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  if (message.includes("already registered") || message.includes("already has a pending")) {
    return c.json({ error: message }, 409);
  }
  throw err;
}
```

Also update `updateCard()` — if the callsign is being changed on a pending card,
validate that the new callsign isn't taken either.

## Problem 2: Agents Should Not Create Missions

The `POST /missions` and `POST /missions/from-sigint` endpoints are wide open.
Any HTTP client can create missions. Right now this is Director-only functionality —
agents should not be able to create or dispatch missions.

### Fix

Don't remove the endpoints (they're needed for the Director and dashboard). Add a
guard that only allows mission creation from the Director or system.

**Option A (simple — recommended for now):** Add a comment and admin-only header check:

In `src/api/missions.ts`, wrap the POST routes with a guard:

```typescript
// Helper: check if request is from an authorized admin/director
function requireDirector(c: Context): Response | null {
  // For now, check for a simple header. This will be replaced with
  // proper auth when the engine gets authentication.
  // Agents cannot create missions — only the Director or system can.
  const role = c.req.header("X-VALOR-Role");
  if (role !== "director" && role !== "system") {
    return c.json({ error: "Only the Director can create missions" }, 403);
  }
  return null;
}
```

Apply to:
- `POST /missions` — mission creation
- `POST /missions/from-sigint` — sigint mission creation
- `POST /missions/:id/dispatch` — mission dispatch
- `POST /missions/:id/approve` — approval (Director only)
- `POST /missions/:id/reject` — rejection (Director only)
- `POST /missions/:id/abort` — abort (Director only)

Leave these open (agents need them):
- `GET /missions` — list missions
- `GET /missions/:id` — get mission details
- `POST /missions/:id/aar` — AAR submission (agent needs this)
- `GET /missions/:id/approvals` — view approvals

Update the integration test script and SKILL.md to pass `X-VALOR-Role: director`
header when creating missions.

## Problem 3: Group Chat Needs to Notify All Participants Properly

The current `POST /comms/chats` sends the opening message to the first "other"
participant and then sends a "you've been added" notice to the rest. This works
for 2-agent chats but is awkward for brainstorming with 3+ agents because:

1. Only the first recipient gets the actual opening message/context
2. Additional participants get a generic "you've been added" stub
3. There's no way for agents to know who else is in the conversation

### Fix

Rewrite the chat initiation to:

1. Send the opening message to ALL participants (not just the first one)
2. Include the full participant list in every message so agents know who else is in the room
3. Add a `participants` field to the chat response event so it's visible in the comms log

In `src/api/comms.ts`, replace the current `POST /chats` handler:

```typescript
commsRoutes.post("/chats", async (c) => {
  const body = await c.req.json();

  if (!body.initiated_by) {
    return c.json({ error: "initiated_by is required (agent ID or 'director')" }, 400);
  }
  if (!body.participants || !Array.isArray(body.participants) || body.participants.length < 2) {
    return c.json({ error: "participants must be an array of at least 2 agent IDs" }, 400);
  }
  if (!body.subject) {
    return c.json({ error: "subject is required" }, 400);
  }

  const priorityResult = CommsPriority.safeParse(body.priority ?? "routine");
  if (!priorityResult.success) {
    return c.json({ error: `Invalid priority. Must be one of: ${CommsPriority.options.join(", ")}` }, 400);
  }

  const conversationId = generateConversationId();
  const initiator = body.initiated_by;
  const messageBody = body.body ?? `Chat initiated: ${body.subject}`;

  // Build a participant roster string for context
  const rosterNote = `\n\n---\nParticipants: ${body.participants.join(", ")}`;
  const fullBody = messageBody + rosterNote;

  try {
    // Send the opening message to each participant individually so it
    // lands in every agent's inbox. All messages share the same
    // conversation_id to form a single thread.
    let openingEventId: string | null = null;

    for (const participantId of body.participants) {
      // Skip sending to yourself if the initiator is also in the list
      if (participantId === initiator) continue;

      const event = sendMessage({
        from_agent_id: initiator,
        to_agent_id: participantId,
        to_division_id: null,
        subject: body.subject,
        body: openingEventId ? fullBody : fullBody,
        priority: priorityResult.data,
        conversation_id: conversationId,
        in_reply_to: openingEventId,
        category: "coordination",
      });

      if (!openingEventId) openingEventId = event.id;
    }

    // If the initiator is "director" and not in the participants list,
    // we still have an opening event from the loop above.
    // If somehow no messages were sent (shouldn't happen), handle gracefully.
    if (!openingEventId) {
      return c.json({ error: "No messages could be sent — check participant IDs" }, 400);
    }

    return c.json({
      conversation_id: conversationId,
      initiated_by: initiator,
      participants: body.participants,
      subject: body.subject,
      opening_event_id: openingEventId,
    }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found") || message.includes("deregistered")) {
      return c.json({ error: message }, 400);
    }
    throw err;
  }
});
```

This way, when the Director says "Eddie, Mira, and Gage — brainstorm on X",
all three agents get the opening message in their inbox with the subject,
body, and participant roster. They all reply to the same `conversation_id`.

## Tests

Add/update tests:
1. Submit duplicate callsign (pending) → 409
2. Submit duplicate callsign (approved) → 409
3. Submit callsign after previous card was rejected → allowed (rejected cards don't block)
4. Submit callsign after previous card was revoked → allowed (revoked cards don't block)
5. Agent tries to POST /missions without X-VALOR-Role header → 403
6. Director creates mission with X-VALOR-Role: director → 201
7. Group chat with 3 participants → all 3 get inbox messages
8. Group chat messages include participant roster in body

## SKILL.md Updates

Add to the Missions section:
> Agents cannot create missions. Only the Director can create and dispatch
> missions. If you need a mission created, send a `category: "escalation"`
> message to the Director or Mira.

Update the Initiate a Chat section to reflect that all participants receive
the opening message.

## Do NOT

- Reference or import Engram, Herd Pro, or Operative
- Add authentication middleware (just the simple header check for now)
- Change the event bus or WebSocket infrastructure
