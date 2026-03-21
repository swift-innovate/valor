import fs from "fs";
import { resetDb, runMigrations } from "../../src/db/database.js";

// CRITICAL: Test database path — must NEVER be the production path.
// This is hardcoded to prevent any possibility of tests erasing live data.
const TEST_DB_PATH = "./data/valor-test.db";

/** Reset DB singleton, delete the TEST db file, and re-run migrations for a clean slate. */
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
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = TEST_DB_PATH + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  runMigrations();
}

export function cleanupDb() {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = TEST_DB_PATH + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
