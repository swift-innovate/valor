import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

export interface McpSession {
  session_id: string;
  agent_id: string;
  agent_callsign: string;
  connected_at: string;
  last_activity: string;
  expires_at: string;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

const sessions = new Map<string, McpSession>();
const agentIndex = new Map<string, string>(); // agent_id → session_id
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function createSession(agentId: string, callsign: string): McpSession {
  // Remove any existing session for this agent
  const existing = agentIndex.get(agentId);
  if (existing) {
    sessions.delete(existing);
    agentIndex.delete(agentId);
  }

  const now = new Date();
  const session: McpSession = {
    session_id: nanoid(21),
    agent_id: agentId,
    agent_callsign: callsign,
    connected_at: now.toISOString(),
    last_activity: now.toISOString(),
    expires_at: new Date(now.getTime() + SESSION_TIMEOUT_MS).toISOString(),
  };

  sessions.set(session.session_id, session);
  agentIndex.set(agentId, session.session_id);

  logger.info("MCP session created", {
    session_id: session.session_id,
    agent_id: agentId,
    callsign,
  });

  return session;
}

export function getSession(sessionId: string): McpSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    destroySession(sessionId);
    return null;
  }

  return session;
}

export function getSessionByAgentId(agentId: string): McpSession | null {
  const sessionId = agentIndex.get(agentId);
  if (!sessionId) return null;
  return getSession(sessionId);
}

export function touchSession(sessionId: string): McpSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = new Date();
  if (new Date(session.expires_at) < now) {
    destroySession(sessionId);
    return null;
  }

  session.last_activity = now.toISOString();
  session.expires_at = new Date(now.getTime() + SESSION_TIMEOUT_MS).toISOString();
  return session;
}

export function destroySession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  agentIndex.delete(session.agent_id);
  sessions.delete(sessionId);

  logger.info("MCP session destroyed", {
    session_id: sessionId,
    agent_id: session.agent_id,
  });

  return true;
}

export function listSessions(): McpSession[] {
  return Array.from(sessions.values());
}

export function sessionCount(): number {
  return sessions.size;
}

function cleanupExpired(): void {
  const now = new Date();
  for (const [id, session] of sessions) {
    if (new Date(session.expires_at) < now) {
      destroySession(id);
    }
  }
}

export function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
}

export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
