import { nanoid } from "nanoid";
import { getDb } from "../database.js";

export interface Approval {
  id: string;
  mission_id: string;
  gate: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected" | "expired";
  resolved_by: string | null;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  expires_at: string | null;
}

export function createApproval(input: {
  mission_id: string;
  gate: string;
  requested_by: string;
  expires_at?: string;
}): Approval {
  const id = `apr_${nanoid(21)}`;
  const now = new Date().toISOString();

  getDb().execute(
    `INSERT INTO approvals (id, mission_id, gate, requested_by, status, created_at, expires_at)
     VALUES (@id, @mission_id, @gate, @requested_by, 'pending', @created_at, @expires_at)`,
    {
      id,
      mission_id: input.mission_id,
      gate: input.gate,
      requested_by: input.requested_by,
      created_at: now,
      expires_at: input.expires_at ?? null,
    },
  );

  return {
    id,
    mission_id: input.mission_id,
    gate: input.gate,
    requested_by: input.requested_by,
    status: "pending",
    resolved_by: null,
    reason: null,
    created_at: now,
    resolved_at: null,
    expires_at: input.expires_at ?? null,
  };
}

export function resolveApproval(
  id: string,
  resolution: { status: "approved" | "rejected"; resolved_by: string; reason?: string },
): Approval | null {
  const existing = getApproval(id);
  if (!existing || existing.status !== "pending") return null;

  const now = new Date().toISOString();
  getDb().execute(
    `UPDATE approvals SET status = @status, resolved_by = @resolved_by,
     reason = @reason, resolved_at = @resolved_at WHERE id = @id`,
    {
      id,
      status: resolution.status,
      resolved_by: resolution.resolved_by,
      reason: resolution.reason ?? null,
      resolved_at: now,
    },
  );

  return { ...existing, ...resolution, reason: resolution.reason ?? null, resolved_at: now };
}

export function getApproval(id: string): Approval | null {
  const row = getDb().queryOne("SELECT * FROM approvals WHERE id = @id", { id });
  return (row as Approval) ?? null;
}

export function getPendingApproval(missionId: string): Approval | null {
  const row = getDb().queryOne(
    "SELECT * FROM approvals WHERE mission_id = @mission_id AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    { mission_id: missionId },
  );
  return (row as Approval) ?? null;
}

export function listApprovals(filters?: {
  mission_id?: string;
  status?: string;
}): Approval[] {
  let sql = "SELECT * FROM approvals";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.mission_id) {
    conditions.push("mission_id = @mission_id");
    params.mission_id = filters.mission_id;
  }
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  return getDb().queryAll(sql, params) as Approval[];
}
