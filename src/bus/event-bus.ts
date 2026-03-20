import { type EventEnvelope } from "../types/index.js";
import { appendEvent, queryEvents } from "../db/repositories/event-repo.js";
import { logger } from "../utils/logger.js";

type EventHandler = (event: EventEnvelope) => void;

interface Subscription {
  pattern: string;
  handler: EventHandler;
}

function matchPattern(pattern: string, eventType: string): boolean {
  // Convert glob pattern to regex: "mission.*" matches "mission.created", "mission.status.changed"
  // "*" matches any segment(s), "mission.*" = anything starting with "mission."
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
  );
  return regex.test(eventType);
}

const subscriptions: Subscription[] = [];

export function subscribe(pattern: string, handler: EventHandler): () => void {
  const sub: Subscription = { pattern, handler };
  subscriptions.push(sub);

  // Return unsubscribe function
  return () => {
    const idx = subscriptions.indexOf(sub);
    if (idx !== -1) subscriptions.splice(idx, 1);
  };
}

export function publish(input: Omit<EventEnvelope, "id" | "timestamp">): EventEnvelope {
  // Persist to SQLite
  const event = appendEvent(input);

  // Notify matching subscribers (error-isolated)
  for (const sub of subscriptions) {
    if (matchPattern(sub.pattern, event.type)) {
      try {
        sub.handler(event);
      } catch (err) {
        logger.error("Subscriber error", {
          pattern: sub.pattern,
          event_type: event.type,
          event_id: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return event;
}

export function replay(
  fromTimestamp: string,
  pattern?: string,
): EventEnvelope[] {
  const events = queryEvents({
    from: fromTimestamp,
    type: pattern,
  });

  // Re-emit to current subscribers
  for (const event of events) {
    for (const sub of subscriptions) {
      if (matchPattern(sub.pattern, event.type)) {
        try {
          sub.handler(event);
        } catch (err) {
          logger.error("Replay subscriber error", {
            pattern: sub.pattern,
            event_type: event.type,
            event_id: event.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return events;
}

export function subscriberCount(): number {
  return subscriptions.length;
}

export function clearSubscriptions(): void {
  subscriptions.length = 0;
}
