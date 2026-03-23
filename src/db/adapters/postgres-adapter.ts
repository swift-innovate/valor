import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from "worker_threads";
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

function formatError(err) {
  return err && err.message ? err.message : String(err);
}

function signal(controlBuffer) {
  const control = new Int32Array(controlBuffer);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
}

async function runQuery(client, text, values) {
  const result = await client.query(text, values && values.length > 0 ? values : undefined);
  return {
    rows: result.rows,
    rowCount: result.rowCount != null ? result.rowCount : 0,
    error: null,
  };
}

async function runSingleQuery() {
  const { connectionString, text, values, port, controlBuffer } = workerData;
  const client = new pg.Client({ connectionString });
  let payload;

  try {
    await client.connect();
    payload = await runQuery(client, text, values);
    await client.end();
  } catch (err) {
    payload = { rows: [], rowCount: 0, error: formatError(err) };
    try { await client.end(); } catch (_) {}
  }

  port.postMessage(payload);
  signal(controlBuffer);
}

async function runSession() {
  const { connectionString, port, controlBuffer } = workerData;
  const client = new pg.Client({ connectionString });
  let pending = Promise.resolve();
  let closed = false;

  const respond = (payload, responseControlBuffer) => {
    port.postMessage(payload);
    signal(responseControlBuffer);
  };

  try {
    await client.connect();

    port.on('message', (message) => {
      pending = pending
        .then(async () => {
          if (message.type === 'close') {
            if (!closed) {
              closed = true;
              try {
                await client.end();
                respond({ type: 'closed', error: null }, message.controlBuffer);
              } catch (err) {
                respond({ type: 'closed', error: formatError(err) }, message.controlBuffer);
              }
            } else {
              respond({ type: 'closed', error: null }, message.controlBuffer);
            }
            return;
          }

          try {
            const payload = await runQuery(client, message.text, message.values);
            respond({ type: 'result', ...payload }, message.controlBuffer);
          } catch (err) {
            respond(
              { type: 'result', rows: [], rowCount: 0, error: formatError(err) },
              message.controlBuffer,
            );
          }
        })
        .catch((err) => {
          respond(
            { type: 'result', rows: [], rowCount: 0, error: formatError(err) },
            message.controlBuffer,
          );
        });
    });

    if (typeof port.start === 'function') {
      port.start();
    }

    respond({ type: 'ready', error: null }, controlBuffer);
  } catch (err) {
    try { await client.end(); } catch (_) {}
    respond({ type: 'ready', error: formatError(err) }, controlBuffer);
  }
}

