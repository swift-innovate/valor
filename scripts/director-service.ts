/**
 * VALOR Director Service
 *
 * Persistent process that:
 * 1. Connects to NATS
 * 2. Ensures JetStream streams exist
 * 3. Verifies Ollama connectivity (startup health check)
 * 4. Subscribes to valor.missions.inbound for raw mission text
 * 5. Runs the Director pipeline: safety gates → classify → dispatch
 * 6. Publishes routed missions and sitreps to NATS
 *
 * Includes timeout handling, error recovery, and status feedback.
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
import { config } from "../src/config.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const OLLAMA_BASE_URL = config.ollamaBaseUrl ?? "http://starbase:40114";

let missionCounter = 0;
let isShuttingDown = false;

function nextMissionId(): string {
  return `VM-${String(++missionCounter).padStart(3, "0")}`;
}

/**
 * Ping Ollama to verify it's reachable and the Director model loads.
 * Returns true if healthy, false otherwise.
 */
async function checkOllamaHealth(): Promise<boolean> {
  try {
    logger.info("Checking Ollama connectivity", { url: OLLAMA_BASE_URL });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger.error("Ollama health check failed — HTTP error", {
        status: res.status,
      });
      return false;
    }

    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];
    const hasDirectorModel = models.some((m) => m.name.startsWith(config.directorModel));

    if (!hasDirectorModel) {
      logger.warn("Director model not found on Ollama", {
        model: config.directorModel,
        available: models.map((m) => m.name),
      });
      return false;
    }

    logger.info("Ollama health check passed", {
      model: config.directorModel,
      models_count: models.length,
    });

    return true;
  } catch (error) {
    logger.error("Ollama health check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Retry Ollama health check every 60s until it passes.
 */
async function waitForOllama(): Promise<void> {
  while (!isShuttingDown) {
    const healthy = await checkOllamaHealth();
    if (healthy) return;

    logger.warn("Ollama not ready — will retry in 60s");
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function main(): Promise<void> {
  logger.info("Director service starting", { nats: NATS_URL, ollama: OLLAMA_BASE_URL });

  const nc = await getNatsConnection({
    servers: [NATS_URL],
    name: "valor-director",
  });

  await ensureStreams(nc);
  logger.info("JetStream streams ensured");

  // Startup health check — wait for Ollama to be ready
  const ollamaHealthy = await checkOllamaHealth();
  if (!ollamaHealthy) {
    logger.warn("Ollama not ready at startup — will retry in background");
    // Don't block service startup, but warn Principal
    try {
      await publishSitrep(nc, "director", {
        mission_id: "STARTUP",
        status: "BLOCKED",
        summary: `⚠️ Director started but Ollama is not ready at ${OLLAMA_BASE_URL}. Missions will fail until Ollama is reachable.`,
      });
    } catch {
      // Ignore if Telegram isn't listening yet
    }

    // Retry in background
    waitForOllama().then(() => {
      logger.info("Ollama is now ready");
      publishSitrep(nc, "director", {
        mission_id: "STARTUP",
        status: "COMPLETE",
        summary: "✅ Director LLM connection restored. Ready to accept missions.",
      }).catch(() => {
        // Ignore
      });
    });
  }

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
        logger.error("Mission processing failed", {
          error: err instanceof Error ? err.message : String(err),
        });

        // Send error sitrep to Telegram
        try {
          await publishSitrep(nc, "director", {
            mission_id: "ERROR",
            status: "FAILED",
            summary: `❌ Director pipeline error: ${err instanceof Error ? err.message : String(err)}`,
          });
        } catch {
          // Ignore if sitrep fails
        }
      }
    },
  });

  logger.info("Director service ready", {
    listening: "valor.missions.inbound",
    ollama: OLLAMA_BASE_URL,
    model: config.directorModel,
    gear2_model: config.directorGear2Model,
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
