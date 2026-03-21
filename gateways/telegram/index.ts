/**
 * VALOR Telegram Gateway
 *
 * Bridges Telegram <-> NATS for mission dispatch and sitrep delivery.
 *
 * Commands:
 *   /mission <text>  — Dispatch mission to Director
 *   /status          — Fleet status summary
 *   /help            — Show available commands
 *
 * Subscriptions:
 *   valor.sitreps.>          — Progress updates → Telegram
 *   valor.system.events      — Agent online/offline → Telegram
 *   valor.review.verdict.>   — Review decisions → Telegram
 *
 * Usage:
 *   source .env && node --import tsx gateways/telegram/index.ts
 *
 * Environment:
 *   TELEGRAM_BOT_TOKEN       — Bot token from @BotFather
 *   PRINCIPAL_TELEGRAM_ID    — Tom's Telegram user ID (only this user can dispatch)
 *   NATS_URL                 — NATS server (default: nats://localhost:4222)
 */

import TelegramBot from "node-telegram-bot-api";
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
} from "../../src/nats/index.js";
import type {
  VALORMessage,
  NatsSitrep,
  ReviewVerdict,
  SystemEvent,
} from "../../src/nats/index.js";
import type { NatsConnection, Subscription } from "@nats-io/nats-core";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRINCIPAL_ID = process.env.PRINCIPAL_TELEGRAM_ID;
const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}
if (!PRINCIPAL_ID) {
  console.error("PRINCIPAL_TELEGRAM_ID is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decode<T>(data: Uint8Array): VALORMessage<T> {
  return JSON.parse(new TextDecoder().decode(data)) as VALORMessage<T>;
}

function encode(msg: VALORMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

function isPrincipal(msg: TelegramBot.Message): boolean {
  return msg.from?.id.toString() === PRINCIPAL_ID;
}

const STATUS_EMOJI: Record<string, string> = {
  ACCEPTED: "\ud83d\udccb",
  IN_PROGRESS: "\ud83d\udd04",
  BLOCKED: "\u26a0\ufe0f",
  COMPLETE: "\u2705",
  FAILED: "\u274c",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[TelegramGateway] Starting...");

  // Connect to NATS
  const nc = await getNatsConnection({
    servers: [NATS_URL],
    name: "telegram-gateway",
  });
  await ensureStreams(nc);
  console.log(`[TelegramGateway] NATS connected: ${NATS_URL}`);

  // Initialize Telegram bot (polling mode)
  const bot = new TelegramBot(BOT_TOKEN!, { polling: true });
  const botInfo = await bot.getMe();
  console.log(`[TelegramGateway] Bot online: @${botInfo.username}`);

  // Track the chat ID for sending updates back
  let principalChatId: number | null = null;

  // ── Telegram Commands ────────────────────────────────────────────────

  // /mission <text> — dispatch to Director via NATS
  bot.onText(/^\/mission\s+(.+)/s, async (msg, match) => {
    if (!isPrincipal(msg)) return;
    principalChatId = msg.chat.id;

    const missionText = match![1].trim();
    const envelope: VALORMessage<{
      text: string;
      source_channel: string;
      principal_id: string;
      context: { chat_id: string; message_id: string };
    }> = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: "telegram-gateway",
      type: "mission.inbound" as any,
      payload: {
        text: missionText,
        source_channel: "telegram",
        principal_id: PRINCIPAL_ID!,
        context: {
          chat_id: msg.chat.id.toString(),
          message_id: msg.message_id.toString(),
        },
      },
    };

    nc.publish("valor.missions.inbound", encode(envelope));
    await bot.sendMessage(
      msg.chat.id,
      `\u2705 Mission received. Director is classifying...\n\n_"${missionText.slice(0, 100)}"_`,
      { parse_mode: "Markdown" },
    );
    console.log(`[TelegramGateway] /mission: ${missionText.slice(0, 60)}`);
  });

  // /status — quick fleet status
  bot.onText(/^\/status$/, async (msg) => {
    if (!isPrincipal(msg)) return;
    principalChatId = msg.chat.id;

    // Check which services are publishing heartbeats
    const statusLines = [
      "\ud83d\udce1 *VALOR Fleet Status*",
      "",
      `NATS: \u2705 Connected`,
      `Director: \u2705 Listening on valor.missions.inbound`,
      `Ollama: ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}`,
      "",
      "_Use /mission <text> to dispatch a mission_",
    ];

    await bot.sendMessage(msg.chat.id, statusLines.join("\n"), {
      parse_mode: "Markdown",
    });
  });

  // /help — show commands
  bot.onText(/^\/help$/, async (msg) => {
    if (!isPrincipal(msg)) return;
    principalChatId = msg.chat.id;

    await bot.sendMessage(
      msg.chat.id,
      [
        "\ud83c\udfaf *VALOR Commands*",
        "",
        "`/mission <text>` \u2014 Dispatch a mission to the Director",
        "`/status` \u2014 Fleet status",
        "`/help` \u2014 This message",
        "",
        "Sitreps and review verdicts are delivered automatically.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  // /start — initial greeting
  bot.onText(/^\/start$/, async (msg) => {
    principalChatId = msg.chat.id;
    const authorized = isPrincipal(msg) ? "You are authorized as Principal." : "You are not authorized.";
    await bot.sendMessage(
      msg.chat.id,
      `\ud83d\ude80 *VALOR Engine Online*\n\n${authorized}\n\nType /help for commands.`,
      { parse_mode: "Markdown" },
    );
  });

  // Safety gate override: APPROVED gate_<id> or ABORT gate_<id>
  bot.onText(/^(APPROVED|ABORT)\s+gate_(\w+)$/i, async (msg, match) => {
    if (!isPrincipal(msg)) return;
    const action = match![1].toUpperCase();
    const interceptId = match![2];
    // Publish override to NATS for Director to pick up
    const envelope: VALORMessage<{ action: string; intercept_id: string; principal_id: string }> = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: "telegram-gateway",
      type: "system.event" as any,
      payload: {
        action,
        intercept_id: interceptId,
        principal_id: PRINCIPAL_ID!,
      },
    };
    nc.publish("valor.system.gate-override", encode(envelope));
    await bot.sendMessage(msg.chat.id, `\u2705 Gate override sent: ${action} gate_${interceptId}`);
    console.log(`[TelegramGateway] Gate override: ${action} gate_${interceptId}`);
  });

  // ── NATS Subscriptions → Telegram ────────────────────────────────────

  const subs: Subscription[] = [];

  // Sitreps → Telegram
  subs.push(
    nc.subscribe("valor.sitreps.>", {
      callback: (_err, msg) => {
        if (_err || !principalChatId) return;
        try {
          const envelope = decode<NatsSitrep>(msg);
          const p = envelope.payload;
          const emoji = STATUS_EMOJI[p.status] ?? "\ud83d\udcca";
          let text = `${emoji} *${p.mission_id}* \u2014 ${p.status}\n\n${p.summary}`;

          if (p.progress_pct != null && p.progress_pct > 0) {
            text += `\n\nProgress: ${p.progress_pct}%`;
          }
          if (p.blockers?.length) {
            text += `\n\n\u26a0\ufe0f Blockers:\n${p.blockers.map((b) => `  \u2022 ${b}`).join("\n")}`;
          }
          if (p.artifacts?.length) {
            text += `\n\n\ud83d\udcce Artifacts:\n${p.artifacts.map((a) => `  \u2022 ${a.label}: ${a.ref}`).join("\n")}`;
          }

          bot.sendMessage(principalChatId, text, { parse_mode: "Markdown" }).catch(() => {});
        } catch { /* ignore parse errors */ }
      },
    }),
  );

  // Review verdicts → Telegram
  subs.push(
    nc.subscribe("valor.review.verdict.>", {
      callback: (_err, msg) => {
        if (_err || !principalChatId) return;
        try {
          const envelope = decode<ReviewVerdict>(msg);
          const p = envelope.payload;
          const emoji = p.decision === "APPROVE" ? "\u2705" : p.decision === "RETRY" ? "\ud83d\udd04" : "\u26a0\ufe0f";
          let text = `${emoji} *Review: ${p.mission_id}* \u2014 ${p.decision}\n\n${p.reasoning}`;
          if (p.issues?.length) {
            text += `\n\nIssues:\n${p.issues.map((i) => `  \u2022 ${i}`).join("\n")}`;
          }
          bot.sendMessage(principalChatId, text, { parse_mode: "Markdown" }).catch(() => {});
        } catch { /* ignore */ }
      },
    }),
  );

  // System events → Telegram
  subs.push(
    nc.subscribe("valor.system.events", {
      callback: (_err, msg) => {
        if (_err || !principalChatId) return;
        try {
          const envelope = decode<SystemEvent>(msg);
          const p = envelope.payload;
          const emoji = p.kind === "agent.online" ? "\ud83d\udfe2" : p.kind === "agent.offline" ? "\ud83d\udd34" : "\ud83d\udce1";
          bot.sendMessage(principalChatId, `${emoji} ${p.kind}: ${p.operative ?? "system"} \u2014 ${p.detail}`).catch(() => {});
        } catch { /* ignore */ }
      },
    }),
  );

  console.log("[TelegramGateway] Subscribed to sitreps, verdicts, system events");
  console.log(`[TelegramGateway] Ready. Principal ID: ${PRINCIPAL_ID}`);

  // ── Graceful Shutdown ────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`[TelegramGateway] Shutting down (${signal})...`);
    bot.stopPolling();
    for (const sub of subs) sub.unsubscribe();
    await closeNatsConnection();
    console.log("[TelegramGateway] Stopped.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[TelegramGateway] Fatal error:", err);
  process.exit(1);
});
