import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { runMigrations, closeDb } from "./db/index.js";
import { subscriberCount } from "./bus/index.js";
import {
  registerProvider,
  healthCheckAll,
  listProviders,
  createClaudeAdapter,
  createOllamaAdapter,
} from "./providers/index.js";
import { getActiveSessions, stopHealthMonitor, startHealthMonitor } from "./stream/index.js";
import { missionRoutes, missionsLiveRoutes, divisionRoutes, agentRoutes, personaRoutes, decisionRoutes, sitrepRoutes, agentCardRoutes, commsRoutes, artifactRoutes, authRoutes, userRoutes } from "./api/index.js";
import { dashboardRoutes } from "./dashboard/index.js";
import { loginPage } from "./dashboard/pages/index.js";
import { sessionMiddleware, requireAuth } from "./auth/index.js";
import { attachWebSocket, closeWebSocket } from "./ws/index.js";
import { initOrchestratorListeners } from "./orchestrator/index.js";
import { seedDefaultOathRules } from "./vector/index.js";
import { seedDefaultUser } from "./db/repositories/index.js";
import { registerSigintOutcomeCallback } from "./callbacks/sigint-outcome.js";

const app = new Hono();
const startTime = Date.now();

// Session resolution — runs on every request
app.use("*", sessionMiddleware);

// Root redirect to dashboard
app.get("/", (c) => c.redirect("/dashboard"));

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
    skill_url: "/skill.md",
  });
});

// Auth routes (no auth required)
app.route("/auth", authRoutes);
app.route("/login", loginPage);

// API routes
app.route("/api/users", userRoutes);
app.route("/api/missions-live", missionsLiveRoutes);
app.route("/missions", missionRoutes);
app.route("/divisions", divisionRoutes);
app.route("/agents", agentRoutes);
app.route("/personas", personaRoutes);
app.route("/decisions", decisionRoutes);
app.route("/sitreps", sitrepRoutes);
app.route("/agent-cards", agentCardRoutes);
app.route("/comms", commsRoutes);
app.route("/artifacts", artifactRoutes);

// Dashboard — protected
app.use("/dashboard/*", requireAuth);
app.route("/dashboard", dashboardRoutes);

// Agent skill document — served as raw markdown for agent onboarding
// Usage: point any agent at http://host:3200/skill.md
import { readFileSync } from "fs";
import { resolve } from "path";

const skillMdPath = resolve(import.meta.dirname ?? ".", "..", "SKILL.md");

app.get("/skill.md", (c) => {
  try {
    const content = readFileSync(skillMdPath, "utf-8");
    c.header("Content-Type", "text/markdown; charset=utf-8");
    return c.text(content);
  } catch {
    return c.text("SKILL.md not found", 404);
  }
});

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
if (config.ollamaBaseUrl) {
  registerProvider(
    createOllamaAdapter({
      baseUrl: config.ollamaBaseUrl,
      statusUrl: config.ollamaStatusUrl,
    }),
  );
}

// Seed defaults
seedDefaultOathRules();
seedDefaultUser();

// Initialize orchestrator event listeners
initOrchestratorListeners();
registerSigintOutcomeCallback();

// Start stream health monitor
startHealthMonitor();

// Start NATS subscriber for dashboard real-time updates
import { natsSubscriber } from "./dashboard/nats-subscriber.js";
const natsUrl = process.env.NATS_URL || "nats://localhost:4222";
natsSubscriber.start(natsUrl).catch((err) => {
  logger.warn("NATS subscriber failed to start - dashboard will not have real-time updates", { error: err.message });
});

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info("VALOR engine started", {
    port: config.port,
    providers: listProviders().map((p) => p.id),
    nats_connected: natsSubscriber.isConnected(),
  });
});

// Attach WebSocket server for dashboard live updates
attachWebSocket(server as unknown as Server);

// Graceful shutdown
async function shutdown() {
  logger.info("Shutting down...");
  closeWebSocket();
  stopHealthMonitor();
  await natsSubscriber.stop();
  server.close();
  closeDb();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
