import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { runMigrations, closeDb } from "./db/index.js";
import { subscriberCount } from "./bus/index.js";
import {
  registerProvider,
  healthCheckAll,
  listProviders,
  createClaudeAdapter,
  createHerdAdapter,
} from "./providers/index.js";
import { getActiveSessions, stopHealthMonitor, startHealthMonitor } from "./stream/index.js";
import { missionRoutes, divisionRoutes, agentRoutes, personaRoutes } from "./api/index.js";
import { initOrchestratorListeners } from "./orchestrator/index.js";

const app = new Hono();
const startTime = Date.now();

// Health endpoint
app.get("/health", async (c) => {
  const providerHealth = await healthCheckAll();
  const providers: Record<string, unknown> = {};
  for (const [id, health] of providerHealth) {
    providers[id] = health;
  }

  return c.json({
    status: "ok",
    version: "0.1.0",
    uptime_s: Math.floor((Date.now() - startTime) / 1000),
    bus_subscribers: subscriberCount(),
    providers,
    active_streams: getActiveSessions().length,
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.route("/missions", missionRoutes);
app.route("/divisions", divisionRoutes);
app.route("/agents", agentRoutes);
app.route("/personas", personaRoutes);

// Providers endpoint
app.get("/providers", (c) => {
  return c.json(
    listProviders().map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      capabilities: p.capabilities,
    })),
  );
});

// Initialize
runMigrations();
logger.info("Migrations applied");

// Register providers based on config
if (config.anthropicApiKey) {
  registerProvider(createClaudeAdapter({ apiKey: config.anthropicApiKey }));
}
if (config.herdBaseUrl) {
  registerProvider(
    createHerdAdapter({
      baseUrl: config.herdBaseUrl,
      statusUrl: config.herdStatusUrl,
    }),
  );
}

// Initialize orchestrator event listeners
initOrchestratorListeners();

// Start stream health monitor
startHealthMonitor();

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info("VALOR engine started", {
    port: config.port,
    providers: listProviders().map((p) => p.id),
  });
});

// Graceful shutdown
function shutdown() {
  logger.info("Shutting down...");
  stopHealthMonitor();
  server.close();
  closeDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
