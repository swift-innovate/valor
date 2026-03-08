import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  subscribe,
  publish,
  replay,
  subscriberCount,
  clearSubscriptions,
} from "../../src/bus/event-bus.js";
import type { EventEnvelope } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

const baseEvent = {
  type: "mission.created",
  source: { id: "system", type: "system" as const },
  target: null,
  conversation_id: null,
  in_reply_to: null,
  payload: { test: true },
  metadata: null,
};

describe("EventBus pub/sub", () => {
  it("delivers events to matching subscribers", () => {
    const received: EventEnvelope[] = [];
    subscribe("mission.*", (e) => received.push(e));

    publish(baseEvent);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("mission.created");
  });

  it("does not deliver to non-matching subscribers", () => {
    const received: EventEnvelope[] = [];
    subscribe("agent.*", (e) => received.push(e));

    publish(baseEvent);
    expect(received).toHaveLength(0);
  });

  it("supports exact pattern matching", () => {
    const received: EventEnvelope[] = [];
    subscribe("mission.created", (e) => received.push(e));

    publish(baseEvent);
    publish({ ...baseEvent, type: "mission.updated" });
    expect(received).toHaveLength(1);
  });

  it("supports wildcard matching across levels", () => {
    const received: EventEnvelope[] = [];
    subscribe("mission.*", (e) => received.push(e));

    publish(baseEvent);
    publish({ ...baseEvent, type: "mission.status.changed" });
    expect(received).toHaveLength(2);
  });

  it("unsubscribes correctly", () => {
    const received: EventEnvelope[] = [];
    const unsub = subscribe("mission.*", (e) => received.push(e));

    publish(baseEvent);
    expect(received).toHaveLength(1);

    unsub();
    publish(baseEvent);
    expect(received).toHaveLength(1);
  });

  it("tracks subscriber count", () => {
    expect(subscriberCount()).toBe(0);
    const unsub1 = subscribe("a", () => {});
    const unsub2 = subscribe("b", () => {});
    expect(subscriberCount()).toBe(2);
    unsub1();
    expect(subscriberCount()).toBe(1);
  });
});

describe("EventBus persistence", () => {
  it("persists events to SQLite", () => {
    const event = publish(baseEvent);
    expect(event.id).toMatch(/^evt_/);
    expect(event.timestamp).toBeTruthy();
  });
});

describe("EventBus error isolation", () => {
  it("does not crash on subscriber errors", () => {
    subscribe("mission.*", () => {
      throw new Error("boom");
    });

    const received: EventEnvelope[] = [];
    subscribe("mission.*", (e) => received.push(e));

    publish(baseEvent);
    expect(received).toHaveLength(1);
  });
});

describe("EventBus replay", () => {
  it("replays events from a timestamp", () => {
    const before = new Date().toISOString();
    publish(baseEvent);
    publish({ ...baseEvent, type: "mission.updated" });

    const received: EventEnvelope[] = [];
    subscribe("mission.*", (e) => received.push(e));

    const events = replay(before, "mission.*");
    expect(events).toHaveLength(2);
    expect(received).toHaveLength(2);
  });

  it("replays only matching pattern", () => {
    const before = new Date().toISOString();
    publish(baseEvent);
    publish({ ...baseEvent, type: "agent.heartbeat" });

    const events = replay(before, "mission.*");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("mission.created");
  });
});
