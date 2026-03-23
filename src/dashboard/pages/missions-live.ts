/**
 * Mission Board — Live (NATS-powered)
 *
 * Full mission management: create, view, cancel, retry, reassign,
 * archive, status filters, operative tabs.
 *
 * Mission: VM-025 (enhanced from VM-016)
 * Operative: Mira
 */

import { Hono } from "hono";
import { html, raw } from "hono/html";
import { layout } from "../layout.js";
import { natsState } from "../nats-state.js";
import type { DashboardMission } from "../nats-state.js";
import { getAuthUser } from "../../auth/index.js";
import { missionDetailPage } from "./mission-detail.js";
import { listInitiatives, listMissions } from "../../db/index.js";
import type { Mission } from "../../types/index.js";

export const missionsPage = new Hono();

// ── Status color map ─────────────────────────────────────────────────

const STATUS_COLORS: Record<DashboardMission["status"], { bg: string; text: string }> = {
  pending:  { bg: "bg-blue-900",    text: "text-blue-300" },
  active:   { bg: "bg-purple-900",  text: "text-purple-300" },
  blocked:  { bg: "bg-yellow-900",  text: "text-yellow-300" },
  complete: { bg: "bg-green-900",   text: "text-green-300" },
  failed:   { bg: "bg-red-900",     text: "text-red-300" },
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "text-red-400 font-semibold",
  P1: "text-orange-400 font-semibold",
  P2: "text-gray-300",
  P3: "text-gray-500",
};

const TERMINAL_STATUSES = new Set(["complete", "failed"]);

// ── Helpers ──────────────────────────────────────────────────────────

function statusBadge(status: DashboardMission["status"]) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}">${status}</span>`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Action buttons per row ───────────────────────────────────────────

function rowActions(m: DashboardMission) {
  const isTerminal = TERMINAL_STATUSES.has(m.status);
  const btns: ReturnType<typeof html>[] = [];

  if (!isTerminal) {
    btns.push(html`<button onclick="reassignMission('${m.mission_id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-blue-900/60 hover:bg-blue-800 text-blue-300 transition-colors" title="Reassign">↗</button>`);
    btns.push(html`<button onclick="cancelMission('${m.mission_id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors" title="Cancel">✕</button>`);
  }
  if (m.status === "failed") {
    btns.push(html`<button onclick="retryMission('${m.mission_id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-blue-900/60 hover:bg-blue-800 text-blue-300 transition-colors" title="Retry">↻</button>`);
  }
  if (isTerminal) {
    btns.push(html`<button onclick="archiveMission('${m.mission_id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors" title="Archive">📦</button>`);
  }

  return html`<div class="flex items-center gap-1">${btns}</div>`;
}

// ── Operative resolution ─────────────────────────────────────────────

function resolveOperative(m: DashboardMission): string {
  if (m.assigned_to !== "director") return m.assigned_to;
  if (m.latest_sitrep) {
    const routeMatch = m.latest_sitrep.match(/Routed to (\w+)/i);
    if (routeMatch) return routeMatch[1];
    const decompMatch = m.latest_sitrep.match(/Decomposed into (\d+)/);
    if (decompMatch) return `${decompMatch[1]} sub-missions`;
  }
  return m.assigned_to;
}

// ── Sitrep linkifier ─────────────────────────────────────────────────

function linkifyMissionIds(text: string): string {
  return text.replace(/(VM-\d+(?:-\d+)?)/g,
    '<a href="/dashboard/missions/$1" class="text-valor-400 hover:underline">$1</a>');
}

// ── Mission row ──────────────────────────────────────────────────────

