/**
 * Dynamic Operative Roster
 *
 * Queries approved agent cards from the database to build the Director's
 * routing roster at runtime. No more hardcoded operative lists.
 *
 * Mission: VM-027
 */

import { getDb } from "../db/database.js";
import { logger } from "../utils/logger.js";

export interface RegisteredOperative {
  callsign: string;
  name: string;
  primary_skills: string[];
  runtime: string;
  model: string | null;
  description: string;
}

/**
 * Query the database for all approved agent cards.
 * Returns the live roster of operatives the Director can route to.
 */
export function getRegisteredOperatives(): RegisteredOperative[] {
  try {
    const rows = getDb().queryAll<{
      callsign: string;
      name: string;
      primary_skills: string;
      runtime: string;
      model: string | null;
      description: string;
    }>(
      "SELECT callsign, name, primary_skills, runtime, model, description FROM agent_cards WHERE approval_status = 'approved' ORDER BY callsign",
      {},
    );

    return rows.map((r) => ({
      callsign: r.callsign,
      name: r.name,
      primary_skills: JSON.parse(r.primary_skills),
      runtime: r.runtime,
      model: r.model,
      description: r.description,
    }));
  } catch (err) {
    logger.error("Failed to query registered operatives", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Get the set of valid operative callsigns for validation.
 */
export function getValidOperativeCallsigns(): Set<string> {
  return new Set(getRegisteredOperatives().map((o) => o.callsign));
}

/**
 * Build the operative roster section for the Director's system prompt.
 * Only includes registered (approved) operatives.
 */
export function buildRosterPromptSection(): string {
  const operatives = getRegisteredOperatives();

  if (operatives.length === 0) {
    return [
      "## Operative Roster",
      "",
      "**No operatives are currently registered.** All missions should be ESCALATED to Principal.",
      "Respond with decision: \"ESCALATE\" for every mission until operatives come online.",
    ].join("\n");
  }

  const lines = ["## Operative Roster (Live — Registered Agents)", ""];

  for (const op of operatives) {
    lines.push(`### ${op.name} (${op.callsign})`);
    if (op.description) {
      lines.push(`**Description:** ${op.description}`);
    }
    if (op.primary_skills.length > 0) {
      lines.push(`**Skills:** ${op.primary_skills.join(", ")}`);
    }
    lines.push(`**Runtime:** ${op.runtime}`);
    if (op.model) {
      lines.push(`**Model:** ${op.model}`);
    }
    lines.push("");
  }

  const callsigns = operatives.map((o) => `"${o.callsign}"`).join(" | ");
  lines.push(`**Valid operative values for routing:** ${callsigns}`);
  lines.push("");
  lines.push("**IMPORTANT:** Only route to operatives listed above. If the best fit is not registered, ESCALATE to Principal.");

  return lines.join("\n");
}

/**
 * Check if a specific callsign is registered (approved agent card).
 */
export function isOperativeRegistered(callsign: string): boolean {
  try {
    const row = getDb().queryOne<{ callsign: string }>(
      "SELECT callsign FROM agent_cards WHERE callsign = @callsign AND approval_status = 'approved' LIMIT 1",
      { callsign },
    );
    return row !== null;
  } catch {
    return false;
  }
}
