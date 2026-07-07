/**
 * Overview — Folder Store
 *
 * Dashboard overview using folder-based stores instead of SQLite/NATS.
 * Shows agent count, mission stats, agent roster table, and recent missions.
 * Mounted when config.storeBackend === 'folder'.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { resolve } from "node:path";
import { layout } from "../layout.js";
import { getAuthUser } from "../../auth/index.js";
import { config } from "../../config.js";
import { AgentDiscovery, AgentLoader } from "../../store/agent-store.js";
import { MissionManager } from "../../store/mission-store.js";
import type { AgentSummary } from "../../store/agent-store.js";
import type { MissionSummary } from "../../store/mission-store.js";
import { logger } from "../../utils/logger.js";

export const folderOverviewPage = new Hono();

// ── Stat card helper ───────────────────────────────────────────────

function statCard(label: string, value: string | number, sub?: string) {
  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">${label}</div>
      <div class="mt-1 text-2xl font-bold text-gray-100">${value}</div>
      ${sub ? html`<div class="mt-1 text-xs text-gray-500">${sub}</div>` : ""}
    </div>`;
}

// ── Status colors ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:      { bg: "bg-blue-900",    text: "text-blue-300" },
  assigned:     { bg: "bg-indigo-900",  text: "text-indigo-300" },
  in_progress:  { bg: "bg-purple-900",  text: "text-purple-300" },
  completed:    { bg: "bg-green-900",   text: "text-green-300" },
  failed:       { bg: "bg-red-900",     text: "text-red-300" },
  escalated:    { bg: "bg-yellow-900",  text: "text-yellow-300" },
  aborted:      { bg: "bg-gray-700",    text: "text-gray-300" },
};

const TIER_COLORS: Record<number, string> = {
  0: "bg-red-900 text-red-300",
  1: "bg-purple-900 text-purple-300",
  2: "bg-blue-900 text-blue-300",
  3: "bg-gray-700 text-gray-300",
};

// ── Agent roster row ───────────────────────────────────────────────

function agentRow(summary: AgentSummary, model: string) {
  const isActive = summary.status.toLowerCase() === "active";
  const tierCls = TIER_COLORS[summary.tier] ?? TIER_COLORS[2];

  return html`
    <tr class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
      <td class="px-4 py-2">
        <span class="text-sm font-semibold text-gray-100">${summary.callsign}</span>
      </td>
      <td class="px-4 py-2">
        <span class="text-xs px-2 py-0.5 rounded-full font-medium ${tierCls}">Tier ${summary.tier}</span>
      </td>
      <td class="px-4 py-2">
        <span class="text-sm text-gray-400">${summary.division || "—"}</span>
      </td>
      <td class="px-4 py-2">
        <span class="inline-flex items-center gap-1.5">
          <span class="status-dot ${isActive ? "status-healthy" : "status-offline"}"></span>
          <span class="text-xs ${isActive ? "text-green-300" : "text-gray-500"}">${summary.status}</span>
        </span>
      </td>
      <td class="px-4 py-2">
        <span class="text-xs text-gray-500 truncate max-w-[180px] inline-block" title="${model}">${model}</span>
      </td>
    </tr>`;
}

// ── Mission card (for recent missions) ─────────────────────────────

function missionCard(m: MissionSummary) {
  const normalized = m.status.toLowerCase().replace(/\s+/g, "_");
  const c = STATUS_COLORS[normalized] ?? STATUS_COLORS.pending;

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4 fade-in">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-mono text-gray-500">${m.missionId}</span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}">
          ${m.status}
        </span>
      </div>
      <h4 class="text-sm font-semibold text-gray-100 mb-1">${m.title || m.missionId}</h4>
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <span class="text-valor-400">${m.assignedTo || "unassigned"}</span>
        <span>|</span>
        <span>${m.priority}</span>
      </div>
    </div>`;
}

// ── Route handler ──────────────────────────────────────────────────

folderOverviewPage.get("/", (c) => {
  const agentsDir = resolve(config.agentsDir);
  const missionsDir = resolve(config.missionsDir);

  // Load agents
  let agents: Array<{ summary: AgentSummary; model: string }> = [];
  try {
    const agentIds = AgentDiscovery.scan(agentsDir);
    agents = agentIds.map((id) => {
      const agentPath = resolve(agentsDir, id);
      const summary = AgentLoader.summaryFromPersona(agentPath);
      const agentConfig = AgentLoader.fromDirectory(agentPath);
      const model = agentConfig.modelAssignment["default"] ?? "unknown";
      return { summary, model };
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load agents for overview", { error: message });
  }

  // Load missions
  let missions: MissionSummary[] = [];
  try {
    missions = MissionManager.list(missionsDir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load missions for overview", { error: message });
  }

  // Compute stats
  const agentCount = agents.length;
  const missionTotal = missions.length;
  const missionActive = missions.filter((m) => {
    const s = m.status.toLowerCase();
    return s !== "completed" && s !== "failed" && s !== "aborted";
  }).length;

  // Derive unique divisions
  const divisionsSet = new Set<string>();
  for (const a of agents) {
    if (a.summary.division) {
      divisionsSet.add(a.summary.division);
    }
  }
  const divisionCount = divisionsSet.size;

  // Recent missions (last 5)
  const recentMissions = missions.slice(0, 5);

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Mission Control — Overview</h1>
        <span class="text-xs text-gray-600">(folder store)</span>
      </div>

      <!-- Stat cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        ${statCard("Agents", agentCount, `${agents.filter((a) => a.summary.status.toLowerCase() === "active").length} active`)}
        ${statCard("Active Missions", missionActive, `${missionTotal} total`)}
        ${statCard("Divisions", divisionCount, [...divisionsSet].join(", ") || "none")}
        ${statCard("Completed", missions.filter((m) => m.status.toLowerCase() === "completed").length.toString())}
      </div>

      <!-- Two-column layout -->
      <div class="grid lg:grid-cols-2 gap-6">
        <!-- Left: Agent Roster -->
        <div>
          <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Agent Roster</h2>
          ${agents.length === 0
            ? html`<p class="text-gray-500 text-sm">No agents found. Create agent folders under ${agentsDir}/.</p>`
            : html`
                <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
                  <table class="min-w-full divide-y divide-gray-800">
                    <thead class="bg-gray-800/50">
                      <tr>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Callsign</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Tier</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Division</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Model</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-800">
                      ${agents.map((a) => agentRow(a.summary, a.model))}
                    </tbody>
                  </table>
                </div>`}
        </div>

        <!-- Right: Recent Missions -->
        <div>
          <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Recent Missions</h2>
          ${recentMissions.length === 0
            ? html`<p class="text-gray-500 text-sm">No missions found.</p>`
            : html`
                <div class="grid gap-3">
                  ${recentMissions.map(missionCard)}
                </div>`}
        </div>
      </div>
    </div>`;

  return c.html(layout("Overview", "/dashboard", content, getAuthUser(c)));
});
