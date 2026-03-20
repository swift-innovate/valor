import { Worker, MessageChannel, receiveMessageOnPort } from "worker_threads";
import type { DbAdapter, DbRow, DbResult } from "../adapter.js";

// TODO: Migrate to async adapter pattern for better performance.
// This sync implementation creates one PG connection per query using worker_threads
// to block the main thread via Atomics.wait(). Acceptable for current scale.
// See tasks/db-adapter-abstraction.md for the async migration path.

// CJS worker — eval:true always runs as CommonJS regardless of package type
const WORKER_CODE = `
const { workerData } = require('worker_threads');
const pg = require('pg');

// Parse bigint columns (e.g. COUNT(*)) as JS numbers
pg.types.setTypeParser(20, val => parseInt(val, 10));

async function run() {
  const { connectionString, text, values, port, controlBuffer } = workerData;
  const control = new Int32Array(controlBuffer);
  const client = new pg.Client({ connectionString });
  let rows = [], rowCount = 0, error = null;

  try {
    await client.connect();
    const result = await client.query(text, values && values.length > 0 ? values : undefined);
    await client.end();
    rows = result.rows;
    rowCount = result.rowCount != null ? result.rowCount : 0;
  } catch (err) {
    error = err.message || String(err);
    try { await client.end(); } catch (_) {}
  }

  // Send result first, then signal main thread to unblock
  port.postMessage({ rows, rowCount, error });
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
}

run().catch(err => {
  const { port, controlBuffer } = workerData;
  const control = new Int32Array(controlBuffer);
  port.postMessage({ rows: [], rowCount: 0, error: err.message || String(err) });
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
});
`;

interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function translateSql(
  sql: string,
  params: Record<string, unknown>,
): { text: string; values: unknown[] } {
  // Translate json_extract(col, '$.key') → (col::jsonb)->>'key' for Postgres
  let text = sql.replace(
    /json_extract\((\w+),\s*'\$\.(\w+)'\)/g,
    "($1::jsonb)->>'$2'",
  );

  // Translate @param named params → $N positional params
  const values: unknown[] = [];
  let index = 0;
  text = text.replace(/@(\w+)/g, (_, name) => {
    values.push(params[name] ?? null);
    return `$${++index}`;
  });

  return { text, values };
}

function runPgQuery(connectionString: string, text: string, values: unknown[]): PgQueryResult {
  const { port1, port2 } = new MessageChannel();
  const controlBuffer = new SharedArrayBuffer(4);
  const control = new Int32Array(controlBuffer);

  const worker = new Worker(WORKER_CODE, {
    eval: true,
    workerData: { connectionString, text, values, port: port2, controlBuffer },
    transferList: [port2],
  });

  // Block main thread until worker signals completion (legal on Node.js main thread)
  Atomics.wait(control, 0, 0);

  const msg = receiveMessageOnPort(port1);
  worker.terminate();

  if (!msg) {
    throw new Error("Postgres worker did not return a result");
  }

  const { rows, rowCount, error } = msg.message as {
    rows: Record<string, unknown>[];
    rowCount: number;
    error: string | null;
  };

  if (error) throw new Error(`Postgres query error: ${error}`);
  return { rows, rowCount };
}

export function createPostgresAdapter(connectionString: string): DbAdapter {
  return {
    queryAll<T extends DbRow = DbRow>(sql: string, params: Record<string, unknown> = {}): T[] {
      const { text, values } = translateSql(sql, params);
      const { rows } = runPgQuery(connectionString, text, values);
      return rows as T[];
    },

    queryOne<T extends DbRow = DbRow>(
      sql: string,
      params: Record<string, unknown> = {},
    ): T | null {
      const { text, values } = translateSql(sql, params);
      const { rows } = runPgQuery(connectionString, text, values);
      return rows.length > 0 ? (rows[0] as T) : null;
    },

    execute(sql: string, params: Record<string, unknown> = {}): DbResult {
      const { text, values } = translateSql(sql, params);
      const { rowCount } = runPgQuery(connectionString, text, values);
      return { changes: rowCount };
    },

    exec(sql: string): void {
      // Split multi-statement SQL into individual statements for Postgres
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        runPgQuery(connectionString, statement, []);
      }
    },

    // TODO: Implement real BEGIN/COMMIT/ROLLBACK transaction support.
    // No existing repos use transaction() so this no-op is safe for now.
    // Division membership Phase 1 will require real transactions — fix before then.
    transaction<T>(fn: () => T): T {
      return fn();
    },

    close(): void {
      // No persistent connection to close — each query creates its own connection
    },

    prepare(_sql: string): never {
      throw new Error("prepare() is not supported on the Postgres adapter. Use queryAll/queryOne/execute.");
    },
  };
}
