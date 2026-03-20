import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { ArtifactSchema, ArtifactType } from "../../types/index.js";
import type { Artifact } from "../../types/index.js";
import { publish } from "../../bus/event-bus.js";

function generateId(): string {
  return `art_${nanoid(21)}`;
}

function rowToArtifact(row: Record<string, unknown>): Artifact {
  return ArtifactSchema.parse(row);
}

export function createArtifact(input: {
  title: string;
  content_type: string;
  language?: string | null;
  content: string;
  summary?: string | null;
  created_by: string;
  conversation_id?: string | null;
}): Artifact {
  // Validate content_type before inserting
  const typeResult = ArtifactType.safeParse(input.content_type);
  if (!typeResult.success) {
    throw new Error(`Invalid content_type. Must be one of: ${ArtifactType.options.join(", ")}`);
  }

  const now = new Date().toISOString();
  const id = generateId();

  getDb()
    .prepare(
      `INSERT INTO artifacts (id, title, content_type, language, content, summary, created_by, conversation_id, version, created_at, updated_at)
       VALUES (@id, @title, @content_type, @language, @content, @summary, @created_by, @conversation_id, 1, @created_at, @updated_at)`,
    )
    .run({
      id,
      title: input.title,
      content_type: input.content_type,
      language: input.language ?? null,
      content: input.content,
      summary: input.summary ?? null,
      created_by: input.created_by,
      conversation_id: input.conversation_id ?? null,
      created_at: now,
      updated_at: now,
    });

  const artifact = rowToArtifact(
    getDb().prepare("SELECT * FROM artifacts WHERE id = @id").get({ id }) as Record<string, unknown>,
  );

  publish({
    type: "artifact.created",
    source: { id: input.created_by, type: input.created_by === "director" ? "director" : "agent" },
    target: null,
    conversation_id: input.conversation_id ?? null,
    in_reply_to: null,
    payload: {
      artifact_id: artifact.id,
      title: artifact.title,
      content_type: artifact.content_type,
      created_by: artifact.created_by,
    },
    metadata: null,
  });

  return artifact;
}

export function getArtifact(id: string): Artifact | null {
  const row = getDb().prepare("SELECT * FROM artifacts WHERE id = @id").get({ id });
  return row ? rowToArtifact(row as Record<string, unknown>) : null;
}

export function updateArtifact(
  id: string,
  updates: Partial<Pick<Artifact, "title" | "content" | "summary" | "language">>,
): Artifact | null {
  const existing = getArtifact(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const newVersion = existing.version + 1;

  getDb()
    .prepare(
      `UPDATE artifacts SET title = @title, content = @content, summary = @summary,
       language = @language, version = @version, updated_at = @updated_at WHERE id = @id`,
    )
    .run({
      id,
      title: updates.title ?? existing.title,
      content: updates.content ?? existing.content,
      summary: updates.summary !== undefined ? updates.summary : existing.summary,
      language: updates.language !== undefined ? updates.language : existing.language,
      version: newVersion,
      updated_at: now,
    });

  const artifact = getArtifact(id)!;

  publish({
    type: "artifact.updated",
    source: { id: "system", type: "system" },
    target: null,
    conversation_id: artifact.conversation_id,
    in_reply_to: null,
    payload: { artifact_id: artifact.id, version: artifact.version },
    metadata: null,
  });

  return artifact;
}

export function listArtifacts(filters?: {
  created_by?: string;
  conversation_id?: string;
  content_type?: string;
}): Artifact[] {
  let sql = "SELECT * FROM artifacts";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.created_by) {
    conditions.push("created_by = @created_by");
    params.created_by = filters.created_by;
  }
  if (filters?.conversation_id) {
    conditions.push("conversation_id = @conversation_id");
    params.conversation_id = filters.conversation_id;
  }
  if (filters?.content_type) {
    conditions.push("content_type = @content_type");
    params.content_type = filters.content_type;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = getDb().prepare(sql).all(params);
  return rows.map((r) => rowToArtifact(r as Record<string, unknown>));
}

export function listArtifactsByConversation(conversationId: string): Artifact[] {
  const rows = getDb()
    .prepare("SELECT * FROM artifacts WHERE conversation_id = @conversation_id ORDER BY created_at ASC")
    .all({ conversation_id: conversationId });
  return rows.map((r) => rowToArtifact(r as Record<string, unknown>));
}

export function deleteArtifact(id: string): boolean {
  const existing = getArtifact(id);
  if (!existing) return false;

  getDb().prepare("DELETE FROM artifacts WHERE id = @id").run({ id });

  publish({
    type: "artifact.deleted",
    source: { id: "system", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { artifact_id: id },
    metadata: null,
  });

  return true;
}