function missionRow(m: DashboardMission) {
  const priorityClass = PRIORITY_COLORS[m.priority] ?? PRIORITY_COLORS.P2;
  const displayTitle = /^VM-\d/.test(m.title) && m.description
    ? m.description.slice(0, 80) + (m.description.length > 80 ? "…" : "")
    : m.title;

  return html`
    <tr class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer group"
        data-mission="${m.mission_id}" data-status="${m.status}" data-created-at="${m.created_at}">
      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        <div class="font-mono text-sm text-valor-400">${m.mission_id}</div>
        <div class="text-xs text-gray-600 mt-0.5">
          <span class="dispatch-age" data-created-at="${m.created_at}">${formatDate(m.created_at)}</span>
        </div>
      </td>

      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        <div class="flex items-center gap-2">
          <span class="font-medium text-gray-200">${displayTitle}</span>
          ${m.status === "pending" || m.status === "active"
            ? html`<span class="inline-flex items-center gap-1 text-xs text-gray-500 waiting-indicator">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-valor-500 animate-pulse"></span>
                ${m.status === "pending" ? "waiting..." : "working..."}
              </span>`
            : ""}
        </div>
        ${m.latest_sitrep
          ? html`<div class="text-xs text-gray-500 mt-1 italic line-clamp-2">${raw(linkifyMissionIds(m.latest_sitrep))}</div>`
          : ""}
      </td>

      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        <span class="text-sm ${priorityClass}">${m.priority}</span>
      </td>

      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        <div class="text-sm text-gray-300">${resolveOperative(m)}</div>
      </td>

      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        ${statusBadge(m.status)}
      </td>

      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        ${m.progress_pct !== null
          ? html`
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-gray-800 rounded-full h-2 min-w-[60px]">
                  <div class="bg-valor-500 h-2 rounded-full" style="width: ${m.progress_pct}%"></div>
                </div>
                <span class="text-xs text-gray-500 w-10 text-right">${m.progress_pct}%</span>
              </div>
            `
          : html`<span class="text-xs text-gray-600">—</span>`}
      </td>

      <td class="px-4 py-3" onclick="window.location='/dashboard/missions/${m.mission_id}'">
        ${m.blockers.length > 0
          ? html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900 text-yellow-300">
              ⚠️ ${m.blockers.length}
            </span>`
          : ""}
        ${m.artifacts.length > 0
          ? html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900 text-blue-300">
              📎 ${m.artifacts.length}
            </span>`
          : ""}
      </td>

      <td class="px-4 py-3">
        ${rowActions(m)}
      </td>
    </tr>`;
}

// ── Route handler ────────────────────────────────────────────────────

