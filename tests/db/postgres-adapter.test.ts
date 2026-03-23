import { beforeEach, describe, expect, it, vi } from "vitest";

type LoggedQuery = {
  text: string;
  values: unknown[];
};

type SessionLog = {
  queries: LoggedQuery[];
  closed: boolean;
};

const workerState = vi.hoisted(() => ({
  oneShotQueries: [] as LoggedQuery[],
  sessions: [] as SessionLog[],
  queryResults: new Map<string, { rows: Record<string, unknown>[]; rowCount: number }>(),
  queryErrors: new Map<string, string>(),
}));

vi.mock("worker_threads", () => {
  class FakePort {
    peer: FakePort | null = null;
    queue: unknown[] = [];
    handlers: Array<(message: unknown) => void> = [];

    postMessage(message: unknown) {
      if (!this.peer) {
        throw new Error("FakePort has no peer");
      }

      this.peer.queue.push(message);
      for (const handler of this.peer.handlers) {
        handler(message);
      }
    }

    on(event: string, handler: (message: unknown) => void) {
      if (event === "message") {
        this.handlers.push(handler);
      }
    }

    start() {}
  }

  class FakeMessageChannel {
    port1 = new FakePort();
    port2 = new FakePort();

    constructor() {
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  }

  function signal(controlBuffer: SharedArrayBuffer) {
    const control = new Int32Array(controlBuffer);
    Atomics.store(control, 0, 1);
    Atomics.notify(control, 0);
  }

  function getQueryPayload(text: string) {
    const error = workerState.queryErrors.get(text);
    if (error) {
      return { rows: [], rowCount: 0, error };
    }

    const result = workerState.queryResults.get(text);
    if (result) {
      return { ...result, error: null };
    }

    return { rows: [], rowCount: 1, error: null };
  }

  class FakeWorker {
    constructor(
      _code: string,
      options: {
        workerData: {
          mode?: string;
          text?: string;
          values?: unknown[];
          port: FakePort;
          controlBuffer: SharedArrayBuffer;
        };
      },
    ) {
      const { workerData } = options;

      if (workerData.mode === "session") {
        const session: SessionLog = { queries: [], closed: false };
        workerState.sessions.push(session);

        workerData.port.on("message", (message) => {
          const command = message as {
            type: "query" | "close";
            text?: string;
            values?: unknown[];
            controlBuffer: SharedArrayBuffer;
          };

          if (command.type === "close") {
            session.closed = true;
            workerData.port.postMessage({ type: "closed", error: null });
            signal(command.controlBuffer);
            return;
          }

          session.queries.push({ text: command.text ?? "", values: command.values ?? [] });
          workerData.port.postMessage({ type: "result", ...getQueryPayload(command.text ?? "") });
          signal(command.controlBuffer);
        });

        workerData.port.postMessage({ type: "ready", error: null });
        signal(workerData.controlBuffer);
        return;
      }

      const text = workerData.text ?? "";
      const values = workerData.values ?? [];
      workerState.oneShotQueries.push({ text, values });
      workerData.port.postMessage(getQueryPayload(text));
      signal(workerData.controlBuffer);
    }

    terminate() {
      return Promise.resolve(0);
    }
  }

  return {
    Worker: FakeWorker,
    MessageChannel: FakeMessageChannel,
    receiveMessageOnPort: (port: FakePort) => {
      const message = port.queue.shift();
      return message === undefined ? undefined : { message };
    },
  };
});

describe("createPostgresAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
    workerState.oneShotQueries.length = 0;
    workerState.sessions.length = 0;
    workerState.queryResults.clear();
    workerState.queryErrors.clear();
  });

  it("keeps non-transaction queries on the one-shot worker path", async () => {
    workerState.queryResults.set("SELECT * FROM widgets WHERE id = $1", {
      rows: [{ id: "w1", state: "ready" }],
      rowCount: 1,
    });

    const { createPostgresAdapter } = await import("../../src/db/adapters/postgres-adapter.js");
    const adapter = createPostgresAdapter("postgresql://test");

    expect(adapter.queryOne("SELECT * FROM widgets WHERE id = @id", { id: "w1" })).toEqual({
      id: "w1",
      state: "ready",
    });
    expect(workerState.oneShotQueries).toEqual([
      { text: "SELECT * FROM widgets WHERE id = $1", values: ["w1"] },
    ]);
    expect(workerState.sessions).toEqual([]);
  });

  it("wraps transaction callbacks in BEGIN and COMMIT on a single session", async () => {
    workerState.queryResults.set("SELECT * FROM widgets WHERE id = $1", {
      rows: [{ id: "w1", state: "promoted" }],
      rowCount: 1,
    });

    const { createPostgresAdapter } = await import("../../src/db/adapters/postgres-adapter.js");
    const adapter = createPostgresAdapter("postgresql://test");

    const row = adapter.transaction(() => {
      adapter.execute("UPDATE widgets SET state = @state WHERE id = @id", {
        state: "promoted",
        id: "w1",
      });

      return adapter.queryOne("SELECT * FROM widgets WHERE id = @id", { id: "w1" });
    });

    expect(row).toEqual({ id: "w1", state: "promoted" });
    expect(workerState.oneShotQueries).toEqual([]);
    expect(workerState.sessions).toHaveLength(1);
    expect(workerState.sessions[0]?.queries).toEqual([
      { text: "BEGIN", values: [] },
      { text: "UPDATE widgets SET state = $1 WHERE id = $2", values: ["promoted", "w1"] },
      { text: "SELECT * FROM widgets WHERE id = $1", values: ["w1"] },
      { text: "COMMIT", values: [] },
    ]);
    expect(workerState.sessions[0]?.closed).toBe(true);
  });

  it("rolls back the session when a query fails inside transaction()", async () => {
    workerState.queryErrors.set(
      "UPDATE widgets SET state = $1 WHERE id = $2",
      "constraint violation",
    );

    const { createPostgresAdapter } = await import("../../src/db/adapters/postgres-adapter.js");
    const adapter = createPostgresAdapter("postgresql://test");

    expect(() =>
      adapter.transaction(() => {
        adapter.execute("UPDATE widgets SET state = @state WHERE id = @id", {
          state: "invalid",
          id: "w1",
        });
      })
    ).toThrow("Postgres query error: constraint violation");

    expect(workerState.oneShotQueries).toEqual([]);
    expect(workerState.sessions).toHaveLength(1);
    expect(workerState.sessions[0]?.queries).toEqual([
      { text: "BEGIN", values: [] },
      { text: "UPDATE widgets SET state = $1 WHERE id = $2", values: ["invalid", "w1"] },
      { text: "ROLLBACK", values: [] },
    ]);
    expect(workerState.sessions[0]?.closed).toBe(true);
  });
});
