/**
 * VALOR Director Service Daemon
 *
 * Long-running service process that:
 * 1. Connects to NATS and subscribes to `director.classify`
 * 2. Runs the Director pipeline: safety gates -> LLM classify -> dispatch
 * 3. Publishes results back to NATS (routed missions, escalations)
 * 4. Exposes HTTP health + metrics endpoint
 * 5. Handles graceful startup/shutdown and NATS reconnection
 *
 * Usage:
 *   NATS_URL=nats://localhost:4222 npx tsx src/director/service.ts
 *   DIRECTOR_SERVICE_PORT=3201 npx tsx src/director/service.ts
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { NatsConnection, Subscription } from "@nats-io/nats-core";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
  publishSitrep,
  healthCheck as natsHealthCheck,
} from "../nats/index.js";
import type { VALORMessage } from "../nats/index.js";
import { handleMission } from "./index.js";
import { getMetrics, recordClassification, resetMetrics } from "./metrics.js";
import type { DirectorMetrics } from "./metrics.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DirectorServiceConfig {
  /** HTTP health/metrics port. Default: 3201. */
  port: number;
  /** NATS server URL. */
  natsUrl: string;
  /** NATS subject to subscribe to. */
  classifySubject: string;
  /** Ollama base URL for health checks. */
  ollamaBaseUrl: string;
}

function loadServiceConfig(): DirectorServiceConfig {
  return {
    port: parseInt(process.env.DIRECTOR_SERVICE_PORT ?? "3201", 10),
    natsUrl: process.env.NATS_URL ?? config.natsUrl,
    classifySubject: process.env.DIRECTOR_CLASSIFY_SUBJECT ?? "director.classify",
    ollamaBaseUrl: config.ollamaBaseUrl ?? "http://starbase:40114",
  };
}

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

export interface DirectorServiceState {
  status: "starting" | "ready" | "degraded" | "shutting_down" | "stopped";
  natsConnected: boolean;
  ollamaHealthy: boolean;
  startedAt: string;
  config: DirectorServiceConfig;
}

let _state: DirectorServiceState = {
  status: "stopped",
  natsConnected: false,
  ollamaHealthy: false,
  startedAt: new Date().toISOString(),
  config: loadServiceConfig(),
};

let _nc: NatsConnection | null = null;
let _sub: Subscription | null = null;
let _httpServer: Server | null = null;
let _missionCounter = 0;
let _healthInterval: ReturnType<typeof setInterval> | null = null;
let _isShuttingDown = false;

