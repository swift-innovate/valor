/**
 * VALOR Director Service
 *
 * Persistent process that:
 * 1. Connects to NATS
 * 2. Ensures JetStream streams exist
 * 3. Subscribes to valor.missions.inbound for raw mission text
 * 4. Runs the Director pipeline: safety gates → classify → dispatch
 * 5. Publishes routed missions and sitreps to NATS
 *
 * Usage: OLLAMA_BASE_URL=http://starbase:40114 npx tsx scripts/director-service.ts
 */

import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
  publishSitrep,
} from "../src/nats/index.js";
import type { VALORMessage } from "../src/nats/index.js";
import { handleMission } from "../src/director/index.js";
import { logger } from "../src/utils/logger.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";

let missionCounter = 0;
let isShuttingDown = false;

function nextMissionId(): string {
  return `VM-${String(++missionCounter).padStart(3, "0")}`;
}

async function main(): Promise<void> {
  logger.info("Director service starting", { nats: NATS_URL });

  const nc = await getNatsConnection({
    servers: [NATS_URL],
    name: "valor-director",
  });

  await ensureStreams(nc);
  logger.info("JetStream streams ensured");

  // Subscribe to inbound missions (ephemeral — gateway publishes here)
  const sub = nc.subscribe("valor.missions.inbound", {
    callback: async (_err, msg) => {
      if (_err) {
        logger.error("Inbound subscription error", { error: _err.message });
        return;
      }

      try {
        const text = new TextDecoder().decode(msg.data);
        const envelope = JSON.parse(text) as VALORMessage<{ text: string }>;
        const missionText = envelope.payload?.text ?? text;
        const missionId = nextMissionId();

        logger.info("Inbound mission received", {
          id: missionId,
          source: envelope.source,
          text_length: missionText.length,
        });

        const result = await handleMission(nc, missionText, missionId);

        logger.info("Mission processed", {
          id: missionId,
          gate_intercepted: result.classifier.gateIntercepted,
          decision: result.classifier.directorOutput?.decision ?? "GATE_BLOCKED",
          dispatched: result.dispatch.dispatched,
          escalated: result.dispatch.escalated,
          mission_ids: result.dispatch.missionIds,
        });

        // If there's an escalation message, log it (Telegram gateway will pick up sitrep)
        if (result.dispatch.escalationMessage) {
          logger.warn("Escalation alert", {
            message: result.dispatch.escalationMessage.slice(0, 200),
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error("Mission processing failed", { error: errorMsg });

        // Publish FAILED sitrep so the gateway (and user) sees the error
        try {
          await publishSitrep(nc, "director" as any, {
            mission_id: missionId,
            operative: "director",
            status: "FAILED",
            progress_pct: 0,
            summary: `Director pipeline failed: ${errorMsg}`,
            artifacts: [],
            blockers: [errorMsg],
            next_steps: ["Retry mission", "Check Ollama health"],
            tokens_used: null,
            timestamp: new Date().toISOString(),
          });
        } catch (pubErr) {
          logger.error("Failed to publish error sitrep", {
            error: pubErr instanceof Error ? pubErr.message : String(pubErr),
          });
        }
      }
    },
  });

  logger.info("Director service ready", {
    listening: "valor.missions.inbound",
    ollama: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.DIRECTOR_MODEL ?? "gemma3:27b",
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("Director shutting down", { signal });
    sub.unsubscribe();
    await closeNatsConnection();
    logger.info("Director shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Director fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
