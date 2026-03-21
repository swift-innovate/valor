/**
 * VALOR Telegram Gateway
 * 
 * Bridges Telegram <-> NATS for mission dispatch and status updates.
 * 
 * Mission: VM-014
 * Operative: Mira
 * Status: IN PROGRESS (blocked on VM-002 NATS client module)
 * 
 * Dependencies:
 * - VM-002: NATS TypeScript client module (src/nats/)
 * - NATS server running with JetStream enabled
 * - Telegram bot token
 */

import type {
  VALORMessage,
  RawMissionInbound,
  Sitrep,
  SystemEvent,
  SystemStatusResponse,
  CommsMessage,
} from "../../src/types/nats.js";

// TODO: Import from src/nats/ when VM-002 is complete
// import { NATSClient } from "../../src/nats/client.js";

interface TelegramGatewayConfig {
  telegramBotToken: string;
  natsUrl: string;
  principalTelegramId: string; // Tom's Telegram user ID
}

/**
 * Telegram Gateway
 * 
 * Responsibilities:
 * 1. Listen for Telegram commands (/mission, /status, /ask, free text)
 * 2. Publish commands to appropriate NATS subjects
 * 3. Subscribe to NATS subjects for updates
 * 4. Format and relay NATS messages back to Telegram
 */
export class TelegramGateway {
  private config: TelegramGatewayConfig;
  // private nats: NATSClient; // TODO: Initialize when VM-002 is available
  private bot: any; // TODO: Type from node-telegram-bot-api

  constructor(config: TelegramGatewayConfig) {
    this.config = config;
  }

  /**
   * Initialize the gateway
   * - Connect to NATS
   * - Initialize Telegram bot
   * - Set up subscriptions
   * - Start listening
   */
  async start(): Promise<void> {
    console.log("[TelegramGateway] Starting...");

    // TODO: Connect to NATS
    // this.nats = new NATSClient(this.config.natsUrl);
    // await this.nats.connect();

    // TODO: Initialize Telegram bot
    // this.bot = new TelegramBot(this.config.telegramBotToken, { polling: true });

    // Set up NATS subscriptions
    await this.subscribeToNATS();

    // Set up Telegram command handlers
    this.setupTelegramHandlers();

    console.log("[TelegramGateway] Started and listening");
  }

  /**
   * Subscribe to NATS subjects for updates to relay to Telegram
   */
  private async subscribeToNATS(): Promise<void> {
    // TODO: Subscribe to valor.sitreps.> (all sitreps)
    // this.nats.subscribe("valor.sitreps.>", (msg) => this.handleSitrep(msg));

    // TODO: Subscribe to valor.system.events (agent online/offline)
    // this.nats.subscribe("valor.system.events", (msg) => this.handleSystemEvent(msg));

    console.log("[TelegramGateway] NATS subscriptions ready (placeholder)");
  }

  /**
   * Set up Telegram bot command handlers
   */
  private setupTelegramHandlers(): void {
    // TODO: Implement with actual Telegram bot library

    // /mission <text> - Dispatch new mission
    // this.bot.onText(/^\/mission (.+)/, (msg, match) => {
    //   if (msg.from?.id.toString() === this.config.principalTelegramId) {
    //     this.handleMissionCommand(msg, match[1]);
    //   }
    // });

    // /status - Get fleet status
    // this.bot.onText(/^\/status$/, (msg) => {
    //   if (msg.from?.id.toString() === this.config.principalTelegramId) {
    //     this.handleStatusCommand(msg);
    //   }
    // });

    // /ask <question> - Conversational query to Mira
    // this.bot.onText(/^\/ask (.+)/, (msg, match) => {
    //   if (msg.from?.id.toString() === this.config.principalTelegramId) {
    //     this.handleAskCommand(msg, match[1]);
    //   }
    // });

    // Free text (no command) - Route to Mira for conversation
    // this.bot.on("message", (msg) => {
    //   if (msg.text && !msg.text.startsWith("/") && msg.from?.id.toString() === this.config.principalTelegramId) {
    //     this.handleFreeText(msg);
    //   }
    // });

    console.log("[TelegramGateway] Telegram handlers ready (placeholder)");
  }

  /**
   * Handle /mission command
   * Publish raw mission text to valor.missions.inbound for Director classification
   */
  private async handleMissionCommand(msg: any, missionText: string): Promise<void> {
    const message: VALORMessage<RawMissionInbound> = {
      id: this.generateUUID(),
      timestamp: new Date().toISOString(),
      source: "telegram-gateway",
      type: "mission.inbound",
      payload: {
        text: missionText,
        source_channel: "telegram",
        principal_id: msg.from.id.toString(),
        context: {
          chat_id: msg.chat.id.toString(),
          message_id: msg.message_id.toString(),
        },
      },
    };

    // TODO: Publish to NATS
    // await this.nats.publish("valor.missions.inbound", message);

    // Acknowledge to Telegram
    // await this.bot.sendMessage(msg.chat.id, "✅ Mission received. Director is classifying...");

    console.log("[TelegramGateway] /mission command (placeholder):", missionText);
  }

  /**
   * Handle /status command
   * Request fleet status from valor.system.status, format and reply to Telegram
   */
  private async handleStatusCommand(msg: any): Promise<void> {
    // TODO: Publish request to valor.system.status
    // const statusRequest: VALORMessage<{ requestId: string }> = {
    //   id: this.generateUUID(),
    //   timestamp: new Date().toISOString(),
    //   source: "telegram-gateway",
    //   type: "system.status.request",
    //   payload: { requestId: requestId },
    // };
    // await this.nats.publish("valor.system.status", statusRequest);

    // TODO: Await reply with timeout
    // const reply = await this.nats.request("valor.system.status", statusRequest, { timeout: 5000 });
    // const formatted = this.formatStatusResponse(reply);
    // await this.bot.sendMessage(msg.chat.id, formatted);

    console.log("[TelegramGateway] /status command (placeholder)");
  }

