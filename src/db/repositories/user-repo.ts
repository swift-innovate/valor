import { nanoid } from "nanoid";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "../database.js";
import { logger } from "../../utils/logger.js";

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: "director" | "operator" | "observer";
  created_at: string;
  updated_at: string;
}

export type SafeUser = Omit<User, "password_hash">;

export function toSafeUser(user: User): SafeUser {
  const { password_hash, ...safe } = user;
  return safe;
}

function generateId(): string {
  return `usr_${nanoid(21)}`;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const derived = scryptSync(password, salt, 64);
    return timingSafeEqual(derived, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function createUser(input: {
  username: string;
  password: string;
  role: "director" | "operator" | "observer";
}): User {
  const now = new Date().toISOString();
  const id = generateId();
  const password_hash = hashPassword(input.password);

  getDb().execute(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (@id, @username, @password_hash, @role, @created_at, @updated_at)`,
    { id, username: input.username, password_hash, role: input.role, created_at: now, updated_at: now },
  );

  return getUser(id)!;
}

export function getUser(id: string): User | null {
  return getDb().queryOne<User>("SELECT * FROM users WHERE id = @id", { id });
}

export function getUserByUsername(username: string): User | null {
  return getDb().queryOne<User>("SELECT * FROM users WHERE username = @username", { username });
}

export function listUsers(): User[] {
  return getDb().queryAll<User>("SELECT * FROM users ORDER BY role, username");
}

export function updateUserRole(id: string, role: "director" | "operator" | "observer"): User | null {
  const now = new Date().toISOString();
  getDb().execute(
    "UPDATE users SET role = @role, updated_at = @updated_at WHERE id = @id",
    { id, role, updated_at: now },
  );
  return getUser(id);
}

export function updateUserPassword(id: string, password: string): void {
  const now = new Date().toISOString();
  const password_hash = hashPassword(password);
  getDb().execute(
    "UPDATE users SET password_hash = @password_hash, updated_at = @updated_at WHERE id = @id",
    { id, password_hash, updated_at: now },
  );
}

export function deleteUser(id: string): boolean {
  const result = getDb().execute("DELETE FROM users WHERE id = @id", { id });
  return result.changes > 0;
}

export function userCount(): number {
  const row = getDb().queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM users");
  return row?.cnt ?? 0;
}

/** Seed a default director account if no users exist yet. */
export function seedDefaultUser(): void {
  if (userCount() === 0) {
    createUser({ username: "director", password: "valor", role: "director" });
    logger.warn("Default director account created (username: director, password: valor) — CHANGE THIS PASSWORD");
  }
}
