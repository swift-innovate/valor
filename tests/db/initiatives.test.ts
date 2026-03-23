import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions } from "../../src/bus/event-bus.js";
import {
  createInitiative,
  getInitiative,
  listInitiatives,
  updateInitiative,
  getInitiativeProgress,
  assignMissionToInitiative,
} from "../../src/db/repositories/initiative-repo.js";
import { createMission, transitionMission } from "../../src/db/repositories/mission-repo.js";

// Use beforeAll/afterAll to avoid WSL filesystem disk I/O issues.
beforeAll(() => {
  freshDb();
  clearSubscriptions();
});

afterAll(() => {
  clearSubscriptions();
  cleanupDb();
});

// Minimal mission input for progress tests — initiative_id is not in the
// insert SQL but defaults to NULL via migration; Zod schema fills it in.
const missionBase = {
  division_id: null,
  title: "Test Mission",
  objective: "Do the thing",
  status: "draft" as const,
  phase: null,
  assigned_agent_id: null,
  priority: "normal" as const,
  constraints: [],
  deliverables: [],
  success_criteria: [],
  token_usage: null,
  cost_usd: 0,
  revision_count: 0,
  max_revisions: 5,
  parent_mission_id: null,
  dispatched_at: null,
  completed_at: null,
};

describe("Initiative Repository", () => {
  describe("CRUD", () => {
    it("creates an initiative with defaults", () => {
      const ini = createInitiative({ title: "Op FIREWALL", objective: "Secure the perimeter" });
      expect(ini.id).toMatch(/^in_/);
      expect(ini.title).toBe("Op FIREWALL");
      expect(ini.status).toBe("active");
      expect(ini.priority).toBe("normal");
      expect(ini.owner).toBeNull();
      expect(ini.target_date).toBeNull();
    });

    it("creates an initiative with explicit fields", () => {
      const ini = createInitiative({
        title: "Op HORIZON",
        objective: "Expand reach",
        status: "paused",
        priority: "high",
        owner: "director",
        target_date: "2026-12-31",
      });
      expect(ini.status).toBe("paused");
      expect(ini.priority).toBe("high");
      expect(ini.owner).toBe("director");
      expect(ini.target_date).toBe("2026-12-31");
    });

    it("retrieves an initiative by id", () => {
      const created = createInitiative({ title: "Op STORM", objective: "Weather the crisis" });
      const retrieved = getInitiative(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.title).toBe("Op STORM");
    });

    it("returns null for non-existent id", () => {
      expect(getInitiative("in_nonexistent")).toBeNull();
    });

    it("lists all initiatives", () => {
      const before = listInitiatives().length;
      createInitiative({ title: "Op LIST-A", objective: "Test listing" });
      createInitiative({ title: "Op LIST-B", objective: "Test listing" });
      const after = listInitiatives();
      expect(after.length).toBeGreaterThanOrEqual(before + 2);
    });

    it("filters initiatives by status", () => {
      createInitiative({ title: "Op ACTIVE-FILTER", objective: "Active", status: "active" });
      createInitiative({ title: "Op CANCELLED-FILTER", objective: "Cancelled", status: "cancelled" });
      const active = listInitiatives({ status: "active" });
      const cancelled = listInitiatives({ status: "cancelled" });
      expect(active.every((i) => i.status === "active")).toBe(true);
      expect(cancelled.every((i) => i.status === "cancelled")).toBe(true);
    });

    it("filters initiatives by owner", () => {
      createInitiative({ title: "Op OWNED", objective: "Owned", owner: "gage" });
      createInitiative({ title: "Op UNOWNED", objective: "Unowned", owner: null });
      const gage = listInitiatives({ owner: "gage" });
      expect(gage.every((i) => i.owner === "gage")).toBe(true);
    });

    it("updates an initiative", () => {
      const ini = createInitiative({ title: "Op UPDATE", objective: "Will be updated" });
      const updated = updateInitiative(ini.id, { status: "complete", title: "Op COMPLETE" });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("complete");
      expect(updated!.title).toBe("Op COMPLETE");
    });

    it("returns null when updating non-existent initiative", () => {
      expect(updateInitiative("in_nonexistent", { status: "paused" })).toBeNull();
    });
  });

  describe("Progress Calculation", () => {
    it("returns zero progress for initiative with no missions", () => {
      const ini = createInitiative({ title: "Op EMPTY", objective: "No missions" });
      const progress = getInitiativeProgress(ini.id);
      expect(progress.total_missions).toBe(0);
      expect(progress.completed).toBe(0);
      expect(progress.active).toBe(0);
      expect(progress.failed).toBe(0);
      expect(progress.progress_pct).toBe(0);
    });

    it("calculates progress with assigned missions", () => {
      const ini = createInitiative({ title: "Op PROGRESS", objective: "Track completion" });

      // Create 4 missions and assign them
      const m1 = createMission({ ...missionBase, title: "M1" });
      const m2 = createMission({ ...missionBase, title: "M2" });
      const m3 = createMission({ ...missionBase, title: "M3" });
      const m4 = createMission({ ...missionBase, title: "M4" });

      assignMissionToInitiative(m1.id, ini.id);
      assignMissionToInitiative(m2.id, ini.id);
      assignMissionToInitiative(m3.id, ini.id);
      assignMissionToInitiative(m4.id, ini.id);

      // Transition m1 and m2 to complete (via aar_complete)
      transitionMission(m1.id, "queued");
      transitionMission(m1.id, "gated");
      transitionMission(m1.id, "dispatched");
      transitionMission(m1.id, "streaming");
      transitionMission(m1.id, "complete");
      transitionMission(m1.id, "aar_pending");
      transitionMission(m1.id, "aar_complete");

      transitionMission(m2.id, "queued");
      transitionMission(m2.id, "gated");
      transitionMission(m2.id, "dispatched");
      transitionMission(m2.id, "streaming");
      transitionMission(m2.id, "complete");
      transitionMission(m2.id, "aar_pending");
      transitionMission(m2.id, "aar_complete");

      // m3 in active (queued)
      transitionMission(m3.id, "queued");

      // m4 stays draft (no-op)

      const progress = getInitiativeProgress(ini.id);
      expect(progress.total_missions).toBe(4);
      expect(progress.completed).toBe(2);
      expect(progress.active).toBeGreaterThanOrEqual(1); // m3 is queued
      expect(progress.progress_pct).toBe(50); // 2/4 = 50%
    });

    it("counts failed missions separately", () => {
      const ini = createInitiative({ title: "Op FAILED", objective: "Track failures" });

      const m1 = createMission({ ...missionBase, title: "Failed M1" });
      const m2 = createMission({ ...missionBase, title: "Aborted M2" });
      assignMissionToInitiative(m1.id, ini.id);
      assignMissionToInitiative(m2.id, ini.id);

      transitionMission(m1.id, "queued");
      transitionMission(m1.id, "gated");
      transitionMission(m1.id, "dispatched");
      transitionMission(m1.id, "streaming");
      transitionMission(m1.id, "failed");

      transitionMission(m2.id, "queued");
      transitionMission(m2.id, "aborted");

      const progress = getInitiativeProgress(ini.id);
      expect(progress.failed).toBe(2);
      expect(progress.completed).toBe(0);
      expect(progress.progress_pct).toBe(0);
    });
  });

  describe("Mission Assignment", () => {
    it("assigns a mission to an initiative", () => {
      const ini = createInitiative({ title: "Op ASSIGN", objective: "Assign missions" });
      const m = createMission({ ...missionBase, title: "Assign Me" });

      const ok = assignMissionToInitiative(m.id, ini.id);
      expect(ok).toBe(true);

      const progress = getInitiativeProgress(ini.id);
      expect(progress.total_missions).toBe(1);
    });

    it("returns false for non-existent initiative", () => {
      const m = createMission({ ...missionBase, title: "No Initiative" });
      const ok = assignMissionToInitiative(m.id, "in_nonexistent");
      expect(ok).toBe(false);
    });

    it("reassigns a mission to a different initiative", () => {
      const ini1 = createInitiative({ title: "Op FIRST", objective: "First" });
      const ini2 = createInitiative({ title: "Op SECOND", objective: "Second" });
      const m = createMission({ ...missionBase, title: "Reassignable" });

      assignMissionToInitiative(m.id, ini1.id);
      const p1 = getInitiativeProgress(ini1.id);
      expect(p1.total_missions).toBe(1);

      assignMissionToInitiative(m.id, ini2.id);
      const p2 = getInitiativeProgress(ini2.id);
      expect(p2.total_missions).toBe(1);
    });
  });
});
