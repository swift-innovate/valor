import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type Division, DivisionSchema } from "../../types/index.js";

function generateId(): string {
  return `div_${nanoid(21)}`;
}

function rowToDivision(row: Record<string, unknown>): Division {
  return DivisionSchema.parse({
    ...row,
    autonomy_policy: JSON.parse(row.autonomy_policy as string),
    escalation_policy: JSON.parse(row.escalation_policy as string),
  });
}

export function createDivision(
  input: Omit<Division, "id" | "created_at" | "updated_at">,
): Division {
  const now = new Date().toISOString();
  const id = generateId();

  getDb()
    .prepare(
      `INSERT INTO divisions (id, name, lead_agent_id, autonomy_policy, escalation_policy, namespace, created_at, updated_at)
       VALUES (@id, @name, @lead_agent_id, @autonomy_policy, @escalation_policy, @namespace, @created_at, @updated_at)`,
    )
    .run({
      id,
      name: input.name,
      lead_agent_id: input.lead_agent_id,
      autonomy_policy: JSON.stringify(input.autonomy_policy),
      escalation_policy: JSON.stringify(input.escalation_policy),
      namespace: input.namespace,
      created_at: now,
      updated_at: now,
    });

  return DivisionSchema.parse({ ...input, id, created_at: now, updated_at: now });
}

export function getDivision(id: string): Division | null {
  const row = getDb().prepare("SELECT * FROM divisions WHERE id = @id").get({ id });
  return row ? rowToDivision(row as Record<string, unknown>) : null;
}

export function listDivisions(): Division[] {
  const rows = getDb().prepare("SELECT * FROM divisions ORDER BY name").all();
  return rows.map((r) => rowToDivision(r as Record<string, unknown>));
}

export function updateDivision(
  id: string,
  updates: Partial<Omit<Division, "id" | "created_at" | "updated_at">>,
): Division | null {
  const existing = getDivision(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  getDb()
    .prepare(
      `UPDATE divisions SET name = @name, lead_agent_id = @lead_agent_id,
       autonomy_policy = @autonomy_policy, escalation_policy = @escalation_policy,
       namespace = @namespace, updated_at = @updated_at WHERE id = @id`,
    )
    .run({
      id,
      name: merged.name,
      lead_agent_id: merged.lead_agent_id,
      autonomy_policy: JSON.stringify(merged.autonomy_policy),
      escalation_policy: JSON.stringify(merged.escalation_policy),
      namespace: merged.namespace,
      updated_at: now,
    });

  return DivisionSchema.parse(merged);
}

export function deleteDivision(id: string): boolean {
  const result = getDb().prepare("DELETE FROM divisions WHERE id = @id").run({ id });
  return result.changes > 0;
}
