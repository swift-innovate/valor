import { getDb } from "../database.js";
import { getAgent, listAgents } from "./agent-repo.js";
import { getArtifact } from "./artifact-repo.js";
import { publish } from "../../bus/event-bus.js";
import { type EventEnvelope } from "../../types/index.js";
import type { CommsMessage, CommsConversation } from "../../types/comms.js";
import { nanoid } from "nanoid";

export type CommsFilters = {
  category?: string;
  priority?: string;
  since?: string;
  limit?: number;
};

function buildCommsFilters(
  baseConditions: string[],
  baseParams: Record<string, unknown>,
  filters?: CommsFilters,
): { conditions: string[]; params: Record<string, unknown> } {
  const conditions = [...baseConditions];
  const params = { ...baseParams };

  if (filters?.category) {
    conditions.push("json_extract(payload, '$.category') = @category");
    params.category = filters.category;
  }
  if (filters?.priority) {
    conditions.push("json_extract(payload, '$.priority') = @priority");
    params.priority = filters.priority;
  }
  if (filters?.since) {
    conditions.push("timestamp >= @since");
    params.since = filters.since;
  }

  return { conditions, params };
}

function rowToEvent(row: Record<string, unknown>): EventEnvelope {
  return {
    id: row.id as string,
    type: row.type as string,
    timestamp: row.timestamp as string,
    source: JSON.parse(row.source as string),
    target: row.target ? JSON.parse(row.target as string) : null,
    conversation_id: row.conversation_id as string | null,
    in_reply_to: row.in_reply_to as string | null,
    payload: JSON.parse(row.payload as string),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  };
}

export function sendMessage(input: CommsMessage): EventEnvelope {
  // Validate from_agent (director is a special case)
  if (input.from_agent_id !== "director") {
    const fromAgent = getAgent(input.from_agent_id);
    if (!fromAgent) throw new Error(`Agent not found: ${input.from_agent_id}`);
    if (fromAgent.health_status === "deregistered") {
      throw new Error(`Agent is deregistered: ${input.from_agent_id}`);
    }
  }

  // Validate to_agent if specified
  if (input.to_agent_id) {
    const toAgent = getAgent(input.to_agent_id);
    if (!toAgent) throw new Error(`Agent not found: ${input.to_agent_id}`);
  }

  // Validate to_division if specified
  if (input.to_division_id) {
    const agents = listAgents({ division_id: input.to_division_id });
    if (agents.length === 0) {
      throw new Error(`Division not found or has no agents: ${input.to_division_id}`);
    }
  }

  // Validate attachments — each ID must reference an existing artifact
  const attachments = input.attachments ?? [];
  for (const artId of attachments) {
    const artifact = getArtifact(artId);
    if (!artifact) throw new Error(`Artifact not found: ${artId}`);
  }

  const source =
    input.from_agent_id === "director"
      ? { id: "director", type: "director" as const }
      : { id: input.from_agent_id, type: "agent" as const };

  const target = input.to_agent_id
    ? { id: input.to_agent_id, type: "agent" as const }
    : input.to_division_id
      ? { id: input.to_division_id, type: "system" as const }
      : null;

  const payload = {
    from_agent_id: input.from_agent_id,
    to_agent_id: input.to_agent_id,
    to_division_id: input.to_division_id,
    subject: input.subject,
    body: input.body,
    priority: input.priority,
    category: input.category,
    attachments,
  };

  // Check if this is the first message in this conversation (before publishing)
  const countRow = getDb().queryOne<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM events WHERE type = 'comms.message' AND conversation_id = @conv_id",
    { conv_id: input.conversation_id },
  );
  const existingCount = countRow?.cnt ?? 0;

  const isNewConversation = existingCount === 0;

  // publish persists + notifies subscribers
  const event = publish({
    type: "comms.message",
    source,
    target,
    conversation_id: input.conversation_id,
    in_reply_to: input.in_reply_to,
    payload,
    metadata: null,
  });

  // Flash messages also get a second bus event (not persisted as separate record)
  if (input.priority === "flash") {
    publish({
      type: "comms.message.flash",
      source,
      target,
      conversation_id: input.conversation_id,
      in_reply_to: input.in_reply_to,
      payload,
      metadata: null,
    });
  }

  // Emit conversation.created for first message in thread
  if (isNewConversation) {
    publish({
      type: "comms.conversation.created",
      source: { id: "system", type: "system" },
      target: null,
      conversation_id: input.conversation_id,
      in_reply_to: null,
      payload: { conversation_id: input.conversation_id },
      metadata: null,
    });
  }

  return event;
}

