import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { runMigrations, closeDb } from "./db/index.js";
import { subscriberCount } from "./bus/index.js";

const app = new Hono();
const startTime = Date.now();

// Health endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    version: "0.1.0",
    uptime_s: Math.floor((Date.now() - startTime) / 1000),
    bus_subscribers: subscriberCount(),
    timestamp: new Date().toISOString(),
  });
});

// Initialize
runMigrations();
logger.info("Migrations applied");

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info("VALOR engine started", { port: config.port });
});

// Graceful shutdown
function shutdown() {
  logger.info("Shutting down...");
  server.close();
  closeDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
