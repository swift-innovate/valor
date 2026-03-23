import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { publish } from "../../bus/event-bus.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InitiativeStatus = "active" | "paused" | "complete" | "cancelled";
export type InitiativePriority = "critical" | "high" | "normal" | "low";

export interface Initiative {
  id: string;
  title: string;
  objective: string;
  status: InitiativeStatus;
  owner: string | null;
  priority: InitiativePriority;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface InitiativeProgress {
  total_missions: number;
  completed: number;
  failed: number;
  active: number;
  progress_pct: number;
}

export interface CreateInitiativeInput {
  title: string;
  objective: string;
  status?: InitiativeStatus;
  owner?: string | null;
  priority?: InitiativePriority;
  target_date?: string | null;
}

export interface UpdateInitiativeInput {
  title?: string;
  objective?: string;
  status?: InitiativeStatus;
  owner?: string | null;
  priority?: InitiativePriority;
  target_date?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `in_${nanoid(21)}`;
}

function rowToInitiative(row: Record<string, unknown>): Initiative {
  return {
    id: row.id as string,
    title: row.title as string,
    objective: row.objective as string,
    status: row.status as InitiativeStatus,
    owner: (row.owner as string | null) ?? null,
    priority: row.priority as InitiativePriority,
    target_date: (row.target_date as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createInitiative(input: CreateInitiativeInput): Initiative {
  const id = generateId();
  const now = new Date().toISOString();

  const initiative: Initiative = {
    id,
    title: input.title,
    objective: input.objective,
    status: input.status ?? "active",
    owner: input.owner ?? null,
    priority: input.priority ?? "normal",
    target_date: input.target_date ?? null,
    created_at: now,
    updated_at: now,
  };

  getDb().execute(
    `INSERT INTO initiatives (id, title, objective, status, owner, priority, target_date, created_at, updated_at)
     VALUES (@id, @title, @objective, @status, @owner, @priority, @target_date, @created_at, @updated_at)`,
    {
      id: initiative.id,
      title: initiative.title,
      objective: initiative.objective,
      status: initiative.status,
      owner: initiative.owner,
      priority: initiative.priority,
      target_date: initiative.target_date,
      created_at: initiative.created_at,
      updated_at: initiative.updated_at,
    },
  );

  publish({
    type: "initiative.created",
    source: { id: "system", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { initiative_id: id, title: initiative.title },
    metadata: null,
  });

  return initiative;
}

export function getInitiative(id: string): Initiative | null {
  const row = getDb().queryOne("SELECT * FROM initiatives WHERE id = @id", { id });
  return row ? rowToInitiative(row as Record<string, unknown>) : null;
}

export function listInitiatives(filters?: {
  status?: InitiativeStatus;
  owner?: string;
  priority?: InitiativePriority;
}): Initiative[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.owner) {
    conditions.push("owner = @owner");
    params.owner = filters.owner;
  }
  if (filters?.priority) {
    conditions.push("priority = @priority");
    params.priority = filters.priority;
  }

  let sql = "SELECT * FROM initiatives";
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToInitiative(r as Record<string, unknown>));
}

export function updateInitiative(id: string, updates: UpdateInitiativeInput): Initiative | null {
  const existing = getInitiative(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated: Initiative = {
    ...existing,
    ...Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    ) as Partial<Initiative>,
    updated_at: now,
  };

  getDb().execute(
    `UPDATE initiatives SET
       title = @title,
       objective = @objective,
       status = @status,
       owner = @owner,
       priority = @priority,
       target_date = @target_date,
       updated_at = @updated_at
     WHERE id = @id`,
    {
      id,
      title: updated.title,
      objective: updated.objective,
      status: updated.status,
      owner: updated.owner,
      priority: updated.priority,
      target_date: updated.target_date,
      updated_at: updated.updated_at,
    },
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function getInitiativeProgress(id: string): InitiativeProgress {
  const rows = getDb().queryAll(
    "SELECT status FROM missions WHERE initiative_id = @id",
    { id },
  ) as Array<{ status: string }>;

  const total = rows.length;
  const completed = rows.filter((r) => r.status === "aar_complete" || r.status === "complete").length;
  const failed = rows.filter((r) => r.status === "failed" || r.status === "aborted").length;
  const active = rows.filter((r) =>
    ["queued", "gated", "dispatched", "streaming", "aar_pending"].includes(r.status),
  ).length;

  return {
    total_missions: total,
    completed,
    failed,
    active,
    progress_pct: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Mission assignment
// ---------------------------------------------------------------------------

export function assignMissionToInitiative(missionId: string, initiativeId: string): boolean {
  // Verify initiative exists
  const initiative = getInitiative(initiativeId);
  if (!initiative) return false;

  const result = getDb().execute(
    "UPDATE missions SET initiative_id = @initiative_id, updated_at = @now WHERE id = @id",
    {
      initiative_id: initiativeId,
      now: new Date().toISOString(),
      id: missionId,
    },
  );

  return (result as unknown as { changes?: number })?.changes !== 0;
}
