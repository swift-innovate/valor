import { Bot } from "grammy";
import { logger } from "../utils/logger.js";
import {
  handleStatus,
  handleMissions,
  handleApprove,
  handleReject,
  handleDispatch,
  handleAgents,
  handleSitrep,
} from "./commands.js";
import { startNotifications, stopNotifications } from "./notifications.js";

let bot: Bot | null = null;
let chatId: string | null = null;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chat) {
    return null;
  }

  return { botToken: token, chatId: chat };
}

export function startTelegramBot(): void {
  const cfg = getTelegramConfig();

  if (!cfg) {
    logger.warn(
      "Telegram bot not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable",
    );
    return;
  }

  bot = new Bot(cfg.botToken);
  chatId = cfg.chatId;

  // Authorize only the configured chat
  bot.use(async (ctx, next) => {
    const msgChatId = ctx.chat?.id?.toString();
    if (msgChatId !== chatId) {
      logger.warn("Telegram: unauthorized chat attempted access", {
        chat_id: msgChatId,
        expected: chatId,
      });
      return; // Silently ignore unauthorized chats
    }
    await next();
  });

  // Register command handlers
  bot.command("status", handleStatus);
  bot.command("missions", handleMissions);
  bot.command("approve", handleApprove);
  bot.command("reject", handleReject);
  bot.command("dispatch", handleDispatch);
  bot.command("agents", handleAgents);
  bot.command("sitrep", handleSitrep);

  // Start event bus notifications
  startNotifications(bot, cfg.chatId);

  // Start polling — catch errors to prevent crash
  bot.start({
    onStart: () => {
      logger.info("Telegram bot started", { chat_id: cfg.chatId });
    },
  });

  bot.catch((err) => {
    logger.error("Telegram bot error", {
      error: err.message,
    });
  });
}

export function stopTelegramBot(): void {
  stopNotifications();

  if (bot) {
    bot.stop();
    bot = null;
    chatId = null;
    logger.info("Telegram bot stopped");
  }
}

/** Expose bot instance for testing / direct message sending */
export function getBotInstance(): Bot | null {
  return bot;
}

export function getChatId(): string | null {
  return chatId;
}
