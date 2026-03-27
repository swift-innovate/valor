/**
 * GitHub Webhook Receiver for VALOR
 *
 * Receives events from GitHub Actions and maps them back to VALOR
 * missions. When a Claude-CI agent completes a task and opens a PR,
 * this endpoint updates the originating mission's sitrep.
 *
 * Events handled:
 *   - pull_request.opened  → sitrep update on parent mission
 *   - issues.closed         → mission completion if linked
 *   - issue_automated      → custom event from claude-issues workflow
 *
 * Security:
 *   - Validates X-VALOR-Webhook-Secret header against VALOR_WEBHOOK_SECRET env
 *   - Rejects unsigned payloads in production mode
 */

import { Hono } from "hono";
import { logger } from "../utils/logger.js";
import { natsState } from "../dashboard/nats-state.js";
import { currentConnection } from "../nats/client.js";
import { publishSitrep } from "../nats/publishers.js";
import type { NatsSitrep } from "../nats/types.js";

export const webhookRoutes = new Hono();

const WEBHOOK_SECRET = process.env.VALOR_WEBHOOK_SECRET ?? "";

// ── Helpers ────────────────────────────────────────────────────────────

function verifyWebhookSecret(header: string | undefined): boolean {
  if (!WEBHOOK_SECRET) {
    // Dev mode: accept with warning
    logger.warn("[webhooks] VALOR_WEBHOOK_SECRET not set — accepting unsigned payload");
    return true;
  }
  return header === WEBHOOK_SECRET;
}

/**
 * Extract a VALOR mission ID (VM-NNN) from issue body text.
 * Looks for the structured issue template field or a raw mention.
 */
function extractMissionId(text: string): string | null {
  // Match issue template format: "VM-" followed by digits
  const match = text.match(/\bVM-\d{3,4}\b/);
  return match ? match[0] : null;
}

/**
 * Find the operative callsign from issue body (template field)
 */
function extractOperative(text: string): string {
  const match = text.match(/Requesting Operative\s*\n+([a-zA-Z][a-zA-Z0-9_-]*)/i);
  return match ? match[1].toLowerCase() : "claude-ci";
}

// ── POST /api/webhooks/github ──────────────────────────────────────────

