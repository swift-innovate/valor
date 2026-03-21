/** Base row type returned by query methods. Consumers may supply a narrower T. */
export type DbRow = Record<string, unknown>;

export interface DbResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface DbAdapter {
  /** Query returning multiple rows */
  queryAll<T = DbRow>(sql: string, params?: Record<string, unknown>): T[];

  /** Query returning one row or null */
  queryOne<T = DbRow>(sql: string, params?: Record<string, unknown>): T | null;

  /** Execute a statement (INSERT, UPDATE, DELETE) */
  execute(sql: string, params?: Record<string, unknown>): DbResult;

  /** Execute raw SQL (for migrations, multi-statement) */
  exec(sql: string): void;

  /** Run a function inside a transaction */
  transaction<T>(fn: () => T): T;

  /** Close the connection */
  close(): void;

  /**
   * Escape hatch: access raw prepared statement API (SQLite only).
   * Delegates to better-sqlite3's prepare() — returns a Statement object.
   * Used by tests that need PRAGMA queries or raw SQL access.
   * Throws on Postgres. Do not use in application code — use queryAll/queryOne/execute.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare(sql: string): any;
}
