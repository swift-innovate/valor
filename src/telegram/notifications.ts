import { type Bot } from "grammy";
import { subscribe } from "../bus/index.js";
import { getMission } from "../db/repositories/index.js";
import { logger } from "../utils/logger.js";
import type { EventEnvelope } from "../types/index.js";
import type { Approval } from "../db/repositories/approval-repo.js";
import {
  formatMissionComplete,
  formatMissionFailed,
  formatMissionDispatched,
  formatApprovalRequest,
  escapeMarkdown,
} from "./formatter.js";

/** Notification events that warrant pushing to the Director */
const NOTIFICATION_EVENTS = [
  "mission.status.changed",
  "gate.approval_requested",
  "mission.created",
] as const;

/** Non-urgent events get batched. Urgent ones send immediately. */
const URGENT_STATUSES = new Set(["failed", "aborted", "timed_out", "gated"]);

interface QueuedNotification {
  message: string;
  timestamp: number;
}

const BATCH_INTERVAL_MS = 30_000; // 30 seconds
const MAX_BATCH_SIZE = 5;

let notificationQueue: QueuedNotification[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribers: (() => void)[] = [];

export function startNotifications(bot: Bot, chatId: string): void {
  // Subscribe to mission status changes
  const unsub1 = subscribe("mission.status.changed", (event) => {
    handleMissionStatusChange(bot, chatId, event);
  });

  // Subscribe to gate approval requests
  const unsub2 = subscribe("gate.approval_requested", (event) => {
    handleApprovalRequested(bot, chatId, event);
  });

  unsubscribers = [unsub1, unsub2];

  // Start batch flush timer
  batchTimer = setInterval(() => {
    flushNotificationQueue(bot, chatId);
  }, BATCH_INTERVAL_MS);

  logger.info("Telegram notifications started", { chat_id: chatId });
}

export function stopNotifications(): void {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];

  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }

  notificationQueue = [];
  logger.info("Telegram notifications stopped");
}

function handleMissionStatusChange(
  bot: Bot,
  chatId: string,
  event: EventEnvelope,
): void {
  try {
    const missionId = event.payload.mission_id as string | undefined;
    const newStatus = event.payload.new_status as string | undefined;

    if (!missionId || !newStatus) return;

    // Skip events sent via telegram to avoid echo
    if (event.metadata?.via === "telegram") return;

    const mission = getMission(missionId);
    if (!mission) return;

    let message: string;

    switch (newStatus) {
      case "complete":
      case "aar_complete":
        message = formatMissionComplete(mission);
        break;
      case "failed":
        message = formatMissionFailed(
          mission,
          event.payload.reason as string | undefined,
        );
        break;
      case "dispatched":
        message = formatMissionDispatched(mission);
        break;
      case "aborted":
        message = `\u{1F6D1} *Mission Aborted*\n\n\`${escapeMarkdown(mission.id)}\`\n${escapeMarkdown(mission.title)}`;
        break;
      case "timed_out":
        message = `\u{23F0} *Mission Timed Out*\n\n\`${escapeMarkdown(mission.id)}\`\n${escapeMarkdown(mission.title)}`;
        break;
      case "gated":
        message = `\u{1F6A7} *Mission Gated*\n\n\`${escapeMarkdown(mission.id)}\`\n${escapeMarkdown(mission.title)}\nAwaiting approval\\.`;
        break;
      default:
        // Non-notable status changes — skip
        return;
    }

    if (URGENT_STATUSES.has(newStatus)) {
      sendNotification(bot, chatId, message);
    } else {
      queueNotification(message);
    }
  } catch (err) {
    logger.error("Telegram notification handler error", {
      error: err instanceof Error ? err.message : String(err),
      event_type: event.type,
    });
  }
}

function handleApprovalRequested(
  bot: Bot,
  chatId: string,
  event: EventEnvelope,
): void {
  try {
    const missionId = event.payload.mission_id as string | undefined;
    const approval = event.payload.approval as Approval | undefined;

    if (!missionId) return;

    const mission = getMission(missionId);

    if (approval) {
      const message = formatApprovalRequest(approval, mission);
      // Approvals are always urgent
      sendNotification(bot, chatId, message);
    }
  } catch (err) {
    logger.error("Telegram approval notification error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function queueNotification(message: string): void {
  notificationQueue.push({ message, timestamp: Date.now() });
}

function sendNotification(bot: Bot, chatId: string, message: string): void {
  bot.api.sendMessage(chatId, message, { parse_mode: "MarkdownV2" }).catch((err) => {
    logger.error("Telegram send failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function flushNotificationQueue(bot: Bot, chatId: string): void {
  if (notificationQueue.length === 0) return;

  const batch = notificationQueue.splice(0, MAX_BATCH_SIZE);
  const combined = batch.map((n) => n.message).join("\n\n\u{2500}\u{2500}\u{2500}\n\n");

  sendNotification(bot, chatId, combined);

  // If there are still queued items, they'll be flushed next interval
  if (notificationQueue.length > 0) {
    logger.debug("Telegram notification queue has remaining items", {
      remaining: notificationQueue.length,
    });
  }
}

/** Expose for testing */
export function _getQueueLength(): number {
  return notificationQueue.length;
}

export function _flushForTest(bot: Bot, chatId: string): void {
  flushNotificationQueue(bot, chatId);
}
