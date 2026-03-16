import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { registerSigintOutcomeCallback } from "../../src/callbacks/sigint-outcome.js";
import { publish } from "../../src/bus/index.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";
import { getDb } from "../../src/db/database.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SIGINT outcome callback", () => {
  beforeEach(() => {
    freshDb();
    clearSubscriptions();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
  afterEach(() => cleanupDb());

  it("POSTs to SIGINT when a mission with source_metadata completes", () => {
    registerSigintOutcomeCallback();

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO missions (id, title, objective, status, priority, constraints, deliverables,
       success_criteria, cost_usd, revision_count, max_revisions, created_at, updated_at, source_metadata)
       VALUES (@id, @title, @objective, 'complete', 'normal', '[]', '[]', '[]', 0, 0, 3, @now, @now, @metadata)`
    ).run({
      id: "mis_test_outcome",
      title: "Test",
      objective: "Test",
      now,
      metadata: JSON.stringify({
        type: "sigint",
        intercept_id: "2026-03-15-test-idea",
        composite_score: 4.0,
      }),
    });

    publish({
      type: "mission.aar.approved",
      source: { id: "orchestrator", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: "mis_test_outcome" },
      metadata: null,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8082/api/outcomes");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.intercept_id).toBe("2026-03-15-test-idea");
    expect(body.project_id).toBe("mis_test_outcome");
    expect(body.mvp_built).toBe(true);
  });

  it("does NOT post to SIGINT for missions without source_metadata", () => {
    registerSigintOutcomeCallback();

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO missions (id, title, objective, status, priority, constraints, deliverables,
       success_criteria, cost_usd, revision_count, max_revisions, created_at, updated_at)
       VALUES (@id, @title, @objective, 'complete', 'normal', '[]', '[]', '[]', 0, 0, 3, @now, @now)`
    ).run({ id: "mis_no_sigint", title: "Manual", objective: "Manual mission", now });

    publish({
      type: "mission.aar.approved",
      source: { id: "orchestrator", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: "mis_no_sigint" },
      metadata: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT crash if SIGINT is unreachable", () => {
    registerSigintOutcomeCallback();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO missions (id, title, objective, status, priority, constraints, deliverables,
       success_criteria, cost_usd, revision_count, max_revisions, created_at, updated_at, source_metadata)
       VALUES (@id, @title, @objective, 'complete', 'normal', '[]', '[]', '[]', 0, 0, 3, @now, @now, @metadata)`
    ).run({
      id: "mis_unreachable",
      title: "Test",
      objective: "Test",
      now,
      metadata: JSON.stringify({ type: "sigint", intercept_id: "test-fail" }),
    });

    expect(() => {
      publish({
        type: "mission.aar.approved",
        source: { id: "orchestrator", type: "system" },
        target: null,
        conversation_id: null,
        in_reply_to: null,
        payload: { mission_id: "mis_unreachable" },
        metadata: null,
      });
    }).not.toThrow();
  });
});
