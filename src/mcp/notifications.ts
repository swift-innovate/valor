import { subscribe } from "../bus/event-bus.js";
import { type EventEnvelope } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { getSessionByAgentId, type McpSession } from "./session-manager.js";

type NotificationSender = (agentId: string, method: string, params: Record<string, unknown>) => void;

let sender: NotificationSender | null = null;
const unsubscribers: Array<() => void> = [];

export function setNotificationSender(fn: NotificationSender): void {
  sender = fn;
}

function sendToAgent(agentId: string, method: string, params: Record<string, unknown>): void {
  if (!sender) return;
  const session = getSessionByAgentId(agentId);
  if (!session) return;

  try {
    sender(agentId, method, params);
  } catch (e) {
    logger.warn("Failed to send MCP notification", {
      agent_id: agentId,
      method,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function startNotificationBridge(): void {
  // Mission dispatched → notify assigned agent
  unsubscribers.push(
    subscribe("mission.dispatched", (event: EventEnvelope) => {
      const payload = event.payload as Record<string, unknown>;
      const agentId = payload.assigned_agent_id as string;
      if (agentId) {
        sendToAgent(agentId, "notifications/valor/mission_assigned", {
          mission_id: payload.mission_id as string,
          title: payload.title as string,
          priority: payload.priority as string,
          objective: payload.objective as string,
        });
      }
    }),
  );

  // Comms message → notify target agent
  unsubscribers.push(
    subscribe("comms.message", (event: EventEnvelope) => {
      const payload = event.payload as Record<string, unknown>;
      const toAgentId = payload.to_agent_id as string | null;
      if (toAgentId) {
        sendToAgent(toAgentId, "notifications/valor/message", {
          message_id: event.id,
          from_agent_id: payload.from_agent_id as string,
          subject: payload.subject as string,
          priority: payload.priority as string,
        });
      }
    }),
  );

  // Mission approval resolved → notify requesting agent
  unsubscribers.push(
    subscribe("mission.approval.resolved", (event: EventEnvelope) => {
      const payload = event.payload as Record<string, unknown>;
      const agentId = payload.requested_by as string;
      if (agentId) {
        sendToAgent(agentId, "notifications/valor/gate_decision", {
          mission_id: payload.mission_id as string,
          decision: payload.decision as string,
          reason: payload.reason as string | undefined,
        });
      }
    }),
  );

  logger.info("MCP notification bridge started");
}

export function stopNotificationBridge(): void {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers.length = 0;
  sender = null;
}
