import { Hono } from "hono";
import {
  sendMessage,
  getConversation,
  listConversations,
  getAgentInbox,
  getAgentSent,
  generateConversationId,
} from "../db/repositories/comms-repo.js";
import { CommsPriority, CommsCategory } from "../types/index.js";

export const commsRoutes = new Hono();

// ── Send a message ───────────────────────────────────────────────────

commsRoutes.post("/messages", async (c) => {
  const body = await c.req.json();

  if (!body.from_agent_id) {
    return c.json({ error: "from_agent_id is required" }, 400);
  }
  if (!body.subject) {
    return c.json({ error: "subject is required" }, 400);
  }
  if (!body.body) {
    return c.json({ error: "body is required" }, 400);
  }

  const priorityResult = CommsPriority.safeParse(body.priority ?? "routine");
  if (!priorityResult.success) {
    return c.json({ error: `Invalid priority. Must be one of: ${CommsPriority.options.join(", ")}` }, 400);
  }

  const categoryResult = CommsCategory.safeParse(body.category ?? "advisory");
  if (!categoryResult.success) {
    return c.json({ error: `Invalid category. Must be one of: ${CommsCategory.options.join(", ")}` }, 400);
  }

  if (!body.to_agent_id && !body.to_division_id) {
    return c.json({ error: "Either to_agent_id or to_division_id is required" }, 400);
  }

  // Validate attachments array if provided
  const attachments: string[] = Array.isArray(body.attachments) ? body.attachments : [];

  try {
    const event = sendMessage({
      from_agent_id: body.from_agent_id,
      to_agent_id: body.to_agent_id ?? null,
      to_division_id: body.to_division_id ?? null,
      subject: body.subject,
      body: body.body,
      priority: priorityResult.data,
      conversation_id: body.conversation_id ?? generateConversationId(),
      in_reply_to: body.in_reply_to ?? null,
      category: categoryResult.data,
      attachments,
    });
    return c.json(event, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found") || message.includes("deregistered")) {
      return c.json({ error: message }, 400);
    }
    throw err;
  }
});

// ── Initiate a chat between agents ───────────────────────────────────

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

  // Include participant roster in every message so agents know who else is in the room
  const rosterNote = `\n\n---\nParticipants: ${body.participants.join(", ")}`;
  const fullBody = messageBody + rosterNote;

  try {
    // Send the opening message to each participant individually so it lands
    // in every agent's inbox. All messages share the same conversation_id.
    let openingEventId: string | null = null;

    for (const participantId of body.participants) {
      if (participantId === initiator) continue;

      const event = sendMessage({
        from_agent_id: initiator,
        to_agent_id: participantId,
        to_division_id: null,
        subject: body.subject,
        body: fullBody,
        priority: priorityResult.data,
        conversation_id: conversationId,
        in_reply_to: openingEventId,
        category: "coordination",
      });

      if (!openingEventId) openingEventId = event.id;
    }

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

// ── List conversations ───────────────────────────────────────────────

commsRoutes.get("/conversations", (c) => {
  const agentFilter = c.req.query("agent_id") || undefined;
  const conversations = listConversations(agentFilter);
  return c.json(conversations);
});

// ── Get conversation thread ──────────────────────────────────────────

commsRoutes.get("/conversations/:conversationId", (c) => {
  const filters = {
    category: c.req.query("category") || undefined,
    priority: c.req.query("priority") || undefined,
    since: c.req.query("since") || undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  };
  const messages = getConversation(c.req.param("conversationId"), filters);
  return c.json(messages);
});

// ── Latest message in thread ─────────────────────────────────────────

commsRoutes.get("/conversations/:conversationId/latest", (c) => {
  const messages = getConversation(c.req.param("conversationId"), { limit: 1 });
  // getConversation returns ASC; get last by reversing
  const all = getConversation(c.req.param("conversationId"));
  const latest = all.length > 0 ? all[all.length - 1] : null;
  if (!latest) return c.json({ error: "Conversation not found" }, 404);
  return c.json(latest);
});

// ── Agent inbox ──────────────────────────────────────────────────────

commsRoutes.get("/agents/:agentId/inbox", (c) => {
  const filters = {
    category: c.req.query("category") || undefined,
    priority: c.req.query("priority") || undefined,
    since: c.req.query("since") || undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  };
  const messages = getAgentInbox(c.req.param("agentId"), filters);
  return c.json(messages);
});

// ── Agent sent ───────────────────────────────────────────────────────

commsRoutes.get("/agents/:agentId/sent", (c) => {
  const filters = {
    category: c.req.query("category") || undefined,
    priority: c.req.query("priority") || undefined,
    since: c.req.query("since") || undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  };
  const messages = getAgentSent(c.req.param("agentId"), filters);
  return c.json(messages);
});