  /**
   * Handle /ask command
   * Route question to Mira via valor.comms.direct.principal.mira
   */
  private async handleAskCommand(msg: any, question: string): Promise<void> {
    const message: VALORMessage<CommsMessage> = {
      id: this.generateUUID(),
      timestamp: new Date().toISOString(),
      source: "principal",
      type: "comms.message",
      payload: {
        from: "principal",
        to: "mira",
        text: question,
        priority: "normal",
        category: "query",
      },
    };

    // TODO: Publish to valor.comms.direct.principal.mira
    // await this.nats.publish("valor.comms.direct.principal.mira", message);

    // TODO: Subscribe to response from Mira (valor.comms.direct.mira.principal)
    // and forward to Telegram

    console.log("[TelegramGateway] /ask command (placeholder):", question);
  }

  /**
   * Handle free text (no command)
   * Route to Mira for conversational response
   */
  private async handleFreeText(msg: any): Promise<void> {
    // Same as /ask but without explicit command
    const message: VALORMessage<CommsMessage> = {
      id: this.generateUUID(),
      timestamp: new Date().toISOString(),
      source: "principal",
      type: "comms.message",
      payload: {
        from: "principal",
        to: "mira",
        text: msg.text,
        priority: "normal",
        category: "chat",
      },
    };

    // TODO: Publish to valor.comms.direct.principal.mira
    // await this.nats.publish("valor.comms.direct.principal.mira", message);

    console.log("[TelegramGateway] Free text (placeholder):", msg.text);
  }

  /**
   * Handle incoming sitrep from NATS
   * Format and send to Telegram
   */
  private async handleSitrep(message: VALORMessage<Sitrep>): Promise<void> {
    const sitrep = message.payload;
    const formatted = this.formatSitrep(sitrep);

    // TODO: Send to Telegram
    // await this.bot.sendMessage(this.config.principalTelegramId, formatted);

    console.log("[TelegramGateway] Sitrep received (placeholder):", sitrep.mission_id);
  }

  /**
   * Handle system event from NATS
   * Format and send to Telegram
   */
  private async handleSystemEvent(message: VALORMessage<SystemEvent>): Promise<void> {
    const event = message.payload;
    const formatted = this.formatSystemEvent(event);

    // TODO: Send to Telegram
    // await this.bot.sendMessage(this.config.principalTelegramId, formatted);

    console.log("[TelegramGateway] System event (placeholder):", event.event_type);
  }

  /**
   * Format sitrep for Telegram display
   */
  private formatSitrep(sitrep: Sitrep): string {
    const statusEmoji = {
      ACCEPTED: "📋",
      IN_PROGRESS: "🔄",
      BLOCKED: "⚠️",
      COMPLETE: "✅",
      FAILED: "❌",
    }[sitrep.status] || "📊";

    let message = `${statusEmoji} **${sitrep.mission_id}** — ${sitrep.status}\n`;
    message += `\n${sitrep.summary}`;

    if (sitrep.progress_pct !== undefined && sitrep.progress_pct !== null) {
      message += `\n\nProgress: ${sitrep.progress_pct}%`;
    }

    if (sitrep.blockers && sitrep.blockers.length > 0) {
      message += `\n\n⚠️ Blockers:\n${sitrep.blockers.map((b) => `  • ${b}`).join("\n")}`;
    }

    if (sitrep.artifacts && sitrep.artifacts.length > 0) {
      message += `\n\n📎 Artifacts:\n${sitrep.artifacts.map((a) => `  • ${a}`).join("\n")}`;
    }

    return message;
  }

  /**
   * Format system event for Telegram display
   */
  private formatSystemEvent(event: SystemEvent): string {
    const eventEmoji = {
      "agent.online": "🟢",
      "agent.offline": "🔴",
      "agent.error": "❌",
      "system.startup": "🚀",
      "system.shutdown": "🛑",
    }[event.event_type] || "📡";

    return `${eventEmoji} ${event.event_type}: ${event.details.agent || "system"}`;
  }

  /**
   * Format status response for Telegram display
   */
  private formatStatusResponse(response: VALORMessage<SystemStatusResponse>): string {
    const status = response.payload;
    let message = "**VALOR Fleet Status**\n\n";

    for (const [operative, info] of Object.entries(status.operatives)) {
      const statusEmoji = info.status === "online" ? "🟢" : "🔴";
      message += `${statusEmoji} **${operative}**: ${info.status}`;
      if (info.current_mission) {
        message += ` (working on ${info.current_mission})`;
      }
      message += "\n";
    }

    return message;
  }

  /**
   * Generate UUID v4
   */
  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Graceful shutdown
   */
  async stop(): Promise<void> {
    console.log("[TelegramGateway] Stopping...");

    // TODO: Close NATS connection
    // await this.nats.close();

    // TODO: Stop Telegram bot polling
    // await this.bot.stopPolling();

    console.log("[TelegramGateway] Stopped");
  }
}

/**
 * Main entry point (for standalone execution)
 */
async function main() {
  const config: TelegramGatewayConfig = {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    natsUrl: process.env.NATS_URL || "nats://localhost:4222",
    principalTelegramId: process.env.PRINCIPAL_TELEGRAM_ID || "",
  };

  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  if (!config.principalTelegramId) {
    throw new Error("PRINCIPAL_TELEGRAM_ID environment variable is required");
  }

  const gateway = new TelegramGateway(config);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await gateway.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await gateway.stop();
    process.exit(0);
  });

  await gateway.start();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[TelegramGateway] Fatal error:", error);
    process.exit(1);
  });
}
