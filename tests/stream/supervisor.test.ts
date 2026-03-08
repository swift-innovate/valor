import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import {
  supervise,
  abort,
  getStreamHealth,
  getActiveSessions,
  clearSessions,
} from "../../src/stream/supervisor.js";
import type { StreamEvent, EventEnvelope } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
  clearSessions();
});

afterEach(() => {
  clearSessions();
  clearSubscriptions();
  cleanupDb();
});

/** Create an async iterable from an array with optional delay between items. */
async function* makeStream(events: StreamEvent[], delayMs = 0): AsyncIterable<StreamEvent> {
  for (const event of events) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    yield event;
  }
}

function streamEvent(
  sessionId: string,
  sequence: number,
  type: StreamEvent["event_type"],
  data: Record<string, unknown> = {},
): StreamEvent {
  return {
    session_id: sessionId,
    sequence,
    event_type: type,
    data,
    timestamp: new Date().toISOString(),
  };
}

describe("StreamSupervisor", () => {
  it("supervises a stream and emits started event", async () => {
    const busEvents: EventEnvelope[] = [];
    subscribe("stream.*", (e) => busEvents.push(e));

    const events = [
      streamEvent("s1", 0, "heartbeat"),
      streamEvent("s1", 1, "token", { text: "hello" }),
      streamEvent("s1", 2, "completion"),
    ];

    supervise("mis_test1", makeStream(events));

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100));

    const started = busEvents.find((e) => e.type === "stream.started");
    expect(started).toBeDefined();
    expect(started!.payload.mission_id).toBe("mis_test1");
  });

  it("tracks stream completion", async () => {
    const busEvents: EventEnvelope[] = [];
    subscribe("stream.*", (e) => busEvents.push(e));

    const events = [
      streamEvent("s1", 0, "heartbeat"),
      streamEvent("s1", 1, "token", { text: "hello" }),
      streamEvent("s1", 2, "token", { text: " world" }),
      streamEvent("s1", 3, "completion"),
    ];

    supervise("mis_test2", makeStream(events));
    await new Promise((r) => setTimeout(r, 100));

    const completed = busEvents.find((e) => e.type === "stream.completed");
    expect(completed).toBeDefined();
    expect(completed!.payload.total_chunks).toBe(2);
    expect(completed!.payload.total_errors).toBe(0);
  });

  it("counts errors in stream events", async () => {
    const busEvents: EventEnvelope[] = [];
    subscribe("stream.*", (e) => busEvents.push(e));

    const events = [
      streamEvent("s1", 0, "heartbeat"),
      streamEvent("s1", 1, "error", { error: "provider hiccup" }),
      streamEvent("s1", 2, "token", { text: "recovered" }),
      streamEvent("s1", 3, "completion"),
    ];

    supervise("mis_test3", makeStream(events));
    await new Promise((r) => setTimeout(r, 100));

    const completed = busEvents.find((e) => e.type === "stream.completed");
    expect(completed).toBeDefined();
    expect(completed!.payload.total_errors).toBe(1);
  });

  it("detects sequence gaps", async () => {
    const busEvents: EventEnvelope[] = [];
    subscribe("stream.*", (e) => busEvents.push(e));

    const events = [
      streamEvent("s1", 0, "heartbeat"),
      streamEvent("s1", 1, "token", { text: "a" }),
      // Skip sequence 2
      streamEvent("s1", 3, "token", { text: "c" }),
      streamEvent("s1", 4, "completion"),
    ];

    supervise("mis_test4", makeStream(events));
    await new Promise((r) => setTimeout(r, 100));

    const completed = busEvents.find((e) => e.type === "stream.completed");
    expect(completed).toBeDefined();
    expect((completed!.payload.sequence_gaps as number[]).length).toBeGreaterThan(0);
  });

  it("can abort a stream", async () => {
    const busEvents: EventEnvelope[] = [];
    subscribe("stream.*", (e) => busEvents.push(e));

    // Slow stream that we'll abort
    const events = [
      streamEvent("s1", 0, "heartbeat"),
      streamEvent("s1", 1, "token", { text: "a" }),
      streamEvent("s1", 2, "token", { text: "b" }),
      streamEvent("s1", 3, "token", { text: "c" }),
      streamEvent("s1", 4, "completion"),
    ];

    supervise("mis_test5", makeStream(events, 50));
    await new Promise((r) => setTimeout(r, 30));

    const aborted = abort("mis_test5", "test abort");
    expect(aborted).toBe(true);

    await new Promise((r) => setTimeout(r, 100));

    const failed = busEvents.find((e) => e.type === "stream.failed");
    expect(failed).toBeDefined();
    expect((failed!.payload.reason as string)).toContain("Aborted");
  });

  it("returns false when aborting non-existent stream", () => {
    expect(abort("mis_nonexistent", "test")).toBe(false);
  });

  it("tracks active sessions", async () => {
    // Slow stream to keep it active
    const events = [
      streamEvent("s1", 0, "heartbeat"),
      streamEvent("s1", 1, "token", { text: "a" }),
      streamEvent("s1", 2, "completion"),
    ];

    supervise("mis_test6", makeStream(events, 50));
    expect(getActiveSessions().length).toBe(1);

    const session = getStreamHealth("mis_test6");
    expect(session).toBeDefined();
    expect(session!.mission_id).toBe("mis_test6");

    // Wait for completion
    await new Promise((r) => setTimeout(r, 300));
    expect(getActiveSessions().length).toBe(0);
  });
});
