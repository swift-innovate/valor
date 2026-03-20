import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listAgents, getDivision, getPersona } from "../../db/index.js";
import type { Agent, AgentStatus } from "../../types/index.js";

export const agentsPage = new Hono();

// ── Health status rendering ─────────────────────────────────────────

const HEALTH_COLORS: Record<AgentStatus, { dot: string; text: string }> = {
  registered: { dot: "status-registered", text: "text-blue-300" },
  healthy:    { dot: "status-healthy",    text: "text-green-300" },
  degraded:   { dot: "status-degraded",   text: "text-yellow-300" },
  offline:    { dot: "status-offline",     text: "text-red-300" },
  deregistered: { dot: "status-offline",   text: "text-gray-500" },
};

function healthBadge(status: AgentStatus) {
  const color = HEALTH_COLORS[status] ?? HEALTH_COLORS.offline;
  return html`<span class="inline-flex items-center gap-1.5">
    <span class="status-dot ${color.dot}"></span>
    <span class="text-xs font-medium ${color.text}">${status}</span>
  </span>`;
}

// ── Runtime badge ───────────────────────────────────────────────────

const RUNTIME_COLORS: Record<string, string> = {
  claude_api: "bg-purple-900 text-purple-300",
  openclaw:   "bg-blue-900 text-blue-300",
  ollama:     "bg-green-900 text-green-300",
  openai_api: "bg-emerald-900 text-emerald-300",
  custom:     "bg-gray-700 text-gray-300",
};

function runtimeBadge(runtime: string) {
  return html`<span class="text-xs px-2 py-0.5 rounded-full font-medium ${RUNTIME_COLORS[runtime] ?? RUNTIME_COLORS.custom}">
    ${runtime}
  </span>`;
}

// ── Date helpers ────────────────────────────────────────────────────

function timeSince(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Agent card ──────────────────────────────────────────────────────

function agentCard(agent: Agent) {
  const division = agent.division_id ? getDivision(agent.division_id) : null;
  const persona = agent.persona_id ? getPersona(agent.persona_id) : null;

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4 fade-in">
      <!-- Header: callsign + health -->
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-sm font-semibold text-gray-100">${agent.callsign}</h3>
          <div class="text-xs text-gray-500 mt-0.5">${agent.id}</div>
        </div>
        ${healthBadge(agent.health_status)}
      </div>

      <!-- Runtime + model -->
      <div class="flex items-center gap-2 mb-3">
        ${runtimeBadge(agent.runtime)}
        ${agent.model ? html`<span class="text-xs text-gray-500">${agent.model}</span>` : ""}
      </div>

      <!-- Division + persona -->
      <div class="space-y-1.5 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Division</span>
          <span class="text-gray-300">${division?.name ?? "Unassigned"}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Persona</span>
          <span class="text-gray-300">${persona?.name ?? "None"}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Endpoint</span>
          <span class="text-gray-400 truncate max-w-[200px]" title="${agent.endpoint_url ?? ""}">${agent.endpoint_url ?? "—"}</span>
        </div>
      </div>

      <!-- Heartbeat + capabilities -->
      <div class="mt-3 pt-3 border-t border-gray-800">
        <div class="flex items-center justify-between text-xs mb-2">
          <span class="text-gray-500">Last heartbeat</span>
          <span class="text-gray-400">${timeSince(agent.last_heartbeat)}</span>
        </div>
        ${agent.capabilities.length > 0
          ? html`<div class="flex flex-wrap gap-1 mb-3">
              ${agent.capabilities.map(
                (cap) =>
                  html`<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">${cap}</span>`,
              )}
            </div>`
          : ""}
      </div>

      <!-- Actions -->
      <div class="mt-3 pt-3 border-t border-gray-800 flex justify-end">
        <button
          onclick="if(confirm('Remove agent ${agent.callsign}? This cannot be undone.')) fetch('/agents/${agent.id}', {method:'DELETE'}).then(r => { if(r.ok) location.reload(); else r.json().then(d => alert(d.error || 'Failed')); })"
          class="px-3 py-1 text-xs font-medium rounded bg-red-900 hover:bg-red-700 text-red-300 transition-colors">
          Remove
        </button>
      </div>
    </div>`;
}

// ── Route handler ───────────────────────────────────────────────────

agentsPage.get("/", (c) => {
  const healthFilter = c.req.query("health");
  const agents = listAgents({
    health_status: healthFilter || undefined,
  });

  // ── Filter bar ──────────────────────────────────────────────────
  const filters = ["all", "healthy", "degraded", "offline", "registered"] as const;
  const activeFilter = healthFilter || "all";

  const filterBar = html`
    <div class="flex items-center gap-2 mb-6">
      ${filters.map((f) => {
        const active = f === activeFilter;
        const href = f === "all" ? "/dashboard/agents" : `/dashboard/agents?health=${f}`;
        return html`<a
          href="${href}"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            active
              ? "bg-valor-700 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }">
          ${f}
        </a>`;
      })}
    </div>`;

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Agent Roster</h1>
        <span class="text-sm text-gray-500">${agents.length} agent${agents.length !== 1 ? "s" : ""}</span>
      </div>

      ${filterBar}

      ${agents.length === 0
        ? html`<p class="text-gray-500 text-sm">No agents found${healthFilter ? ` with health status "${healthFilter}"` : ""}.</p>`
        : html`<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${agents.map((a) => agentCard(a))}
          </div>`}
    </div>`;

  return c.html(layout("Agents", "/dashboard/agents", content));
});
