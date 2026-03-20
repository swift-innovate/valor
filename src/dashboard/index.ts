import { Hono } from "hono";
import { overviewPage, missionsPage, approvalsPage, agentsPage, divisionsPage, decisionsPage, agentCardsPage, commsPage, artifactsPage } from "./pages/index.js";

export const dashboardRoutes = new Hono();

// Mount sub-pages under /dashboard
dashboardRoutes.route("/", overviewPage);
dashboardRoutes.route("/missions", missionsPage);
dashboardRoutes.route("/approvals", approvalsPage);
dashboardRoutes.route("/agents", agentsPage);
dashboardRoutes.route("/divisions", divisionsPage);
dashboardRoutes.route("/decisions", decisionsPage);
dashboardRoutes.route("/agent-cards", agentCardsPage);
dashboardRoutes.route("/comms", commsPage);
dashboardRoutes.route("/artifacts", artifactsPage);
