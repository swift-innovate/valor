import Database from "better-sqlite3";
import type { DbAdapter, DbRow, DbResult } from "../adapter.js";

export function createSqliteAdapter(dbPath: string): DbAdapter {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    queryAll<T = DbRow>(sql: string, params: Record<string, unknown> = {}): T[] {
      return db.prepare(sql).all(params) as T[];
    },

    queryOne<T = DbRow>(
      sql: string,
      params: Record<string, unknown> = {},
    ): T | null {
      return (db.prepare(sql).get(params) as T) ?? null;
    },

    execute(sql: string, params: Record<string, unknown> = {}): DbResult {
      const result = db.prepare(sql).run(params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    close(): void {
      db.close();
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare(sql: string): any {
      return db.prepare(sql);
    },
  };
}
