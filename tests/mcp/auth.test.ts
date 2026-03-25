import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { createAgent } from "../../src/db/repositories/index.js";
import { resolveAgentIdentity } from "../../src/mcp/auth.js";

beforeEach(() => {
  freshDb();
  // Create a test agent
  createAgent({
    callsign: "Mira",
    runtime: "claude_api",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "healthy",
    last_heartbeat: null,
  });
});
afterEach(() => cleanupDb());

describe("MCP Auth", () => {
  it("resolves agent by callsign with fallback enabled", () => {
    const agent = resolveAgentIdentity("Mira");
    expect(agent).not.toBeNull();
    expect(agent!.callsign).toBe("Mira");
  });

  it("returns null for unknown callsign", () => {
    expect(resolveAgentIdentity("UnknownAgent")).toBeNull();
  });

  it("rejects deregistered agents", () => {
    createAgent({
      callsign: "Ghost",
      runtime: "custom",
      division_id: null,
      endpoint_url: null,
      model: null,
      persona_id: null,
      capabilities: [],
      health_status: "deregistered",
      last_heartbeat: null,
    });
    expect(resolveAgentIdentity("Ghost")).toBeNull();
  });
});