missionsPage.get("/", (c) => {
  const statusFilter = c.req.query("status");
  const operativeFilter = c.req.query("operative");
  const showArchived = c.req.query("archived") === "true";
  const groupByInitiative = c.req.query("group") === "initiative";

  let missions: DashboardMission[];
  if (showArchived) {
    missions = natsState.getArchivedMissions();
  } else if (statusFilter === "all") {
    missions = natsState.getMissions({ operative: operativeFilter });
  } else if (statusFilter) {
    missions = natsState.getMissions({ status: statusFilter as any, operative: operativeFilter });
  } else {
    // Default view: hide terminal missions
    const all = natsState.getMissions({ operative: operativeFilter });
    missions = all.filter(m => m.status !== "complete" && m.status !== "failed");
  }

  const stats = natsState.getStats();
  const operatives = natsState.getOperatives();
  const archivedCount = natsState.getArchivedMissions().length;

  // ── Initiative grouping (DB missions grouped by initiative) ──────────
  const initiatives = groupByInitiative ? listInitiatives({ status: "active" }) : [];
  const dbMissions = groupByInitiative ? listMissions({}) : [];
  const missionsByInitiative = new Map<string, (Mission & { initiative_id?: string | null })[]>();
  const ungroupedDbMissions: (Mission & { initiative_id?: string | null })[] = [];
  if (groupByInitiative) {
    for (const m of dbMissions as (Mission & { initiative_id?: string | null })[]) {
      if (m.initiative_id) {
        const list = missionsByInitiative.get(m.initiative_id) ?? [];
        list.push(m);
        missionsByInitiative.set(m.initiative_id, list);
      } else {
        ungroupedDbMissions.push(m);
      }
    }
  }

  const content = html`
    <div class="fade-in space-y-6">
      <!-- Header with actions -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold text-gray-100">Mission Board — Live</h1>
          <div id="connection-status" class="flex items-center gap-2 text-xs">
            <span class="w-2 h-2 rounded-full bg-gray-500" id="status-dot"></span>
            <span id="status-text" class="text-gray-500">Connecting...</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="toggleCreateModal()"
            class="px-3 py-1.5 text-sm font-medium rounded-lg bg-valor-700 hover:bg-valor-600 text-white transition-colors">
            + New Mission
          </button>
          ${!showArchived
            ? html`
                <button onclick="archiveAllCompleted()"
                  class="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                  title="Archive all completed and failed missions">
                  📦 Clear Completed
                </button>
                <button onclick="purgeTestData()"
                  class="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                  title="Remove TEST missions">
                  🗑️ Purge Tests
                </button>
              `
            : ""}
          <a href="${groupByInitiative ? "/dashboard/missions" : "/dashboard/missions?group=initiative"}"
            class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              groupByInitiative
                ? "bg-valor-700 text-white"
                : "bg-gray-800 hover:bg-gray-700 text-gray-400"
            }" title="Group by initiative">
            🚩 By Initiative
          </a>
        </div>
      </div>

      <!-- Stats bar with clickable filters -->
      <div class="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <a href="?status=all" class="block bg-gray-900 rounded-lg border ${statusFilter === "all" ? "border-valor-500" : "border-gray-800"} p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-gray-200">${stats.missions.total}</div>
          <div class="text-xs text-gray-500 uppercase">All</div>
        </a>
        <a href="?status=pending" class="block bg-gray-900 rounded-lg border ${statusFilter === "pending" ? "border-valor-500" : "border-gray-800"} p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-blue-400" id="stat-pending">${stats.missions.pending}</div>
          <div class="text-xs text-gray-500 uppercase">Pending</div>
        </a>
        <a href="?status=active" class="block bg-gray-900 rounded-lg border ${statusFilter === "active" ? "border-valor-500" : "border-gray-800"} p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-purple-400" id="stat-active">${stats.missions.active}</div>
          <div class="text-xs text-gray-500 uppercase">Active</div>
        </a>
        <a href="?status=blocked" class="block bg-gray-900 rounded-lg border ${statusFilter === "blocked" ? "border-valor-500" : "border-gray-800"} p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-yellow-400" id="stat-blocked">${stats.missions.blocked}</div>
          <div class="text-xs text-gray-500 uppercase">Blocked</div>
        </a>
        <a href="?status=complete" class="block bg-gray-900 rounded-lg border ${statusFilter === "complete" ? "border-valor-500" : "border-gray-800"} p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-green-400" id="stat-complete">${stats.missions.complete}</div>
          <div class="text-xs text-gray-500 uppercase">Complete</div>
        </a>
        <a href="?status=failed" class="block bg-gray-900 rounded-lg border ${statusFilter === "failed" ? "border-valor-500" : "border-gray-800"} p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-red-400" id="stat-failed">${stats.missions.failed}</div>
          <div class="text-xs text-gray-500 uppercase">Failed</div>
        </a>
      </div>

      <!-- Filters: Operative tabs + Archive toggle -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-2 flex-wrap">
          <a href="/dashboard/missions" 
             class="${!operativeFilter && !showArchived ? "bg-valor-600" : "bg-gray-800"} px-3 py-1.5 rounded text-xs font-medium hover:bg-valor-700 transition-colors">
            All Missions
          </a>
          ${operatives
            .filter((op) => op.status !== "OFFLINE")
            .map(
              (op) => html`
                <a href="?operative=${op.callsign}" 
                   class="${operativeFilter === op.callsign ? "bg-valor-600" : "bg-gray-800"} px-3 py-1.5 rounded text-xs font-medium hover:bg-valor-700 transition-colors">
                  ${op.callsign}
                  ${op.status === "BUSY" ? html`<span class="ml-1 w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block"></span>` : ""}
                </a>
              `
            )}
        </div>
        <div class="flex items-center gap-2">
          <a href="${showArchived ? "/dashboard/missions" : "?archived=true"}"
             class="${showArchived ? "bg-valor-600" : "bg-gray-800"} px-3 py-1.5 rounded text-xs font-medium hover:bg-valor-700 transition-colors">
            ${showArchived ? "← Active" : "📦 Archived"} ${archivedCount > 0 ? `(${archivedCount})` : ""}
          </a>
        </div>
      </div>

      ${groupByInitiative ? html`
      <!-- Initiative-grouped DB missions -->
      <div class="space-y-4">
        ${initiatives.length === 0 && ungroupedDbMissions.length === 0
          ? html`<div class="text-center py-8 text-sm text-gray-600">No active initiatives. <a href="/dashboard/initiatives" class="text-valor-400 hover:underline">View all initiatives →</a></div>`
          : html`
            ${initiatives.map((ini) => {
              const iniMissions = missionsByInitiative.get(ini.id) ?? [];
              const complete = iniMissions.filter((m) => ["aar_complete", "complete"].includes(m.status)).length;
              const pct = iniMissions.length > 0 ? Math.round((complete / iniMissions.length) * 100) : 0;
              return html`
                <details class="bg-gray-900 border border-gray-800 rounded-lg" open>
                  <summary class="px-4 py-3 cursor-pointer flex items-center justify-between gap-3 hover:bg-gray-800/50 rounded-lg">
                    <div class="flex items-center gap-3 min-w-0">
                      <span class="text-sm font-semibold text-gray-200 truncate">${ini.title}</span>
                      <span class="text-xs px-2 py-0.5 rounded-full bg-green-900 text-green-300">${ini.status}</span>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                      <span class="text-xs text-gray-500">${complete}/${iniMissions.length}</span>
                      <div class="w-24 bg-gray-800 rounded-full h-1.5">
                        <div class="bg-valor-500 h-1.5 rounded-full" style="width: ${pct}%"></div>
                      </div>
                    </div>
                  </summary>
                  <div class="border-t border-gray-800 overflow-x-auto">
                    ${iniMissions.length === 0
                      ? html`<p class="px-4 py-3 text-xs text-gray-600 italic">No missions assigned.</p>`
                      : html`<table class="w-full text-sm">
                        <tbody class="divide-y divide-gray-800">
                          ${iniMissions.map((m) => html`
                            <tr class="hover:bg-gray-800/30 cursor-pointer" onclick="window.location='/dashboard/missions/${m.id}'">
                              <td class="px-4 py-2 font-mono text-xs text-gray-500 w-36">${m.id.slice(0, 12)}…</td>
                              <td class="px-4 py-2 text-gray-300">${m.title}</td>
                              <td class="px-4 py-2 text-xs text-gray-400">${m.status}</td>
                            </tr>`)}
                        </tbody>
                      </table>`}
                  </div>
                </details>`;
            })}
            ${ungroupedDbMissions.length > 0 ? html`
              <details class="bg-gray-900 border border-gray-800 rounded-lg">
                <summary class="px-4 py-3 cursor-pointer flex items-center gap-3 hover:bg-gray-800/50 rounded-lg">
                  <span class="text-sm font-semibold text-gray-400">Ungrouped</span>
                  <span class="text-xs text-gray-600">${ungroupedDbMissions.length} missions</span>
                </summary>
                <div class="border-t border-gray-800 overflow-x-auto">
                  <table class="w-full text-sm">
                    <tbody class="divide-y divide-gray-800">
                      ${ungroupedDbMissions.map((m) => html`
                        <tr class="hover:bg-gray-800/30 cursor-pointer" onclick="window.location='/dashboard/missions/${m.id}'">
                          <td class="px-4 py-2 font-mono text-xs text-gray-500 w-36">${m.id.slice(0, 12)}…</td>
                          <td class="px-4 py-2 text-gray-300">${m.title}</td>
                          <td class="px-4 py-2 text-xs text-gray-400">${m.status}</td>
                        </tr>`)}
                    </tbody>
                  </table>
                </div>
              </details>` : ""}
          `}
      </div>
      ` : html`
      <!-- Mission table -->
      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-800">
            <thead class="bg-gray-800/50">
              <tr>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Mission ID</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Title</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Priority</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Operative</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody id="missions-tbody" class="bg-gray-900 divide-y divide-gray-800">
              ${missions.length === 0
                ? html`
                    <tr>
                      <td colspan="8" class="px-4 py-8 text-center text-gray-500 text-sm">
                        ${showArchived
                          ? "No archived missions."
                          : html`No missions found${statusFilter ? ` with status "${statusFilter}"` : ""}${operativeFilter ? ` assigned to ${operativeFilter}` : ""}.`}
                      </td>
                    </tr>
                  `
                : missions.map(missionRow)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
      `}

    <!-- Create Mission Modal -->
    <div id="create-modal" class="fixed inset-0 z-50 hidden">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="toggleCreateModal()"></div>
      <div class="absolute inset-4 sm:inset-auto sm:top-[10%] sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-auto max-h-[80vh]">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 class="text-lg font-bold text-gray-100">Create Mission</h2>
          <button onclick="toggleCreateModal()" class="text-gray-500 hover:text-white text-xl">&times;</button>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <label class="block text-xs text-gray-400 mb-1">Title <span class="text-red-400">*</span></label>
            <input id="c-title" type="text" placeholder="Mission title"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Description <span class="text-red-400">*</span></label>
            <textarea id="c-description" rows="4" placeholder="Full mission description (markdown supported)"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500 resize-none font-mono"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-gray-400 mb-1">Priority</label>
              <select id="c-priority"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
                <option value="P2">P2 — Normal</option>
                <option value="P0">P0 — Critical</option>
                <option value="P1">P1 — High</option>
                <option value="P3">P3 — Low</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">Assign To</label>
              <select id="c-operative"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
                <option value="Director">Director (auto-route)</option>
                ${operatives.map(
                  (op) => html`<option value="${op.callsign}">${op.callsign} ${op.status !== "OFFLINE" ? `(${op.status})` : "(offline)"}</option>`
                )}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-gray-400 mb-1">Model Tier</label>
              <select id="c-model-tier"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
                <option value="balanced">Balanced</option>
                <option value="local">Local (free)</option>
                <option value="efficient">Efficient</option>
                <option value="frontier">Frontier</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">Deadline <span class="text-gray-600">(optional)</span></label>
              <input id="c-deadline" type="datetime-local"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
            </div>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Acceptance Criteria <span class="text-gray-600">(one per line)</span></label>
            <textarea id="c-criteria" rows="3" placeholder="All tests pass&#10;No regressions&#10;Code review approved"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
          <div class="flex items-center justify-end gap-3 pt-2">
            <button onclick="toggleCreateModal()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onclick="createMission()" id="create-btn"
              class="px-4 py-2 text-sm font-medium rounded-lg bg-valor-700 hover:bg-valor-600 text-white transition-colors">
              Create Mission
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Scripts -->
    <script>
      // ── Create modal ───────────────────────────────────────────────
      function toggleCreateModal() {
        document.getElementById('create-modal').classList.toggle('hidden');
      }

      function lines(id) {
        return document.getElementById(id).value.split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);
      }

      async function createMission() {
        var title = document.getElementById('c-title').value.trim();
        var description = document.getElementById('c-description').value.trim();
        if (!title || !description) { showToast('Title and description are required', 'error'); return; }

        var btn = document.getElementById('create-btn');
        btn.disabled = true;
        btn.textContent = 'Creating...';

        try {
          var body = {
            title: title,
            description: description,
            priority: document.getElementById('c-priority').value,
            assigned_to: document.getElementById('c-operative').value,
            model_tier: document.getElementById('c-model-tier').value,
            deadline: document.getElementById('c-deadline').value || null,
            acceptance_criteria: lines('c-criteria'),
          };

          var res = await fetch('/api/missions-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            showToast('Mission created!', 'success');
            toggleCreateModal();
            setTimeout(function() { location.reload(); }, 500);
          } else {
            var d = await res.json();
            showToast(d.error || 'Create failed', 'error');
          }
        } finally {
          btn.disabled = false;
          btn.textContent = 'Create Mission';
        }
      }

      // ── Mission actions ────────────────────────────────────────────
      async function cancelMission(id) {
        if (!confirm('Cancel mission ' + id + '? This cannot be undone.')) return;
        var res = await fetch('/api/missions-live/' + id + '/cancel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) { showToast('Mission cancelled', 'success'); setTimeout(function(){ location.reload(); }, 500); }
        else { var d = await res.json(); showToast(d.error || 'Cancel failed', 'error'); }
      }

      async function retryMission(id) {
        if (!confirm('Retry mission ' + id + '?')) return;
        var res = await fetch('/api/missions-live/' + id + '/retry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) { showToast('Mission queued for retry', 'success'); setTimeout(function(){ location.reload(); }, 500); }
        else { var d = await res.json(); showToast(d.error || 'Retry failed', 'error'); }
      }

      async function archiveMission(id) {
        if (!confirm('Archive mission ' + id + '?')) return;
        var res = await fetch('/api/missions-live/' + id + '/archive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) { showToast('Mission archived', 'success'); setTimeout(function(){ location.reload(); }, 500); }
        else { var d = await res.json(); showToast(d.error || 'Archive failed', 'error'); }
      }

      async function reassignMission(id) {
        var operative = prompt('Reassign to which operative?');
        if (!operative) return;
        var res = await fetch('/api/missions-live/' + id + '/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operative: operative }),
        });
        if (res.ok) { showToast('Mission reassigned to ' + operative, 'success'); setTimeout(function(){ location.reload(); }, 500); }
        else { var d = await res.json(); showToast(d.error || 'Reassign failed', 'error'); }
      }

      async function archiveAllCompleted() {
        if (!confirm('Archive ALL completed and failed missions?')) return;
        var res = await fetch('/api/missions-live/archive-completed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) { var d = await res.json(); showToast('Archived ' + d.count + ' missions', 'success'); setTimeout(function(){ location.reload(); }, 500); }
        else { var d = await res.json(); showToast(d.error || 'Archive failed', 'error'); }
      }

      async function purgeTestData() {
        if (!confirm('Purge all TEST missions? This removes them permanently from the board.')) return;
        var res = await fetch('/api/missions-live/purge-tests', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) { var d = await res.json(); showToast('Purged ' + d.count + ' test missions', 'success'); setTimeout(function(){ location.reload(); }, 500); }
        else { var d = await res.json(); showToast(d.error || 'Purge failed', 'error'); }
      }

      // ── SSE Client ─────────────────────────────────────────────────
      (function() {
        var eventSource = null;
        var reconnectAttempts = 0;
        var maxReconnectAttempts = 5;
        var reconnectDelay = 2000;

        function updateConnectionStatus(connected) {
          var dot = document.getElementById('status-dot');
          var text = document.getElementById('status-text');
          if (connected) {
            dot.className = 'w-2 h-2 rounded-full bg-green-500';
            text.textContent = 'Connected';
            text.className = 'text-green-500 text-xs';
          } else {
            dot.className = 'w-2 h-2 rounded-full bg-red-500';
            text.textContent = 'Disconnected';
            text.className = 'text-red-500 text-xs';
          }
        }

        function connect() {
          eventSource = new EventSource('/dashboard/sse');

          eventSource.addEventListener('connected', function() {
            updateConnectionStatus(true);
            reconnectAttempts = 0;
          });

          eventSource.addEventListener('initial-state', function(e) {
            var state = JSON.parse(e.data);
            updateStats(state.stats);
          });

          eventSource.addEventListener('mission.updated', function() {
            setTimeout(function() { location.reload(); }, 500);
          });

          eventSource.addEventListener('sitrep.received', function() {
            setTimeout(function() { location.reload(); }, 500);
          });

          eventSource.addEventListener('mission.archived', function() {
            setTimeout(function() { location.reload(); }, 500);
          });

          eventSource.addEventListener('missions.archived', function() {
            setTimeout(function() { location.reload(); }, 500);
          });

          eventSource.addEventListener('missions.purged', function() {
            setTimeout(function() { location.reload(); }, 500);
          });

          eventSource.addEventListener('ping', function() {});

          eventSource.onerror = function() {
            updateConnectionStatus(false);
            eventSource.close();
            if (reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++;
              setTimeout(connect, reconnectDelay * reconnectAttempts);
            }
          };
        }

        function updateStats(stats) {
          if (!stats) return;
          var el;
          el = document.getElementById('stat-pending'); if (el) el.textContent = stats.missions.pending;
          el = document.getElementById('stat-active'); if (el) el.textContent = stats.missions.active;
          el = document.getElementById('stat-blocked'); if (el) el.textContent = stats.missions.blocked;
          el = document.getElementById('stat-complete'); if (el) el.textContent = stats.missions.complete;
          el = document.getElementById('stat-failed'); if (el) el.textContent = stats.missions.failed;
        }

        connect();
        window.addEventListener('beforeunload', function() { if (eventSource) eventSource.close(); });
      })();

      // ── Dispatch age timer ─────────────────────────────────────────
      // Updates "Dispatched X ago" on pending/active mission rows every 5s.
      (function() {
        function relativeTime(isoStr) {
          var ms = Date.now() - new Date(isoStr).getTime();
          if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
          if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
          return Math.floor(ms / 3600000) + 'h ago';
        }

        function updateAges() {
          document.querySelectorAll('tr[data-status="pending"], tr[data-status="active"]').forEach(function(row) {
            var span = row.querySelector('.dispatch-age');
            if (span) {
              var created = span.dataset.createdAt;
              if (created) span.textContent = 'Dispatched ' + relativeTime(created);
            }
          });
        }

        updateAges();
        setInterval(updateAges, 5000);
      })();
    </script>`;

  return c.html(layout("Missions", "/dashboard/missions", content, getAuthUser(c)));
});

// Mount detail view — handles /dashboard/missions/:id
missionsPage.route("/", missionDetailPage);
