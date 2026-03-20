import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type Sitrep, SitrepSchema } from "../../types/index.js";

function generateId(): string {
  return `sit_${nanoid(21)}`;
}

function rowToSitrep(row: Record<string, unknown>): Sitrep {
  return SitrepSchema.parse({
    ...row,
    objectives_complete: JSON.parse(row.objectives_complete as string),
    objectives_pending: JSON.parse(row.objectives_pending as string),
    blockers: JSON.parse(row.blockers as string),
    learnings: JSON.parse(row.learnings as string),
    delivered_to: JSON.parse(row.delivered_to as string),
  });
}

export function createSitrep(
  input: Omit<Sitrep, "id" | "created_at">,
): Sitrep {
  const id = generateId();
  const now = new Date().toISOString();

  getDb().execute(
    `INSERT INTO sitreps (id, mission_id, agent_id, phase, status, summary,
     objectives_complete, objectives_pending, blockers, learnings,
     confidence, tokens_used, delivered_to, created_at)
     VALUES (@id, @mission_id, @agent_id, @phase, @status, @summary,
     @objectives_complete, @objectives_pending, @blockers, @learnings,
     @confidence, @tokens_used, @delivered_to, @created_at)`,
    {
      id,
      mission_id: input.mission_id,
      agent_id: input.agent_id,
      phase: input.phase,
      status: input.status,
      summary: input.summary,
      objectives_complete: JSON.stringify(input.objectives_complete),
      objectives_pending: JSON.stringify(input.objectives_pending),
      blockers: JSON.stringify(input.blockers),
      learnings: JSON.stringify(input.learnings),
      confidence: input.confidence,
      tokens_used: input.tokens_used,
      delivered_to: JSON.stringify(input.delivered_to),
      created_at: now,
    },
  );

  return SitrepSchema.parse({ ...input, id, created_at: now });
}

export function getSitrep(id: string): Sitrep | null {
  const row = getDb().queryOne("SELECT * FROM sitreps WHERE id = @id", { id });
  return row ? rowToSitrep(row as Record<string, unknown>) : null;
}

export function listSitreps(filters?: {
  mission_id?: string;
  agent_id?: string;
}): Sitrep[] {
  let sql = "SELECT * FROM sitreps";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.mission_id) {
    conditions.push("mission_id = @mission_id");
    params.mission_id = filters.mission_id;
  }
  if (filters?.agent_id) {
    conditions.push("agent_id = @agent_id");
    params.agent_id = filters.agent_id;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToSitrep(r as Record<string, unknown>));
}

export function getLatestSitrep(missionId: string): Sitrep | null {
  const row = getDb().queryOne(
    "SELECT * FROM sitreps WHERE mission_id = @mission_id ORDER BY created_at DESC LIMIT 1",
    { mission_id: missionId },
  );
  return row ? rowToSitrep(row as Record<string, unknown>) : null;
}
