import fs from "fs";
import { config } from "../../src/config.js";
import { resetDb, runMigrations } from "../../src/db/database.js";

/** Reset DB singleton, delete the db file, and re-run migrations for a clean slate. */
export function freshDb() {
  resetDb();
  // Remove db file and WAL/SHM sidecars
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = config.dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  runMigrations();
}

export function cleanupDb() {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = config.dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
