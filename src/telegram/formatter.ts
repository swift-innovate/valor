import type { Mission, MissionStatus, Sitrep } from "../types/index.js";
import type { Agent } from "../types/index.js";
import type { Approval } from "../db/repositories/approval-repo.js";

/** Characters that must be escaped in Telegram MarkdownV2 */
const ESCAPE_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/** Escape a string for Telegram MarkdownV2 */
export function escapeMarkdown(text: string): string {
  return text.replace(ESCAPE_CHARS, "\\$1");
}

/** Status emoji mapping — no escaping needed for emoji */
const STATUS_ICON: Record<string, string> = {
  draft: "\u{1F4DD}",       // memo
  queued: "\u{23F3}",       // hourglass
  gated: "\u{1F6A7}",       // construction
  dispatched: "\u{1F680}",  // rocket
  streaming: "\u{26A1}",    // lightning
  complete: "\u{2705}",     // check mark
  aar_pending: "\u{1F4CB}", // clipboard
  aar_complete: "\u{1F3C6}",// trophy
  failed: "\u{274C}",       // cross mark
  aborted: "\u{1F6D1}",     // stop
  timed_out: "\u{23F0}",    // alarm clock
};

const HEALTH_ICON: Record<string, string> = {
  healthy: "\u{1F7E2}",     // green circle
  degraded: "\u{1F7E1}",    // yellow circle
  offline: "\u{1F534}",     // red circle
  registered: "\u{26AA}",   // white circle
  deregistered: "\u{26AB}", // black circle
};

function statusIcon(status: string): string {
  return STATUS_ICON[status] ?? "\u{2753}"; // question mark
}

function healthIcon(status: string): string {
  return HEALTH_ICON[status] ?? "\u{2753}";
}

export function formatEngineHealth(data: {
  uptime_s: number;
  bus_subscribers: number;
  active_streams: number;
  activeMissionCount: number;
  agentCount: number;
}): string {
  const uptime = formatDuration(data.uptime_s);
  return [
    "*VALOR Engine Status*",
    "",
    `\u{23F1} Uptime: ${escapeMarkdown(uptime)}`,
    `\u{1F4E1} Bus subscribers: ${data.bus_subscribers}`,
    `\u{26A1} Active streams: ${data.active_streams}`,
    `\u{1F3AF} Active missions: ${data.activeMissionCount}`,
    `\u{1F916} Agents: ${data.agentCount}`,
  ].join("\n");
}

export function formatMissionList(missions: Mission[]): string {
  if (missions.length === 0) {
    return "*No active missions*";
  }

  const lines = ["*Active Missions*", ""];
  for (const m of missions.slice(0, 15)) {
    const icon = statusIcon(m.status);
    const id = escapeMarkdown(m.id);
    const title = escapeMarkdown(m.title);
    lines.push(`${icon} \`${id}\``);
    lines.push(`  ${title} \\[${escapeMarkdown(m.status)}\\]`);
  }

  if (missions.length > 15) {
    lines.push("", escapeMarkdown(`... and ${missions.length - 15} more`));
  }

  return lines.join("\n");
}

export function formatAgentList(agents: Agent[]): string {
  if (agents.length === 0) {
    return "*No registered agents*";
  }

  const lines = ["*Registered Agents*", ""];
  for (const a of agents) {
    const icon = healthIcon(a.health_status);
    const callsign = escapeMarkdown(a.callsign);
    const runtime = escapeMarkdown(a.runtime);
    lines.push(`${icon} *${callsign}* \\(${runtime}\\) \\[${escapeMarkdown(a.health_status)}\\]`);
  }

  return lines.join("\n");
}

export function formatSitrep(sitrep: Sitrep, missionTitle?: string): string {
  const title = missionTitle ? escapeMarkdown(missionTitle) : escapeMarkdown(sitrep.mission_id);
  const lines = [
    `*Sitrep* \\- ${title}`,
    "",
    `Status: ${escapeMarkdown(sitrep.status)} | Phase: ${escapeMarkdown(sitrep.phase)} | Confidence: ${escapeMarkdown(sitrep.confidence)}`,
    "",
    escapeMarkdown(sitrep.summary),
  ];

  if (sitrep.blockers.length > 0) {
    lines.push("", "*Blockers:*");
    for (const b of sitrep.blockers) {
      lines.push(`  \u{1F6D1} ${escapeMarkdown(b)}`);
    }
  }

  return lines.join("\n");
}

export function formatApprovalRequest(approval: Approval, mission: Mission | null): string {
  const title = mission ? escapeMarkdown(mission.title) : escapeMarkdown(approval.mission_id);
  return [
    `\u{1F6A8} *Approval Required*`,
    "",
    `Mission: ${title}`,
    `Gate: ${escapeMarkdown(approval.gate)}`,
    `ID: \`${escapeMarkdown(approval.id)}\``,
    `Mission ID: \`${escapeMarkdown(approval.mission_id)}\``,
    "",
    `Use /approve ${escapeMarkdown(approval.mission_id)} or /reject ${escapeMarkdown(approval.mission_id)} \\[reason\\]`,
  ].join("\n");
}

export function formatMissionComplete(mission: Mission): string {
  return [
    `\u{2705} *Mission Complete*`,
    "",
    `\`${escapeMarkdown(mission.id)}\``,
    escapeMarkdown(mission.title),
  ].join("\n");
}

export function formatMissionFailed(mission: Mission, reason?: string): string {
  const lines = [
    `\u{274C} *Mission Failed*`,
    "",
    `\`${escapeMarkdown(mission.id)}\``,
    escapeMarkdown(mission.title),
  ];
  if (reason) {
    lines.push("", `Reason: ${escapeMarkdown(reason)}`);
  }
  return lines.join("\n");
}

export function formatMissionDispatched(mission: Mission): string {
  return [
    `\u{1F680} *Mission Dispatched*`,
    "",
    `\`${escapeMarkdown(mission.id)}\``,
    escapeMarkdown(mission.title),
    mission.assigned_agent_id
      ? `Assigned to: \`${escapeMarkdown(mission.assigned_agent_id)}\``
      : "Unassigned",
  ].join("\n");
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
