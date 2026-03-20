import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { getDb } from "../../src/db/database.js";
import { createMission } from "../../src/db/index.js";

describe("Migration 005: source_metadata", () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it("missions table has source_metadata column after migration", () => {
    const cols = getDb()
      .prepare("PRAGMA table_info(missions)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("source_metadata");
  });

  it("can create a mission with source_metadata and read it back", () => {
    const metadata = JSON.stringify({
      type: "sigint",
      intercept_id: "2026-03-15-test-idea",
      composite_score: 4.2,
      category: "developer-tools",
    });

    const db = getDb();
    const id = "mis_test_001";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO missions (id, title, objective, status, priority, constraints, deliverables,
       success_criteria, cost_usd, revision_count, max_revisions, created_at, updated_at, source_metadata)
       VALUES (@id, @title, @objective, 'draft', 'normal', '[]', '[]', '[]', 0, 0, 3, @now, @now, @metadata)`
    ).run({ id, title: "Test", objective: "Test objective", now, metadata });

    const row = db.prepare("SELECT source_metadata FROM missions WHERE id = ?").get(id) as { source_metadata: string };
    expect(JSON.parse(row.source_metadata)).toEqual({
      type: "sigint",
      intercept_id: "2026-03-15-test-idea",
      composite_score: 4.2,
      category: "developer-tools",
    });
  });

  it("source_metadata defaults to null for existing missions", () => {
    const mission = createMission({
      division_id: null,
      title: "No metadata",
      objective: "Test",
      status: "draft",
      phase: null,
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      dispatched_at: null,
      completed_at: null,
    });

    const row = getDb()
      .prepare("SELECT source_metadata FROM missions WHERE id = ?")
      .get(mission.id) as { source_metadata: string | null };
    expect(row.source_metadata).toBeNull();
  });
});
