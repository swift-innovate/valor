import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { missionRoutes } from "../../src/api/missions.js";

const app = new Hono();
app.route("/missions", missionRoutes);

beforeEach(() => freshDb());
afterEach(() => cleanupDb());

const missionPayload = {
  title: "Test Mission",
  objective: "Accomplish something",
  priority: "normal",
};

describe("Director-only mission endpoints", () => {
  describe("POST /missions", () => {
    it("returns 403 without X-VALOR-Role header", async () => {
      const res = await app.request("/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(missionPayload),
      });
      expect(res.status).toBe(403);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("Director");
    });

    it("returns 403 with agent role header", async () => {
      const res = await app.request("/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VALOR-Role": "agent" },
        body: JSON.stringify(missionPayload),
      });
      expect(res.status).toBe(403);
    });

    it("creates mission with X-VALOR-Role: director", async () => {
      const res = await app.request("/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VALOR-Role": "director" },
        body: JSON.stringify(missionPayload),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as { id: string };
      expect(data.id).toMatch(/^mis_/);
    });

    it("creates mission with X-VALOR-Role: system", async () => {
      const res = await app.request("/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VALOR-Role": "system" },
        body: JSON.stringify(missionPayload),
      });
      expect(res.status).toBe(201);
    });
  });

  describe("POST /missions/from-sigint", () => {
    it("returns 403 without X-VALOR-Role header", async () => {
      const res = await app.request("/missions/from-sigint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "SIGINT Mission",
          objective: "Test",
          source: { intercept_id: "test-001" },
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("Open endpoints (no auth required)", () => {
    it("GET /missions is accessible without header", async () => {
      const res = await app.request("/missions");
      expect(res.status).toBe(200);
    });

    it("POST /missions/:id/aar is accessible without header (agents submit AARs)", async () => {
      // Create a mission first via director
      const createRes = await app.request("/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VALOR-Role": "director" },
        body: JSON.stringify(missionPayload),
      });
      const { id } = await createRes.json() as { id: string };

      // AAR submission should not require director role
      const aarRes = await app.request(`/missions/${id}/aar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      // Will fail because mission isn't in aar_pending state, but not a 403
      expect(aarRes.status).not.toBe(403);
    });
  });
});
