import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { Hono } from "hono";
import { missionRoutes } from "../../src/api/missions.js";
import { getDb } from "../../src/db/database.js";

const app = new Hono();
app.route("/missions", missionRoutes);

describe("POST /missions/from-sigint", () => {
  beforeEach(() => freshDb());
  afterEach(() => cleanupDb());

  it("creates a mission with source_metadata from SIGINT payload", async () => {
    const payload = {
      title: "AI-Powered Invoice Reconciliation",
      objective: "# Mission Brief\n\nBuild an invoice reconciliation tool...",
      priority: "normal",
      constraints: ["MVP in <48h", "Budget: $5 max API cost"],
      deliverables: ["Deployed web app", "README"],
      success_criteria: ["Functional MVP", "First user signup"],
      max_revisions: 3,
      source: {
        type: "sigint",
        intercept_id: "2026-03-15-ai-invoice-reconciler",
        composite_score: 4.2,
        category: "developer-tools",
        scoring: {
          pain_severity: 4,
          market_evidence: 3,
          competition_gap: 4,
          monetization: 5,
          build_complexity: 3,
          defensibility: 2,
        },
      },
    };

    const res = await app.request("/missions/from-sigint", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VALOR-Role": "director" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mission_id).toBeDefined();
    expect(body.mission_id).toMatch(/^mis_/);
    expect(body.status).toBe("draft");
    expect(body.gates_pending).toEqual(["hil"]);

    // Verify source_metadata is stored
    const row = getDb()
      .prepare("SELECT source_metadata FROM missions WHERE id = ?")
      .get(body.mission_id) as { source_metadata: string };
    const metadata = JSON.parse(row.source_metadata);
    expect(metadata.intercept_id).toBe("2026-03-15-ai-invoice-reconciler");
    expect(metadata.composite_score).toBe(4.2);
  });

  it("returns 400 if title is missing", async () => {
    const res = await app.request("/missions/from-sigint", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VALOR-Role": "director" },
      body: JSON.stringify({ objective: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 if source is missing", async () => {
    const res = await app.request("/missions/from-sigint", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VALOR-Role": "director" },
      body: JSON.stringify({
        title: "Test",
        objective: "Test objective",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("stores all mission fields correctly", async () => {
    const payload = {
      title: "Test Mission",
      objective: "Build something",
      priority: "high",
      constraints: ["fast"],
      deliverables: ["app"],
      success_criteria: ["works"],
      max_revisions: 5,
      source: {
        type: "sigint",
        intercept_id: "test-123",
        composite_score: 3.5,
        category: "saas",
        scoring: { pain_severity: 3 },
      },
    };

    const res = await app.request("/missions/from-sigint", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VALOR-Role": "director" },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    const row = getDb()
      .prepare("SELECT * FROM missions WHERE id = ?")
      .get(body.mission_id) as Record<string, unknown>;

    expect(row.title).toBe("Test Mission");
    expect(row.priority).toBe("high");
    expect(row.max_revisions).toBe(5);
    expect(row.status).toBe("draft");
    expect(JSON.parse(row.constraints as string)).toEqual(["fast"]);
  });
});
