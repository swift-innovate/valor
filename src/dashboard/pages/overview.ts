import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listDivisions, listAgents, listMissions } from "../../db/index.js";
import type { Division, Agent, Mission } from "../../types/index.js";

export const overviewPage = new Hono();

// ── Health status indicators ────────────────────────────────────────

const HEALTH_DOT: Record<string, string> = {
  healthy: "status-healthy",
  degraded: "status-degraded",
  offline: "status-offline",
  registered: "status-registered",
};

function healthDot(status: string) {
  return html`<span class="status-dot ${HEALTH_DOT[status] ?? "status-offline"}"></span>`;
}

// ── Stat card helper ────────────────────────────────────────────────

function statCard(label: string, value: string | number, sub?: string) {
  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">${label}</div>
      <div class="mt-1 text-2xl font-bold text-gray-100">${value}</div>
      ${sub ? html`<div class="mt-1 text-xs text-gray-500">${sub}</div>` : ""}
    </div>`;
}

// ── Division card ───────────────────────────────────────────────────

function divisionCard(
  div: Division,
  agents: Agent[],
  missions: Mission[],
) {
  const lead = agents.find((a) => a.id === div.lead_agent_id);
  const divAgents = agents.filter((a) => a.division_id === div.id);
  const divMissions = missions.filter((m) => m.division_id === div.id);
  const activeMissions = divMissions.filter(
    (m) => !["complete", "aar_complete", "failed", "aborted", "timed_out"].includes(m.status),
  );

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-5 fade-in">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-base font-semibold text-gray-100">${div.name}</h3>
        <span class="text-xs text-gray-600 font-mono">${div.namespace}</span>
      </div>

      <!-- Lead -->
      <div class="flex items-center gap-2 mb-3">
        ${lead
          ? html`${healthDot(lead.health_status)}
              <span class="text-sm text-gray-300">${lead.callsign}</span>
              <span class="text-xs text-gray-600">(${lead.runtime})</span>`
          : html`<span class="text-sm text-gray-500 italic">No lead assigned</span>`}
      </div>

      <!-- Stats row -->
      <div class="grid grid-cols-3 gap-3 text-center">
        <div>
          <div class="text-lg font-bold text-gray-200">${divAgents.length}</div>
          <div class="text-xs text-gray-500">Agents</div>
        </div>
        <div>
          <div class="text-lg font-bold text-gray-200">${activeMissions.length}</div>
          <div class="text-xs text-gray-500">Active</div>
        </div>
        <div>
          <div class="text-lg font-bold text-gray-200">${divMissions.length}</div>
          <div class="text-xs text-gray-500">Total</div>
        </div>
      </div>

      <!-- Autonomy tier -->
      <div class="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between">
        <span class="text-xs text-gray-500">Autonomy</span>
        <span class="text-xs font-medium text-valor-400">
          $${div.autonomy_policy.max_cost_autonomous_usd.toFixed(2)} max auto
        </span>
      </div>
    </div>`;
}

// ── Route handler ───────────────────────────────────────────────────

overviewPage.get("/", (c) => {
  const divisions = listDivisions();
  const agents = listAgents();
  const missions = listMissions();

  const activeMissions = missions.filter(
    (m) => !["complete", "aar_complete", "failed", "aborted", "timed_out"].includes(m.status),
  );
  const healthyAgents = agents.filter((a) => a.health_status === "healthy");
  const totalCost = missions.reduce((sum, m) => sum + m.cost_usd, 0);

  const content = html`
    <div class="fade-in space-y-6">
      <h1 class="text-xl font-bold text-gray-100">Mission Control — Overview</h1>

      <!-- Global stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        ${statCard("Divisions", divisions.length)}
        ${statCard("Agents", agents.length, `${healthyAgents.length} healthy`)}
        ${statCard("Active Missions", activeMissions.length, `${missions.length} total`)}
        ${statCard("Total Cost", `$${totalCost.toFixed(4)}`)}
      </div>

      <!-- Division cards -->
      <div>
        <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Divisions</h2>
        ${divisions.length === 0
          ? html`<p class="text-gray-500 text-sm">No divisions registered.</p>`
          : html`<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              ${divisions.map((d) => divisionCard(d, agents, missions))}
            </div>`}
      </div>
    </div>`;

  return c.html(layout("Overview", "/dashboard", content));
});
