import { resetDb, runMigrations } from "../../src/db/database.js";

/**
 * Reset DB singleton and re-run migrations for a clean slate.
 * Uses :memory: SQLite databases (set in setup.ts) to avoid WSL disk I/O issues.
 */
export function freshDb() {
  // Safety check — refuse to touch production database
  const currentPath = process.env.VALOR_DB_PATH ?? "";
  if (currentPath === "./data/valor.db" || currentPath === "data/valor.db" || currentPath === "") {
    throw new Error(
      "REFUSING to run freshDb() against production database. " +
      "VALOR_DB_PATH must be set to a test path. Check tests/helpers/setup.ts."
    );
  }

  resetDb();
  runMigrations();
}

export function cleanupDb() {
  resetDb();
}
