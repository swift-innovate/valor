import { type Context } from "grammy";
import { logger } from "../utils/logger.js";
import {
  listMissions,
  listAgents,
  getMission,
  getLatestSitrep,
  listSitreps,
  createMission,
  getAgent,
  listApprovals,
  resolveApproval,
} from "../db/repositories/index.js";
import { publish } from "../bus/index.js";
import { getActiveSessions } from "../stream/index.js";
import { subscriberCount } from "../bus/index.js";
import {
  formatEngineHealth,
  formatMissionList,
  formatAgentList,
  formatSitrep,
  escapeMarkdown,
} from "./formatter.js";
import type { MissionStatus } from "../types/index.js";

const ACTIVE_STATUSES: MissionStatus[] = [
  "draft",
  "queued",
  "gated",
  "dispatched",
  "streaming",
];

/** /status — Engine health + active mission count */
export async function handleStatus(ctx: Context): Promise<void> {
  try {
    const startTime = (globalThis as Record<string, unknown>).__valor_start_time as number | undefined;
    const uptime_s = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

    const activeMissions = listMissions().filter((m) =>
      ACTIVE_STATUSES.includes(m.status),
    );
    const agents = listAgents();

    const message = formatEngineHealth({
      uptime_s,
      bus_subscribers: subscriberCount(),
      active_streams: getActiveSessions().length,
      activeMissionCount: activeMissions.length,
      agentCount: agents.length,
    });

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Telegram /status failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to retrieve engine status.");
  }
}

/** /missions — List active missions with status */
export async function handleMissions(ctx: Context): Promise<void> {
  try {
    const missions = listMissions().filter((m) =>
      ACTIVE_STATUSES.includes(m.status),
    );
    const message = formatMissionList(missions);
    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Telegram /missions failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to retrieve missions.");
  }
}

/** /approve <mission_id> — Approve a gated mission */
export async function handleApprove(ctx: Context): Promise<void> {
  try {
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const missionId = parts[1];

    if (!missionId) {
      await ctx.reply("Usage: /approve <mission\\_id>", { parse_mode: "MarkdownV2" });
      return;
    }

    const pending = listApprovals({ mission_id: missionId, status: "pending" });
    if (pending.length === 0) {
      await ctx.reply(
        `No pending approvals for mission \`${escapeMarkdown(missionId)}\``,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    const approval = pending[0];
    const resolved = resolveApproval(approval.id, {
      status: "approved",
      resolved_by: "director",
    });

    if (!resolved) {
      await ctx.reply("Failed to resolve approval.");
      return;
    }

    publish({
      type: "gate.approved",
      source: { id: "director", type: "director" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: missionId, approval_id: approval.id },
      metadata: { via: "telegram" },
    });

    await ctx.reply(
      `\u{2705} Approved mission \`${escapeMarkdown(missionId)}\``,
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Telegram /approve failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to process approval.");
  }
}

/** /reject <mission_id> [reason] — Reject a gated mission */
export async function handleReject(ctx: Context): Promise<void> {
  try {
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const missionId = parts[1];
    const reason = parts.slice(2).join(" ") || undefined;

    if (!missionId) {
      await ctx.reply("Usage: /reject <mission\\_id> \\[reason\\]", { parse_mode: "MarkdownV2" });
      return;
    }

    const pending = listApprovals({ mission_id: missionId, status: "pending" });
    if (pending.length === 0) {
      await ctx.reply(
        `No pending approvals for mission \`${escapeMarkdown(missionId)}\``,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    const approval = pending[0];
    const resolved = resolveApproval(approval.id, {
      status: "rejected",
      resolved_by: "director",
      reason,
    });

    if (!resolved) {
      await ctx.reply("Failed to resolve approval.");
      return;
    }

    publish({
      type: "gate.rejected",
      source: { id: "director", type: "director" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: missionId, approval_id: approval.id, reason },
      metadata: { via: "telegram" },
    });

    await ctx.reply(
      `\u{274C} Rejected mission \`${escapeMarkdown(missionId)}\`${reason ? ` \\- ${escapeMarkdown(reason)}` : ""}`,
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Telegram /reject failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to process rejection.");
  }
}

/** /dispatch <operative> <description> — Create and dispatch a new mission */
export async function handleDispatch(ctx: Context): Promise<void> {
  try {
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const operativeCallsign = parts[1];
    const description = parts.slice(2).join(" ");

    if (!operativeCallsign || !description) {
      await ctx.reply(
        "Usage: /dispatch <operative> <description>",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // Find agent by callsign
    const agents = listAgents();
    const agent = agents.find(
      (a) => a.callsign.toLowerCase() === operativeCallsign.toLowerCase(),
    );

    const mission = createMission({
      division_id: agent?.division_id ?? null,
      title: description.slice(0, 100),
      objective: description,
      status: "queued",
      phase: null,
      assigned_agent_id: agent?.id ?? null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      initiative_id: null,
      dispatched_at: null,
      completed_at: null,
    });

    publish({
      type: "mission.created",
      source: { id: "director", type: "director" },
      target: agent ? { id: agent.id, type: "agent" } : null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: mission.id, title: mission.title },
      metadata: { via: "telegram" },
    });

    const agentNote = agent
      ? `Assigned to *${escapeMarkdown(agent.callsign)}*`
      : `\u{26A0} Agent "${escapeMarkdown(operativeCallsign)}" not found \\- mission created unassigned`;

    await ctx.reply(
      `\u{1F680} *Mission Created*\n\n\`${escapeMarkdown(mission.id)}\`\n${escapeMarkdown(mission.title)}\n${agentNote}`,
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Telegram /dispatch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to create mission.");
  }
}

/** /agents — List registered agents with health status */
export async function handleAgents(ctx: Context): Promise<void> {
  try {
    const agents = listAgents();
    const message = formatAgentList(agents);
    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Telegram /agents failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to retrieve agents.");
  }
}

/** /sitrep [mission_id] — Latest sitrep for a mission or all active missions */
export async function handleSitrep(ctx: Context): Promise<void> {
  try {
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const missionId = parts[1];

    if (missionId) {
      const mission = getMission(missionId);
      const sitrep = getLatestSitrep(missionId);
      if (!sitrep) {
        await ctx.reply(
          `No sitreps for mission \`${escapeMarkdown(missionId)}\``,
          { parse_mode: "MarkdownV2" },
        );
        return;
      }
      const message = formatSitrep(sitrep, mission?.title);
      await ctx.reply(message, { parse_mode: "MarkdownV2" });
      return;
    }

    // All active missions — get latest sitrep for each
    const activeMissions = listMissions().filter((m) =>
      ACTIVE_STATUSES.includes(m.status),
    );

    if (activeMissions.length === 0) {
      await ctx.reply("*No active missions*", { parse_mode: "MarkdownV2" });
      return;
    }

    const lines: string[] = ["*Active Mission Sitreps*", ""];
    for (const mission of activeMissions.slice(0, 10)) {
      const sitrep = getLatestSitrep(mission.id);
      if (sitrep) {
        lines.push(formatSitrep(sitrep, mission.title));
        lines.push("");
      } else {
        lines.push(
          `\u{2753} *${escapeMarkdown(mission.title)}* \\- No sitrep yet`,
        );
        lines.push("");
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Telegram /sitrep failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply("Failed to retrieve sitreps.");
  }
}
