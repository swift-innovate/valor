/**
 * Identifier validation for folder-store entities.
 *
 * Agent and mission IDs become directory names under agents/ and missions/.
 * Strict character allowlists (no dots, no slashes) make path traversal
 * impossible by construction — validate at every boundary where an ID
 * arrives from outside (API params, request bodies, dashboard forms).
 */

/** Agent folder ids: kebab/snake alphanumerics, e.g. "gage", "crazy-eddie". */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Mission folder ids: VM- prefix + nanoid/sequence, e.g. "VM-042", "VM-6MxPPi". */
const MISSION_ID_RE = /^VM-[A-Za-z0-9_-]{1,32}$/;

export function isValidAgentId(id: string): boolean {
  return AGENT_ID_RE.test(id);
}

export function isValidMissionId(id: string): boolean {
  return MISSION_ID_RE.test(id);
}

/** Reduce a callsign to a folder-safe agent id, e.g. "Crazy Eddie" → "crazy-eddie". */
export function agentIdFromCallsign(callsign: string): string {
  return callsign.trim().toLowerCase().replace(/\s+/g, '-');
}
