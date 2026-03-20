import { randomBytes } from "node:crypto";
import { getDb } from "../database.js";
import type { User } from "./user-repo.js";

export interface Session {
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(user_id: string): Session {
  const token = randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  getDb().execute(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES (@token, @user_id, @expires_at, @created_at)`,
    { token, user_id, expires_at, created_at: now },
  );

  return { token, user_id, expires_at, created_at: now };
}

export function getSession(token: string): Session | null {
  const session = getDb().queryOne<Session>("SELECT * FROM sessions WHERE token = @token", { token });
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    deleteSession(token);
    return null;
  }
  return session;
}

export function deleteSession(token: string): void {
  getDb().execute("DELETE FROM sessions WHERE token = @token", { token });
}

export function deleteUserSessions(user_id: string): void {
  getDb().execute("DELETE FROM sessions WHERE user_id = @user_id", { user_id });
}

export function cleanExpiredSessions(): void {
  getDb().execute("DELETE FROM sessions WHERE expires_at < @now", { now: new Date().toISOString() });
}
