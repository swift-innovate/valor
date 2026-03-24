import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import {
  type Mission,
  type MissionStatus,
  MissionSchema,
  MISSION_TRANSITIONS,
} from "../../types/index.js";

function generateId(): string {
  return `mis_${nanoid(21)}`;
}

function rowToMission(row: Record<string, unknown>): Mission {
  return MissionSchema.parse({
    ...row,
    constraints: JSON.parse(row.constraints as string),
    deliverables: JSON.parse(row.deliverables as string),
    success_criteria: JSON.parse(row.success_criteria as string),
    token_usage: row.token_usage ? JSON.parse(row.token_usage as string) : null,
  });
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: MissionStatus,
    public readonly to: MissionStatus,
  ) {
    super(`Invalid mission transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function createMission(
  input: Omit<Mission, "id" | "created_at" | "updated_at">,
  explicitId?: string,
): Mission {
  const now = new Date().toISOString();
  const id = explicitId ?? generateId();

  getDb().execute(
    `INSERT INTO missions (id, division_id, title, objective, status, phase, assigned_agent_id,
     priority, constraints, deliverables, success_criteria, token_usage, cost_usd,
     revision_count, max_revisions, parent_mission_id, initiative_id, created_at, updated_at,
     dispatched_at, completed_at)
     VALUES (@id, @division_id, @title, @objective, @status, @phase, @assigned_agent_id,
     @priority, @constraints, @deliverables, @success_criteria, @token_usage, @cost_usd,
     @revision_count, @max_revisions, @parent_mission_id, @initiative_id, @created_at, @updated_at,
     @dispatched_at, @completed_at)`,
    {
      id,
      division_id: input.division_id,
      title: input.title,
      objective: input.objective,
      status: input.status,
      phase: input.phase,
      assigned_agent_id: input.assigned_agent_id,
      priority: input.priority,
      constraints: JSON.stringify(input.constraints),
      deliverables: JSON.stringify(input.deliverables),
      success_criteria: JSON.stringify(input.success_criteria),
      token_usage: input.token_usage ? JSON.stringify(input.token_usage) : null,
      cost_usd: input.cost_usd,
      revision_count: input.revision_count,
      max_revisions: input.max_revisions,
      parent_mission_id: input.parent_mission_id,
      initiative_id: input.initiative_id,
      created_at: now,
      updated_at: now,
      dispatched_at: input.dispatched_at,
      completed_at: input.completed_at,
    },
  );

  return MissionSchema.parse({ ...input, id, created_at: now, updated_at: now });
}

export function getMission(id: string): Mission | null {
  const row = getDb().queryOne("SELECT * FROM missions WHERE id = @id", { id });
  return row ? rowToMission(row as Record<string, unknown>) : null;
}

export function listMissions(filters?: {
  division_id?: string;
  status?: MissionStatus;
  assigned_agent_id?: string;
}): Mission[] {
  let sql = "SELECT * FROM missions";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.division_id) {
    conditions.push("division_id = @division_id");
    params.division_id = filters.division_id;
  }
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.assigned_agent_id) {
    conditions.push("assigned_agent_id = @assigned_agent_id");
    params.assigned_agent_id = filters.assigned_agent_id;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToMission(r as Record<string, unknown>));
}

export function transitionMission(id: string, newStatus: MissionStatus): Mission {
  const mission = getMission(id);
  if (!mission) throw new Error(`Mission not found: ${id}`);

  const allowed = MISSION_TRANSITIONS[mission.status];
  if (!allowed.includes(newStatus)) {
    throw new InvalidTransitionError(mission.status, newStatus);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    id,
    status: newStatus,
    updated_at: now,
  };

  if (newStatus === "dispatched") updates.dispatched_at = now;
  if (newStatus === "complete" || newStatus === "aar_complete") updates.completed_at = now;

  let setClauses = "status = @status, updated_at = @updated_at";
  if (updates.dispatched_at) setClauses += ", dispatched_at = @dispatched_at";
  if (updates.completed_at) setClauses += ", completed_at = @completed_at";

  getDb().execute(`UPDATE missions SET ${setClauses} WHERE id = @id`, updates);

  return getMission(id)!;
}

export function updateMission(
  id: string,
  updates: Partial<Omit<Mission, "id" | "status" | "created_at" | "updated_at">>,
): Mission | null {
  const existing = getMission(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  getDb().execute(
    `UPDATE missions SET division_id = @division_id, title = @title, objective = @objective,
     phase = @phase, assigned_agent_id = @assigned_agent_id, priority = @priority,
     constraints = @constraints, deliverables = @deliverables, success_criteria = @success_criteria,
     token_usage = @token_usage, cost_usd = @cost_usd, revision_count = @revision_count,
     max_revisions = @max_revisions, parent_mission_id = @parent_mission_id,
     dispatched_at = @dispatched_at, completed_at = @completed_at,
     updated_at = @updated_at WHERE id = @id`,
    {
      id,
      division_id: merged.division_id,
      title: merged.title,
      objective: merged.objective,
      phase: merged.phase,
      assigned_agent_id: merged.assigned_agent_id,
      priority: merged.priority,
      constraints: JSON.stringify(merged.constraints),
      deliverables: JSON.stringify(merged.deliverables),
      success_criteria: JSON.stringify(merged.success_criteria),
      token_usage: merged.token_usage ? JSON.stringify(merged.token_usage) : null,
      cost_usd: merged.cost_usd,
      revision_count: merged.revision_count,
      max_revisions: merged.max_revisions,
      parent_mission_id: merged.parent_mission_id,
      dispatched_at: merged.dispatched_at,
      completed_at: merged.completed_at,
      updated_at: now,
    },
  );

  return MissionSchema.parse(merged);
}

export function deleteMission(id: string): boolean {
  const result = getDb().execute("DELETE FROM missions WHERE id = @id", { id });
  return result.changes > 0;
}