if (workerData.mode === 'session') {
  runSession().catch(err => {
    const { port, controlBuffer } = workerData;
    port.postMessage({ type: 'ready', error: formatError(err) });
    signal(controlBuffer);
  });
} else {
  runSingleQuery().catch(err => {
    const { port, controlBuffer } = workerData;
    port.postMessage({ rows: [], rowCount: 0, error: formatError(err) });
    signal(controlBuffer);
  });
}
`;

interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface PgWorkerResultMessage {
  rows: Record<string, unknown>[];
  rowCount: number;
  error: string | null;
}

interface PgWorkerStatusMessage {
  type: "ready" | "closed";
  error: string | null;
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
  const { buffer: controlBuffer, control } = createControl();

  const worker = new Worker(WORKER_CODE, {
    eval: true,
    workerData: { connectionString, text, values, port: port2, controlBuffer },
    transferList: [port2],
  });

  try {
    return waitForQueryResult(port1, control, "Postgres worker did not return a result");
  } finally {
    worker.terminate();
  }
}

function createControl(): { buffer: SharedArrayBuffer; control: Int32Array } {
  const buffer = new SharedArrayBuffer(4);
  return { buffer, control: new Int32Array(buffer) };
}

function waitForMessage<T>(
  port: MessagePort,
  control: Int32Array,
  missingMessageError: string,
): T {
  // Block main thread until worker signals completion (legal on Node.js main thread)
  Atomics.wait(control, 0, 0);

  const msg = receiveMessageOnPort(port);
  if (!msg) {
    throw new Error(missingMessageError);
  }
  return msg.message as T;
}

function waitForQueryResult(
  port: MessagePort,
  control: Int32Array,
  missingMessageError: string,
): PgQueryResult {
  const { rows, rowCount, error } = waitForMessage<PgWorkerResultMessage>(
    port,
    control,
    missingMessageError,
  );

  if (error) throw new Error(`Postgres query error: ${error}`);
  return { rows, rowCount };
}

class PgTransactionSession {
  private readonly port: MessagePort;
  private readonly worker: Worker;
  private closed = false;

  constructor(connectionString: string) {
    const { port1, port2 } = new MessageChannel();
    const { buffer: controlBuffer, control } = createControl();

    this.port = port1;
    this.worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { mode: "session", connectionString, port: port2, controlBuffer },
      transferList: [port2],
    });

    const ready = waitForMessage<PgWorkerStatusMessage>(
      this.port,
      control,
      "Postgres transaction worker did not initialize",
    );

    if (ready.error) {
      this.worker.terminate();
      throw new Error(`Postgres transaction error: ${ready.error}`);
    }
  }

  query(text: string, values: unknown[]): PgQueryResult {
    const { buffer: controlBuffer, control } = createControl();
    this.port.postMessage({ type: "query", text, values, controlBuffer });
    return waitForQueryResult(this.port, control, "Postgres transaction worker did not return a result");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    const { buffer: controlBuffer, control } = createControl();

    try {
      this.port.postMessage({ type: "close", controlBuffer });
      const closed = waitForMessage<PgWorkerStatusMessage>(
        this.port,
        control,
        "Postgres transaction worker did not close cleanly",
      );

      if (closed.error) {
        throw new Error(`Postgres transaction close error: ${closed.error}`);
      }
    } finally {
      this.worker.terminate();
    }
  }
}

export function createPostgresAdapter(connectionString: string): DbAdapter {
  let transactionSession: PgTransactionSession | null = null;

  function runQuery(text: string, values: unknown[]): PgQueryResult {
    if (transactionSession) {
      return transactionSession.query(text, values);
    }
    return runPgQuery(connectionString, text, values);
  }

  return {
    queryAll<T = DbRow>(sql: string, params: Record<string, unknown> = {}): T[] {
      const { text, values } = translateSql(sql, params);
      const { rows } = runQuery(text, values);
      return rows as T[];
    },

    queryOne<T = DbRow>(
      sql: string,
      params: Record<string, unknown> = {},
    ): T | null {
      const { text, values } = translateSql(sql, params);
      const { rows } = runQuery(text, values);
      return rows.length > 0 ? (rows[0] as T) : null;
    },

    execute(sql: string, params: Record<string, unknown> = {}): DbResult {
      const { text, values } = translateSql(sql, params);
      const { rowCount } = runQuery(text, values);
      return { changes: rowCount };
    },

    exec(sql: string): void {
      // Split multi-statement SQL into individual statements for Postgres
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        runQuery(statement, []);
      }
    },

    transaction<T>(fn: () => T): T {
      if (transactionSession) {
        return fn();
      }

      const session = new PgTransactionSession(connectionString);
      transactionSession = session;

      let began = false;
      let pendingError: unknown = null;
      let result: T | undefined;

      try {
        session.query("BEGIN", []);
        began = true;

        result = fn();
        session.query("COMMIT", []);
      } catch (error) {
        pendingError = error;

        if (began) {
          try {
            session.query("ROLLBACK", []);
          } catch (rollbackFailure) {
            const rollbackError = rollbackFailure instanceof Error
              ? rollbackFailure
              : new Error(String(rollbackFailure));

            if (pendingError instanceof Error) {
              pendingError.message = `${pendingError.message} (rollback failed: ${rollbackError.message})`;
            } else {
              pendingError = rollbackError;
            }
          }
        }
      } finally {
        transactionSession = null;
        try {
          session.close();
        } catch (closeError) {
          const cleanupError = closeError instanceof Error
            ? closeError
            : new Error(String(closeError));

          if (pendingError instanceof Error) {
            pendingError.message = `${pendingError.message} (cleanup failed: ${cleanupError.message})`;
          } else if (pendingError == null) {
            pendingError = cleanupError;
          }
        }
      }

      if (pendingError != null) {
        throw pendingError;
      }

      return result as T;
    },

    close(): void {
      transactionSession?.close();
      transactionSession = null;
    },

    prepare(_sql: string): never {
      throw new Error("prepare() is not supported on the Postgres adapter. Use queryAll/queryOne/execute.");
    },
  };
}
