import { Hono } from "hono";
import { overviewPage, missionsPage, approvalsPage, agentsPage, decisionsPage } from "./pages/index.js";

export const dashboardRoutes = new Hono();

// Mount sub-pages under /dashboard
dashboardRoutes.route("/", overviewPage);
dashboardRoutes.route("/missions", missionsPage);
dashboardRoutes.route("/approvals", approvalsPage);
dashboardRoutes.route("/agents", agentsPage);
dashboardRoutes.route("/decisions", decisionsPage);