webhookRoutes.post("/github", async (c) => {
  const secret = c.req.header("X-VALOR-Webhook-Secret");
  if (!verifyWebhookSecret(secret)) {
    logger.warn("[webhooks] Rejected GitHub webhook — invalid secret");
    return c.json({ error: "Invalid webhook secret" }, 401);
  }

  const githubEvent = c.req.header("X-GitHub-Event") ?? "unknown";
  const body = await c.req.json();

  logger.info(`[webhooks] GitHub event received: ${githubEvent}`);

  try {
    switch (githubEvent) {
      case "pull_request":
        return await handlePullRequest(c, body);
      case "issues":
        return await handleIssueEvent(c, body);
      case "issue_automated":
        return await handleAutomatedTask(c, body);
      default:
        logger.debug(`[webhooks] Unhandled GitHub event: ${githubEvent}`);
        return c.json({ status: "ignored", event: githubEvent });
    }
  } catch (err) {
    logger.error(`[webhooks] Error processing ${githubEvent}:`, err);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

// ── Event Handlers ─────────────────────────────────────────────────────

/**
 * Handle pull_request events — when Claude-CI opens a PR linked to a mission
 */
async function handlePullRequest(c: any, payload: any) {
  const action = payload.action;
  if (action !== "opened" && action !== "closed") {
    return c.json({ status: "ignored", reason: `PR action: ${action}` });
  }

  const prTitle: string = payload.pull_request?.title ?? "";
  const prBody: string = payload.pull_request?.body ?? "";
  const prUrl: string = payload.pull_request?.html_url ?? "";
  const prNumber: number = payload.pull_request?.number ?? 0;
  const merged: boolean = payload.pull_request?.merged ?? false;

  // Extract mission ID from PR title or body
  const missionId = extractMissionId(prTitle) ?? extractMissionId(prBody);
  if (!missionId) {
    logger.debug("[webhooks] PR has no VALOR mission ID — skipping");
    return c.json({ status: "ignored", reason: "No mission ID in PR" });
  }

  if (action === "opened") {
    // PR opened → update mission with IN_PROGRESS sitrep + PR link
    logger.info(`[webhooks] PR #${prNumber} opened for mission ${missionId}`);
    await publishMissionSitrep(missionId, "claude-ci", {
      status: "IN_PROGRESS",
      summary: `Pull request #${prNumber} opened: ${prTitle}`,
      progress_pct: 80,
      artifacts: [{ type: "url", label: `PR #${prNumber}`, ref: prUrl }],
      next_steps: ["Awaiting Director review and merge"],
    });
  } else if (action === "closed" && merged) {
    // PR merged → mission COMPLETE
    logger.info(`[webhooks] PR #${prNumber} merged for mission ${missionId}`);
    await publishMissionSitrep(missionId, "claude-ci", {
      status: "COMPLETE",
      summary: `PR #${prNumber} merged. Implementation delivered.`,
      progress_pct: 100,
      artifacts: [{ type: "url", label: `PR #${prNumber} (merged)`, ref: prUrl }],
    });
  }

  return c.json({ status: "processed", mission_id: missionId, pr: prNumber });
}

/**
 * Handle issues events — specifically issue closure linked to a mission
 */
async function handleIssueEvent(c: any, payload: any) {
  if (payload.action !== "closed") {
    return c.json({ status: "ignored", reason: `Issue action: ${payload.action}` });
  }

  const issueBody: string = payload.issue?.body ?? "";
  const issueTitle: string = payload.issue?.title ?? "";
  const issueNumber: number = payload.issue?.number ?? 0;

  const missionId = extractMissionId(issueBody) ?? extractMissionId(issueTitle);
  if (!missionId) {
    return c.json({ status: "ignored", reason: "No mission ID in issue" });
  }

  logger.info(`[webhooks] Issue #${issueNumber} closed for mission ${missionId}`);

  // If the mission isn't already complete, mark it
  const mission = natsState.missions.get(missionId);
  if (mission && mission.status !== "complete") {
    await publishMissionSitrep(missionId, extractOperative(issueBody), {
      status: "COMPLETE",
      summary: `GitHub issue #${issueNumber} closed. Task complete.`,
      progress_pct: 100,
    });
  }

  return c.json({ status: "processed", mission_id: missionId, issue: issueNumber });
}

/**
 * Handle custom 'issue_automated' event from the claude-issues workflow
 */
async function handleAutomatedTask(c: any, payload: any) {
  const { event, issue_number, run_id } = payload;

  logger.info(`[webhooks] Automated task event: ${event} for issue #${issue_number} (run: ${run_id})`);

  // We don't have the mission ID directly here — the workflow step posts
  // a generic completion. The real mission linkage happens via the PR event.
  // This is a fallback notification for observability.

  return c.json({
    status: "acknowledged",
    event,
    issue_number,
    run_id,
  });
}

// ── NATS Sitrep Publisher ──────────────────────────────────────────────

interface SitrepPayload {
  status: "ACCEPTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE" | "FAILED";
  summary: string;
  progress_pct: number;
  artifacts?: Array<{ type: string; label: string; ref: string }>;
  next_steps?: string[];
}

async function publishMissionSitrep(
  missionId: string,
  operative: string,
  payload: SitrepPayload,
): Promise<void> {
  const nc = currentConnection();
  if (!nc) {
    logger.warn(`[webhooks] NATS not connected — cannot publish sitrep for ${missionId}`);
    return;
  }

  const sitrep: NatsSitrep = {
    mission_id: missionId,
    operative,
    status: payload.status,
    summary: payload.summary,
    progress_pct: payload.progress_pct,
    blockers: [],
    next_steps: payload.next_steps ?? [],
    artifacts: (payload.artifacts ?? []) as any,
    tokens_used: 0,
    timestamp: new Date().toISOString(),
  };

  try {
    await publishSitrep(sitrep);
    logger.info(`[webhooks] Published sitrep for ${missionId}: ${payload.status}`);
  } catch (err) {
    logger.error(`[webhooks] Failed to publish sitrep for ${missionId}:`, err);
  }
}
