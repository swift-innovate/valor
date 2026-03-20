import { subscribe } from "../bus/index.js";
import { getDb } from "../db/database.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

interface MissionRow {
  id: string;
  source_metadata: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export function registerSigintOutcomeCallback(): void {
  subscribe("mission.aar.approved", (event) => {
    const missionId = (event.payload as { mission_id: string }).mission_id;
    if (!missionId) return;

    const mission = getDb()
      .prepare("SELECT id, source_metadata, status, created_at, completed_at FROM missions WHERE id = ?")
      .get(missionId) as MissionRow | undefined;

    if (!mission?.source_metadata) return;

    let metadata: { intercept_id?: string };
    try {
      metadata = JSON.parse(mission.source_metadata);
    } catch {
      return;
    }

    if (!metadata.intercept_id) return;

    const daysToMvp = mission.completed_at && mission.created_at
      ? Math.ceil(
          (new Date(mission.completed_at).getTime() - new Date(mission.created_at).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;

    const outcome = {
      intercept_id: metadata.intercept_id,
      project_id: mission.id,
      mvp_built: true,
      days_to_mvp: daysToMvp,
      notes: `Mission ${mission.id} completed with status: ${mission.status}`,
    };

    const url = `${config.sigintUrl}/api/outcomes`;

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outcome),
    }).catch((err) => {
      logger.error("Failed to POST outcome to SIGINT", {
        url,
        intercept_id: metadata.intercept_id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  logger.info("SIGINT outcome callback registered");
}
