import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  getSession,
  getSessionByAgentId,
  touchSession,
  destroySession,
  listSessions,
  sessionCount,
} from "../../src/mcp/session-manager.js";

// Reset sessions between tests by destroying all
beforeEach(() => {
  for (const s of listSessions()) {
    destroySession(s.session_id);
  }
});

describe("MCP Session Manager", () => {
  it("creates a session with correct fields", () => {
    const session = createSession("agent_1", "Mira");
    expect(session.session_id).toBeTruthy();
    expect(session.agent_id).toBe("agent_1");
    expect(session.agent_callsign).toBe("Mira");
    expect(session.connected_at).toBeTruthy();
    expect(session.last_activity).toBeTruthy();
    expect(session.expires_at).toBeTruthy();
  });

  it("retrieves a session by ID", () => {
    const created = createSession("agent_1", "Mira");
    const retrieved = getSession(created.session_id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.agent_id).toBe("agent_1");
  });

  it("retrieves a session by agent ID", () => {
    createSession("agent_1", "Mira");
    const session = getSessionByAgentId("agent_1");
    expect(session).not.toBeNull();
    expect(session!.agent_callsign).toBe("Mira");
  });

  it("returns null for unknown session", () => {
    expect(getSession("nonexistent")).toBeNull();
  });

  it("replaces existing session for same agent", () => {
    const first = createSession("agent_1", "Mira");
    const second = createSession("agent_1", "Mira");
    expect(first.session_id).not.toBe(second.session_id);
    expect(getSession(first.session_id)).toBeNull();
    expect(getSession(second.session_id)).not.toBeNull();
    expect(sessionCount()).toBe(1);
  });

  it("touches a session to extend expiry", () => {
    const session = createSession("agent_1", "Mira");
    const originalExpiry = session.expires_at;
    // Small delay to ensure different timestamp
    const touched = touchSession(session.session_id);
    expect(touched).not.toBeNull();
    expect(new Date(touched!.expires_at).getTime()).toBeGreaterThanOrEqual(
      new Date(originalExpiry).getTime(),
    );
  });

  it("destroys a session", () => {
    const session = createSession("agent_1", "Mira");
    expect(destroySession(session.session_id)).toBe(true);
    expect(getSession(session.session_id)).toBeNull();
    expect(getSessionByAgentId("agent_1")).toBeNull();
    expect(sessionCount()).toBe(0);
  });

  it("returns false when destroying nonexistent session", () => {
    expect(destroySession("nonexistent")).toBe(false);
  });

  it("lists all sessions", () => {
    createSession("agent_1", "Mira");
    createSession("agent_2", "Gage");
    expect(listSessions()).toHaveLength(2);
    expect(sessionCount()).toBe(2);
  });
});
