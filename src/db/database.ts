import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  logger.info("Database connected", { path: config.dbPath });
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info("Database closed");
  }
}

export function runMigrations(): void {
  const database = getDb();
  const migrationsDir = path.join(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
    "migrations",
  );

  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database
      .prepare("SELECT filename FROM _migrations")
      .all()
      .map((row) => (row as { filename: string }).filename),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    database.exec(sql);
    database.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(file);
    logger.info("Migration applied", { file });
  }
}

export function queryAll<T>(sql: string, params: Record<string, unknown> = {}): T[] {
  return getDb().prepare(sql).all(params) as T[];
}

export function queryOne<T>(sql: string, params: Record<string, unknown> = {}): T | null {
  return (getDb().prepare(sql).get(params) as T) ?? null;
}

export function execute(sql: string, params: Record<string, unknown> = {}): Database.RunResult {
  return getDb().prepare(sql).run(params);
}

/** Reset the singleton for testing. */
export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