export function getConversation(
  conversationId: string,
  filters?: CommsFilters,
): EventEnvelope[] {
  const { conditions, params } = buildCommsFilters(
    ["type = 'comms.message'", "conversation_id = @conv_id"],
    { conv_id: conversationId },
    filters,
  );

  let sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY timestamp ASC`;
  if (filters?.limit) {
    sql += " LIMIT @limit";
    params.limit = filters.limit;
  }

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToEvent(r as Record<string, unknown>));
}

export function listConversations(
  agentIdFilter?: string,
): CommsConversation[] {
  const rows = getDb().queryAll(
    "SELECT * FROM events WHERE type = 'comms.message' ORDER BY timestamp ASC",
  ) as Record<string, unknown>[];

  if (rows.length === 0) return [];

  const convMap = new Map<
    string,
    {
      participants: Set<string>;
      messages: Array<{ timestamp: string; subject: string; body: string; priority: string }>;
    }
  >();

  for (const row of rows) {
    const convId = row.conversation_id as string;
    if (!convId) continue;

    const payload = JSON.parse(row.payload as string);

    if (!convMap.has(convId)) {
      convMap.set(convId, { participants: new Set(), messages: [] });
    }

    const conv = convMap.get(convId)!;

    if (payload.from_agent_id) conv.participants.add(payload.from_agent_id);
    if (payload.to_agent_id) conv.participants.add(payload.to_agent_id);
    if (payload.to_division_id) conv.participants.add(`div:${payload.to_division_id}`);

    conv.messages.push({
      timestamp: row.timestamp as string,
      subject: payload.subject as string,
      body: payload.body as string,
      priority: payload.priority as string,
    });
  }

  const result: CommsConversation[] = [];

  for (const [convId, data] of convMap.entries()) {
    const participants = Array.from(data.participants);

    if (agentIdFilter && !participants.includes(agentIdFilter)) continue;

    const latest = data.messages[data.messages.length - 1];
    const hasFlash = data.messages.some((m) => m.priority === "flash");

    result.push({
      conversation_id: convId,
      participants,
      message_count: data.messages.length,
      last_message_at: latest.timestamp,
      has_flash: hasFlash,
      latest_subject: latest.subject ?? null,
      latest_body_preview:
        latest.body ? latest.body.slice(0, 100) + (latest.body.length > 100 ? "…" : "") : null,
    });
  }

  result.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));

  return result;
}

export function getAgentInbox(agentId: string, filters?: CommsFilters): EventEnvelope[] {
  const { conditions, params } = buildCommsFilters(
    [
      "type = 'comms.message'",
      "(json_extract(payload, '$.to_agent_id') = @agent_id OR json_extract(payload, '$.to_division_id') IS NOT NULL)",
    ],
    { agent_id: agentId },
    filters,
  );

  let sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC`;
  if (filters?.limit) {
    sql += " LIMIT @limit";
    params.limit = filters.limit;
  }

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToEvent(r as Record<string, unknown>));
}

export function getAgentSent(agentId: string, filters?: CommsFilters): EventEnvelope[] {
  const { conditions, params } = buildCommsFilters(
    [
      "type = 'comms.message'",
      "json_extract(payload, '$.from_agent_id') = @agent_id",
    ],
    { agent_id: agentId },
    filters,
  );

  let sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC`;
  if (filters?.limit) {
    sql += " LIMIT @limit";
    params.limit = filters.limit;
  }

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToEvent(r as Record<string, unknown>));
}

export function generateConversationId(): string {
  return `conv_${nanoid(21)}`;
}
