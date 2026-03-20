import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type EventEnvelope, EventEnvelopeSchema } from "../../types/index.js";

function generateId(): string {
  return `evt_${nanoid(21)}`;
}

function rowToEvent(row: Record<string, unknown>): EventEnvelope {
  return EventEnvelopeSchema.parse({
    ...row,
    source: JSON.parse(row.source as string),
    target: row.target ? JSON.parse(row.target as string) : null,
    payload: JSON.parse(row.payload as string),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  });
}

export function appendEvent(
  input: Omit<EventEnvelope, "id" | "timestamp">,
): EventEnvelope {
  const id = generateId();
  const timestamp = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO events (id, type, timestamp, source, target, conversation_id, in_reply_to, payload, metadata)
       VALUES (@id, @type, @timestamp, @source, @target, @conversation_id, @in_reply_to, @payload, @metadata)`,
    )
    .run({
      id,
      type: input.type,
      timestamp,
      source: JSON.stringify(input.source),
      target: input.target ? JSON.stringify(input.target) : null,
      conversation_id: input.conversation_id,
      in_reply_to: input.in_reply_to,
      payload: JSON.stringify(input.payload),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });

  return EventEnvelopeSchema.parse({ ...input, id, timestamp });
}

export function queryEvents(filters?: {
  type?: string;
  from?: string;
  to?: string;
  conversation_id?: string;
  limit?: number;
}): EventEnvelope[] {
  let sql = "SELECT * FROM events";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.type) {
    // Support glob: "mission.*" becomes SQL LIKE "mission.%"
    conditions.push("type LIKE @type");
    params.type = filters.type.replace(/\*/g, "%");
  }
  if (filters?.from) {
    conditions.push("timestamp >= @from");
    params.from = filters.from;
  }
  if (filters?.to) {
    conditions.push("timestamp <= @to");
    params.to = filters.to;
  }
  if (filters?.conversation_id) {
    conditions.push("conversation_id = @conversation_id");
    params.conversation_id = filters.conversation_id;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY timestamp ASC";

  if (filters?.limit) {
    sql += " LIMIT @limit";
    params.limit = filters.limit;
  }

  const rows = getDb().prepare(sql).all(params);
  return rows.map((r) => rowToEvent(r as Record<string, unknown>));
}

export function getEvent(id: string): EventEnvelope | null {
  const row = getDb().prepare("SELECT * FROM events WHERE id = @id").get({ id });
  return row ? rowToEvent(row as Record<string, unknown>) : null;
}
