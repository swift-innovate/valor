import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type Agent, AgentSchema } from "../../types/index.js";

function generateId(): string {
  return `agt_${nanoid(21)}`;
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return AgentSchema.parse({
    ...row,
    capabilities: JSON.parse(row.capabilities as string),
  });
}

export function createAgent(
  input: Omit<Agent, "id" | "created_at" | "updated_at">,
): Agent {
  const now = new Date().toISOString();
  const id = generateId();

  getDb().execute(
    `INSERT INTO agents (id, callsign, division_id, runtime, endpoint_url, model, health_status, last_heartbeat, persona_id, capabilities, created_at, updated_at)
     VALUES (@id, @callsign, @division_id, @runtime, @endpoint_url, @model, @health_status, @last_heartbeat, @persona_id, @capabilities, @created_at, @updated_at)`,
    {
      id,
      callsign: input.callsign,
      division_id: input.division_id,
      runtime: input.runtime,
      endpoint_url: input.endpoint_url,
      model: input.model,
      health_status: input.health_status,
      last_heartbeat: input.last_heartbeat,
      persona_id: input.persona_id,
      capabilities: JSON.stringify(input.capabilities),
      created_at: now,
      updated_at: now,
    },
  );

  return AgentSchema.parse({ ...input, id, created_at: now, updated_at: now });
}

export function getAgent(id: string): Agent | null {
  const row = getDb().queryOne("SELECT * FROM agents WHERE id = @id", { id });
  return row ? rowToAgent(row as Record<string, unknown>) : null;
}

export function listAgents(filters?: {
  division_id?: string;
  health_status?: string;
}): Agent[] {
  let sql = "SELECT * FROM agents";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.division_id) {
    conditions.push("division_id = @division_id");
    params.division_id = filters.division_id;
  }
  if (filters?.health_status) {
    conditions.push("health_status = @health_status");
    params.health_status = filters.health_status;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY callsign";

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToAgent(r as Record<string, unknown>));
}

export function updateAgent(
  id: string,
  updates: Partial<Omit<Agent, "id" | "created_at" | "updated_at">>,
): Agent | null {
  const existing = getAgent(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  // Validate before writing — prevents corrupt data from reaching the database
  const parsed = AgentSchema.parse(merged);

  getDb().execute(
    `UPDATE agents SET callsign = @callsign, division_id = @division_id, runtime = @runtime,
     endpoint_url = @endpoint_url, model = @model, health_status = @health_status,
     last_heartbeat = @last_heartbeat, persona_id = @persona_id, capabilities = @capabilities,
     updated_at = @updated_at WHERE id = @id`,
    {
      id,
      callsign: parsed.callsign,
      division_id: parsed.division_id,
      runtime: parsed.runtime,
      endpoint_url: parsed.endpoint_url,
      model: parsed.model,
      health_status: parsed.health_status,
      last_heartbeat: parsed.last_heartbeat,
      persona_id: parsed.persona_id,
      capabilities: JSON.stringify(parsed.capabilities),
      updated_at: now,
    },
  );

  return parsed;
}

export function updateHeartbeat(id: string): Agent | null {
  return updateAgent(id, {
    last_heartbeat: new Date().toISOString(),
    health_status: "healthy",
  });
}

export function deleteAgent(id: string): boolean {
  const result = getDb().execute("DELETE FROM agents WHERE id = @id", { id });
  return result.changes > 0;
}
