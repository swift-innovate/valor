/**
 * Mission Timeout Monitor
 *
 * Scans all non-terminal missions on a fixed interval and reassigns them when:
 *   - A pending mission exceeds PICKUP_TIMEOUT_MS without being picked up
 *   - An active mission exceeds STALE_TIMEOUT_MS without a sitrep
 *
 * Mission: VM-035
 */

import { natsState } from "../dashboard/nats-state.js";
import type { DashboardMission } from "../dashboard/nats-state.js";
import { getNatsConnection } from "../nats/client.js";
import { publishMissionBrief } from "../nats/publishers.js";
import type { MissionBrief } from "../nats/types.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Configuration (overridable via environment variables)
// ---------------------------------------------------------------------------

const PICKUP_TIMEOUT_MS = parseInt(
  process.env.MISSION_PICKUP_TIMEOUT_MS ?? String(30 * 60 * 1000),
  10,
);

const STALE_TIMEOUT_MS = parseInt(
  process.env.MISSION_STALE_TIMEOUT_MS ?? String(30 * 60 * 1000),
  10,
);

const CHECK_INTERVAL_MS = 60_000; // scan every minute

// ---------------------------------------------------------------------------
// Monitor class
// ---------------------------------------------------------------------------

export class MissionTimeoutMonitor {
  private timer: NodeJS.Timeout | null = null;

  /**
   * Start the periodic timeout scan.
   */
  start(): void {
    if (this.timer !== null) {
      logger.warn("[MissionTimeoutMonitor] Already running — ignoring duplicate start()");
      return;
    }
    this.timer = setInterval(() => {
      this.runCheck().catch((err: unknown) => {
        logger.error("[MissionTimeoutMonitor] Unhandled error in runCheck()", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, CHECK_INTERVAL_MS);

    logger.info("[MissionTimeoutMonitor] Started", {
      pickup_timeout_ms: PICKUP_TIMEOUT_MS,
      stale_timeout_ms: STALE_TIMEOUT_MS,
      check_interval_ms: CHECK_INTERVAL_MS,
    });
  }

  /**
   * Stop the periodic scan.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[MissionTimeoutMonitor] Stopped");
    }
  }

  // -------------------------------------------------------------------------
  // Core scan logic
  // -------------------------------------------------------------------------

  private async runCheck(): Promise<void> {
    const now = Date.now();
    const missions = natsState.getMissions();

    // Only consider non-terminal missions
    const active = missions.filter(
      (m) => m.status !== "complete" && m.status !== "failed",
    );

    for (const mission of active) {
      if (mission.status === "pending") {
        const createdAt = new Date(mission.created_at).getTime();
        if (!isNaN(createdAt) && now - createdAt > PICKUP_TIMEOUT_MS) {
          logger.warn("[MissionTimeoutMonitor] Pickup timeout exceeded", {
            mission_id: mission.mission_id,
            assigned_to: mission.assigned_to,
            created_at: mission.created_at,
            elapsed_ms: now - createdAt,
          });
          await this.reassign(mission, "pickup_timeout");
        }
      } else if (mission.status === "active" || mission.status === "blocked") {
        // Use last_sitrep_at if available, otherwise fall back to started_at
        const lastActivityStr = mission.last_sitrep_at ?? mission.started_at;
        if (!lastActivityStr) continue;

        const lastActivity = new Date(lastActivityStr).getTime();
        if (!isNaN(lastActivity) && now - lastActivity > STALE_TIMEOUT_MS) {
          logger.warn("[MissionTimeoutMonitor] Stale mission detected", {
            mission_id: mission.mission_id,
            assigned_to: mission.assigned_to,
            last_sitrep_at: mission.last_sitrep_at,
            started_at: mission.started_at,
            elapsed_ms: now - lastActivity,
          });
          await this.reassign(mission, "stale_timeout");
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reassignment
  // -------------------------------------------------------------------------

  private async reassign(
    mission: DashboardMission,
    reason: "pickup_timeout" | "stale_timeout",
  ): Promise<void> {
    // Find an IDLE operative that is not the current assignee
    const operatives = natsState.getOperatives();
    const candidate = operatives.find(
      (op) => op.status === "IDLE" && op.callsign !== mission.assigned_to,
    );

    if (!candidate) {
      logger.warn("[MissionTimeoutMonitor] No IDLE operative available — skipping reassignment", {
        mission_id: mission.mission_id,
        reason,
        current_assignee: mission.assigned_to,
      });
      return;
    }

    const oldOperative = mission.assigned_to;

    // Build MissionBrief from DashboardMission fields, using sensible defaults
    // for fields that are not tracked on the dashboard state.
    const brief: MissionBrief = {
      mission_id: mission.mission_id,
      title: mission.title,
      description: mission.description,
      priority: mission.priority,
      assigned_to: candidate.callsign,
      depends_on: [],
      parent_mission: null,
      model_tier: "balanced",
      acceptance_criteria: [],
      context_refs: [],
      deadline: null,
      created_at: mission.created_at,
    };

    try {
      const nc = await getNatsConnection();
      await publishMissionBrief(nc, "valor-monitor", brief);

      // Update local state
      natsState.reassignMission(mission.mission_id, candidate.callsign);

      logger.info("[MissionTimeoutMonitor] Mission reassigned", {
        mission_id: mission.mission_id,
        old_operative: oldOperative,
        new_operative: candidate.callsign,
        reason,
      });
    } catch (err: unknown) {
      logger.error("[MissionTimeoutMonitor] Failed to republish mission brief during reassignment", {
        mission_id: mission.mission_id,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const missionTimeoutMonitor = new MissionTimeoutMonitor();
