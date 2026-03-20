import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type WALEntry, WALEntrySchema } from "../../types/index.js";

function generateId(): string {
  return `wal_${nanoid(21)}`;
}

export function appendAuditEntry(
  input: Omit<WALEntry, "id" | "timestamp">,
): WALEntry {
  const id = generateId();
  const timestamp = new Date().toISOString();

  getDb().execute(
    `INSERT INTO audit_log (id, entity_type, entity_id, operation, before_state, after_state, actor_id, timestamp)
     VALUES (@id, @entity_type, @entity_id, @operation, @before_state, @after_state, @actor_id, @timestamp)`,
    {
      id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      operation: input.operation,
      before_state: input.before_state,
      after_state: input.after_state,
      actor_id: input.actor_id,
      timestamp,
    },
  );

  return WALEntrySchema.parse({ ...input, id, timestamp });
}

export function queryAuditLog(filters?: {
  entity_type?: string;
  entity_id?: string;
  operation?: string;
  from?: string;
  to?: string;
  limit?: number;
}): WALEntry[] {
  let sql = "SELECT * FROM audit_log";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.entity_type) {
    conditions.push("entity_type = @entity_type");
    params.entity_type = filters.entity_type;
  }
  if (filters?.entity_id) {
    conditions.push("entity_id = @entity_id");
    params.entity_id = filters.entity_id;
  }
  if (filters?.operation) {
    conditions.push("operation = @operation");
    params.operation = filters.operation;
  }
  if (filters?.from) {
    conditions.push("timestamp >= @from");
    params.from = filters.from;
  }
  if (filters?.to) {
    conditions.push("timestamp <= @to");
    params.to = filters.to;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY timestamp ASC";

  if (filters?.limit) {
    sql += " LIMIT @limit";
    params.limit = filters.limit;
  }

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => WALEntrySchema.parse(r));
}
