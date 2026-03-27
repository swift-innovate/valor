import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { createSqliteAdapter } from "./adapters/sqlite-adapter.js";
import { createPostgresAdapter } from "./adapters/postgres-adapter.js";
import type { DbAdapter } from "./adapter.js";
import { logger } from "../utils/logger.js";

let adapter: DbAdapter | null = null;

export function getAdapter(): DbAdapter {
  if (adapter) return adapter;

  if (config.dbBackend === "postgres") {
    if (!config.dbPostgresUrl) throw new Error("DB_POSTGRES_URL required when DB_BACKEND=postgres");
    adapter = createPostgresAdapter(config.dbPostgresUrl);
    logger.info("Database connected", { backend: "postgres" });
  } else {
    if (config.dbPath !== ":memory:") {
      const dbDir = path.dirname(config.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    }
    adapter = createSqliteAdapter(config.dbPath);
    logger.info("Database connected", { backend: "sqlite", path: config.dbPath });
  }

  return adapter;
}

/** Backward-compat alias — now returns DbAdapter instead of better-sqlite3.Database */
export function getDb(): DbAdapter {
  return getAdapter();
}

export function closeDb(): void {
  if (adapter) {
    adapter.close();
    adapter = null;
    logger.info("Database closed");
  }
}

export function runMigrations(): void {
  const db = getAdapter();
  const baseDir = path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  );
  const subdir = config.dbBackend === "postgres" ? "postgres" : "sqlite";
  const migrationsDir = path.join(baseDir, "migrations", subdir);

  const createMigrationsTable =
    config.dbBackend === "postgres"
      ? `CREATE TABLE IF NOT EXISTS _migrations (
           id SERIAL PRIMARY KEY,
           filename TEXT NOT NULL UNIQUE,
           applied_at TEXT NOT NULL DEFAULT NOW()
         )`
      : `CREATE TABLE IF NOT EXISTS _migrations (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           filename TEXT NOT NULL UNIQUE,
           applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`;

  db.exec(createMigrationsTable);

  const applied = new Set(
    db
      .queryAll<{ filename: string }>("SELECT filename FROM _migrations")
      .map((row) => row.filename),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    db.exec(sql);
    db.execute("INSERT INTO _migrations (filename) VALUES (@filename)", { filename: file });
    logger.info("Migration applied", { file });
  }
}

/** Reset the adapter singleton for testing. */
export function resetDb(): void {
  if (adapter) {
    adapter.close();
    adapter = null;
  }
}