function nextMissionId(): string {
  return `VM-${String(++_missionCounter).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Ollama health check
// ---------------------------------------------------------------------------

async function checkOllamaHealth(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return false;
    }

    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];
    return models.some((m) => m.name.startsWith(config.directorModel));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// NATS message handler
// ---------------------------------------------------------------------------

async function onClassifyMessage(
  nc: NatsConnection,
  data: Uint8Array,
): Promise<void> {
  const startMs = Date.now();

  let missionText: string;
  let missionId: string;

  try {
    const text = new TextDecoder().decode(data);
    const envelope = JSON.parse(text) as VALORMessage<{ text: string }>;
    missionText = envelope.payload?.text ?? text;
    const isVmId = envelope.id && /^VM-\d+/.test(envelope.id);
    missionId = isVmId ? envelope.id! : nextMissionId();
  } catch {
    // If JSON parse fails, treat raw bytes as mission text
    missionText = new TextDecoder().decode(data);
    missionId = nextMissionId();
  }

  logger.info("Director service received mission", {
    id: missionId,
    text_length: missionText.length,
  });

  try {
    const result = await handleMission(nc, missionText, missionId);
    const durationMs = Date.now() - startMs;

    recordClassification(
      result.classifier.gear,
      result.classifier.gateIntercepted,
      durationMs,
    );

    logger.info("Director service mission processed", {
      id: missionId,
      gate_intercepted: result.classifier.gateIntercepted,
      decision: result.classifier.directorOutput?.decision ?? "GATE_BLOCKED",
      gear: result.classifier.gear,
      dispatched: result.dispatch.dispatched,
      escalated: result.dispatch.escalated,
      duration_ms: durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;

    // Record as a failed classification with whatever gear info we have
    recordClassification(null, false, durationMs);

    logger.error("Director service mission processing failed", {
      id: missionId,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: durationMs,
    });

    // Send error sitrep
    try {
      await publishSitrep(nc, "director", {
        mission_id: missionId,
        operative: "director",
        status: "FAILED",
        progress_pct: 0,
        summary: `Director pipeline error: ${err instanceof Error ? err.message : String(err)}`,
        artifacts: [],
        blockers: [],
        next_steps: ["Check Director service logs"],
        tokens_used: null,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore if sitrep fails
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP health/metrics server
// ---------------------------------------------------------------------------

function handleHealthRequest(_req: IncomingMessage, res: ServerResponse): void {
  const healthy = _state.status === "ready" || _state.status === "degraded";
  const statusCode = healthy ? 200 : 503;

  const body = JSON.stringify({
    status: _state.status,
    nats_connected: _state.natsConnected,
    ollama_healthy: _state.ollamaHealthy,
    started_at: _state.startedAt,
    uptime_ms: Date.now() - new Date(_state.startedAt).getTime(),
  });

  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(body);
}

function handleMetricsRequest(_req: IncomingMessage, res: ServerResponse): void {
  const metrics = getMetrics();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(metrics));
}

function startHttpServer(port: number): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/health" || url === "/healthz") {
      handleHealthRequest(req, res);
    } else if (url === "/metrics") {
      handleMetricsRequest(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });

  server.listen(port, () => {
    logger.info("Director health server listening", { port });
  });

  return server;
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the Director service daemon.
 *
 * Connects to NATS, subscribes to the classify subject,
 * starts the HTTP health server, and begins periodic health checks.
 *
 * Returns the service state for programmatic control.
 */
export async function startDirectorService(
  overrides?: Partial<DirectorServiceConfig>,
): Promise<DirectorServiceState> {
  if (_state.status === "ready" || _state.status === "starting") {
    logger.warn("Director service already running", { status: _state.status });
    return _state;
  }

  const svcConfig = { ...loadServiceConfig(), ...overrides };
  _state = {
    status: "starting",
    natsConnected: false,
    ollamaHealthy: false,
    startedAt: new Date().toISOString(),
    config: svcConfig,
  };
  _isShuttingDown = false;
  _missionCounter = 0;
  resetMetrics();

  logger.info("Director service starting", {
    nats: svcConfig.natsUrl,
    subject: svcConfig.classifySubject,
    port: svcConfig.port,
    ollama: svcConfig.ollamaBaseUrl,
  });

  // Step 1: Connect to NATS
  try {
    _nc = await getNatsConnection({
      servers: [svcConfig.natsUrl],
      name: "valor-director-service",
    });
    _state.natsConnected = true;
  } catch (err) {
    logger.error("Director service failed to connect to NATS", {
      error: err instanceof Error ? err.message : String(err),
    });
    _state.status = "stopped";
    throw err;
  }

  // Step 2: Ensure JetStream streams
  try {
    await ensureStreams(_nc);
    logger.info("JetStream streams ensured");
  } catch (err) {
    logger.warn("Failed to ensure JetStream streams — continuing", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 3: Subscribe to classify subject
  _sub = _nc.subscribe(svcConfig.classifySubject, {
    callback: (_err, msg) => {
      if (_err) {
        logger.error("NATS subscription error", { error: _err.message });
        return;
      }
      if (_isShuttingDown) return;

      // Fire and forget — errors are handled inside onClassifyMessage
      onClassifyMessage(_nc!, msg.data).catch((err) => {
        logger.error("Unhandled error in classify handler", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  });

  // Also subscribe to legacy subject for backward compat
  const legacySub = _nc.subscribe("valor.missions.inbound", {
    callback: (_err, msg) => {
      if (_err) return;
      if (_isShuttingDown) return;
      onClassifyMessage(_nc!, msg.data).catch(() => {});
    },
  });

  logger.info("Director service subscribed", {
    subjects: [svcConfig.classifySubject, "valor.missions.inbound"],
  });

  // Step 4: Check Ollama health
  _state.ollamaHealthy = await checkOllamaHealth(svcConfig.ollamaBaseUrl);
  if (!_state.ollamaHealthy) {
    logger.warn("Ollama not ready at startup — service will operate in degraded mode", {
      url: svcConfig.ollamaBaseUrl,
    });
  }

  // Step 5: Start HTTP health server
  _httpServer = startHttpServer(svcConfig.port);

  // Step 6: Periodic health check (every 60s)
  _healthInterval = setInterval(async () => {
    if (_isShuttingDown) return;

    // Check NATS
    _state.natsConnected = await natsHealthCheck();

    // Check Ollama
    const ollamaOk = await checkOllamaHealth(svcConfig.ollamaBaseUrl);
    const wasHealthy = _state.ollamaHealthy;
    _state.ollamaHealthy = ollamaOk;

    if (!wasHealthy && ollamaOk) {
      logger.info("Ollama connection restored");
    } else if (wasHealthy && !ollamaOk) {
      logger.warn("Ollama health check failed");
    }

    // Update overall status
    if (_state.natsConnected && _state.ollamaHealthy) {
      _state.status = "ready";
    } else if (_state.natsConnected) {
      _state.status = "degraded";
    }
  }, 60_000);

  // Set final status
  _state.status = _state.ollamaHealthy ? "ready" : "degraded";

  logger.info("Director service started", {
    status: _state.status,
    nats: _state.natsConnected,
    ollama: _state.ollamaHealthy,
    model: config.directorModel,
    gear2_model: config.directorGear2Model,
  });

  return _state;
}

/**
 * Stop the Director service gracefully.
 *
 * Unsubscribes from NATS, drains connections, stops the HTTP server,
 * and clears health check intervals.
 */
export async function stopDirectorService(): Promise<void> {
  if (_isShuttingDown) return;
  _isShuttingDown = true;
  _state.status = "shutting_down";

  logger.info("Director service shutting down");

  // Clear health interval
  if (_healthInterval) {
    clearInterval(_healthInterval);
    _healthInterval = null;
  }

  // Unsubscribe from NATS
  if (_sub) {
    _sub.unsubscribe();
    _sub = null;
  }

  // Close HTTP server
  if (_httpServer) {
    await new Promise<void>((resolve) => {
      _httpServer!.close(() => resolve());
    });
    _httpServer = null;
  }

  // Drain NATS
  try {
    await closeNatsConnection();
  } catch (err) {
    logger.warn("Error closing NATS connection", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  _nc = null;
  _state.status = "stopped";
  _state.natsConnected = false;

  logger.info("Director service shutdown complete");
}

/**
 * Get the current service state.
 */
export function getServiceState(): DirectorServiceState {
  return { ..._state };
}

/**
 * Get the HTTP server instance (for testing).
 */
export function getHttpServer(): Server | null {
  return _httpServer;
}

// ---------------------------------------------------------------------------
// Main (when run directly)
// ---------------------------------------------------------------------------

const isMainModule =
  process.argv[1]?.endsWith("service.ts") ||
  process.argv[1]?.endsWith("service.js");

if (isMainModule) {
  const shutdown = async (signal: string) => {
    logger.info("Received signal", { signal });
    await stopDirectorService();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  startDirectorService().catch((err) => {
    logger.error("Director service fatal error", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
