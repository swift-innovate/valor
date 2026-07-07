import { Hono } from "hono";
import { overviewPage, missionsPage, approvalsPage, agentsPage, divisionsPage, decisionsPage, agentCardsPage, commsPage, artifactsPage, usersPage, initiativesPage, folderOverviewPage, folderMissionsPage, folderAgentsPage } from "./pages/index.js";
import { requireDirectorSession } from "../auth/index.js";
import { sseRoutes } from "./sse.js";
import { config } from "../config.js";

export const dashboardRoutes = new Hono();

// Mount SSE endpoint for real-time updates
dashboardRoutes.route("/sse", sseRoutes);

// Mount sub-pages under /dashboard — folder store or SQLite
if (config.storeBackend === "folder") {
  dashboardRoutes.route("/", folderOverviewPage);
  dashboardRoutes.route("/missions", folderMissionsPage);
  dashboardRoutes.route("/agents", folderAgentsPage);
} else {
  dashboardRoutes.route("/", overviewPage);
  dashboardRoutes.route("/missions", missionsPage);
  dashboardRoutes.route("/agents", agentsPage);
}

// These pages remain SQLite-backed (no folder equivalents yet)
dashboardRoutes.route("/approvals", approvalsPage);
dashboardRoutes.route("/divisions", divisionsPage);
dashboardRoutes.route("/decisions", decisionsPage);
dashboardRoutes.route("/agent-cards", agentCardsPage);
dashboardRoutes.route("/comms", commsPage);
dashboardRoutes.route("/artifacts", artifactsPage);
dashboardRoutes.route("/initiatives", initiativesPage);

// Director-only: user management
dashboardRoutes.use("/users/*", requireDirectorSession);
dashboardRoutes.route("/users", usersPage);
