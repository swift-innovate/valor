/**
 * Mission Pipeline — Folder Store
 *
 * Displays missions from folder-based stores (missions/{id}/brief.md)
 * instead of SQLite/NATS. Mounted when config.storeBackend === 'folder'.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { resolve } from "node:path";
import { layout } from "../layout.js";
import { getAuthUser } from "../../auth/index.js";
import { config } from "../../config.js";
import { MissionManager, MissionLoader, MissionWriter } from "../../store/mission-store.js";
import type { MissionSummary } from "../../store/mission-store.js";
import { AgentDiscovery, AgentLoader } from "../../store/agent-store.js";
import { isValidMissionId } from "../../store/ids.js";
import type { AgentSummary } from "../../store/agent-store.js";
import { logger } from "../../utils/logger.js";

export const folderMissionsPage = new Hono();

// ── Status color map ────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:      { bg: "bg-blue-900",    text: "text-blue-300" },
  assigned:     { bg: "bg-indigo-900",  text: "text-indigo-300" },
  in_progress:  { bg: "bg-purple-900",  text: "text-purple-300" },
  completed:    { bg: "bg-green-900",   text: "text-green-300" },
  failed:       { bg: "bg-red-900",     text: "text-red-300" },
  escalated:    { bg: "bg-yellow-900",  text: "text-yellow-300" },
  aborted:      { bg: "bg-gray-700",    text: "text-gray-300" },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 font-semibold",
  high:     "text-orange-400 font-semibold",
  medium:   "text-gray-300",
  low:      "text-gray-500",
};

// ── Helpers ─────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  const c = STATUS_COLORS[normalized] ?? STATUS_COLORS.pending;
  return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}">${status}</span>`;
}

function missionRow(m: MissionSummary, agentCallsigns: readonly string[]) {
  const priorityClass = PRIORITY_COLORS[m.priority.toLowerCase()] ?? PRIORITY_COLORS.medium;

  return html`
    <tr class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors" data-mission="${m.missionId}">
      <td class="px-4 py-3">
        <a href="/dashboard/missions/${m.missionId}" class="font-mono text-sm text-valor-400 hover:text-valor-300 transition-colors">${m.missionId}</a>
      </td>
      <td class="px-4 py-3">
        <a href="/dashboard/missions/${m.missionId}" class="font-medium text-gray-200 hover:text-white transition-colors">${m.title || m.missionId}</a>
      </td>
      <td class="px-4 py-3">
        ${statusBadge(m.status)}
      </td>
      <td class="px-4 py-3">
        <span class="text-sm ${priorityClass}">${m.priority}</span>
      </td>
      <td class="px-4 py-3">
        <span class="text-sm text-gray-300">${m.assignedTo || "unassigned"}</span>
      </td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-1">
          ${m.status.toLowerCase() !== "completed" && m.status.toLowerCase() !== "failed" && m.status.toLowerCase() !== "aborted"
            ? html`
                <button onclick="openAssignModal('${m.missionId}')"
                  class="px-2 py-1 text-xs font-medium rounded bg-blue-900/60 hover:bg-blue-800 text-blue-300 transition-colors" title="Assign agent">
                  Assign
                </button>
                <button onclick="completeMission('${m.missionId}')"
                  class="px-2 py-1 text-xs font-medium rounded bg-green-900/60 hover:bg-green-800 text-green-300 transition-colors" title="Complete">
                  Complete
                </button>`
            : ""}
        </div>
      </td>
    </tr>`;
}

// ── Route handler ──────────────────────────────────────────────────

folderMissionsPage.get("/", (c) => {
  const missionsDir = resolve(config.missionsDir);
  const agentsDir = resolve(config.agentsDir);

  let missions: MissionSummary[];
  try {
    missions = MissionManager.list(missionsDir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load missions from folder store", { error: message });
    missions = [];
  }

  let agentCallsigns: string[];
  try {
    const agentIds = AgentDiscovery.scan(agentsDir);
    agentCallsigns = agentIds.map((id) => {
      const agentPath = resolve(agentsDir, id);
      const summary = AgentLoader.summaryFromPersona(agentPath);
      return summary.callsign;
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to discover agents for assignment dropdown", { error: message });
    agentCallsigns = [];
  }

  // Stats
  const total = missions.length;
  const active = missions.filter((m) => {
    const s = m.status.toLowerCase();
    return s !== "completed" && s !== "failed" && s !== "aborted";
  }).length;

  const content = html`
    <div class="fade-in space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold text-gray-100">Mission Pipeline</h1>
          <span class="text-sm text-gray-500">${active} active / ${total} total <span class="text-xs text-gray-600">(folder store)</span></span>
        </div>
        <button onclick="toggleCreateModal()"
          class="px-3 py-1.5 text-sm font-medium rounded-lg bg-valor-700 hover:bg-valor-600 text-white transition-colors">
          + New Mission
        </button>
      </div>

      <!-- Mission table -->
      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-800">
            <thead class="bg-gray-800/50">
              <tr>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Mission ID</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Title</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Priority</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Assigned To</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="bg-gray-900 divide-y divide-gray-800">
              ${missions.length === 0
                ? html`
                    <tr>
                      <td colspan="6" class="px-4 py-8 text-center text-gray-500 text-sm">
                        No missions found. Create one to get started.
                      </td>
                    </tr>`
                : missions.map((m) => missionRow(m, agentCallsigns))}
            </tbody>
          </table>
        </div>
      </div>
    </div>

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
            <label class="block text-xs text-gray-400 mb-1">Objective <span class="text-red-400">*</span></label>
            <textarea id="c-objective" rows="4" placeholder="Mission objective"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Priority</label>
            <select id="c-priority"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
              <option value="medium">Medium</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
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

    <!-- Assign Agent Modal -->
    <div id="assign-modal" class="fixed inset-0 z-50 hidden">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="closeAssignModal()"></div>
      <div class="absolute inset-4 sm:inset-auto sm:top-[20%] sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 class="text-lg font-bold text-gray-100">Assign Agent</h2>
          <button onclick="closeAssignModal()" class="text-gray-500 hover:text-white text-xl">&times;</button>
        </div>
        <div class="p-6 space-y-4">
          <input type="hidden" id="assign-mission-id">
          <div>
            <label class="block text-xs text-gray-400 mb-1">Agent</label>
            <select id="assign-agent"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500">
              ${agentCallsigns.map(
                (cs) => html`<option value="${cs}">${cs}</option>`
              )}
            </select>
          </div>
          <div class="flex items-center justify-end gap-3 pt-2">
            <button onclick="closeAssignModal()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onclick="assignAgent()" id="assign-btn"
              class="px-4 py-2 text-sm font-medium rounded-lg bg-valor-700 hover:bg-valor-600 text-white transition-colors">
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Complete Mission Modal -->
    <div id="complete-modal" class="fixed inset-0 z-50 hidden">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="closeCompleteModal()"></div>
      <div class="absolute inset-4 sm:inset-auto sm:top-[20%] sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 class="text-lg font-bold text-gray-100">Complete Mission</h2>
          <button onclick="closeCompleteModal()" class="text-gray-500 hover:text-white text-xl">&times;</button>
        </div>
        <div class="p-6 space-y-4">
          <input type="hidden" id="complete-mission-id">
          <div>
            <label class="block text-xs text-gray-400 mb-1">Completion Summary</label>
            <textarea id="complete-summary" rows="3" placeholder="Brief summary of outcomes"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
          <div class="flex items-center justify-end gap-3 pt-2">
            <button onclick="closeCompleteModal()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onclick="submitComplete()" id="complete-btn"
              class="px-4 py-2 text-sm font-medium rounded-lg bg-green-700 hover:bg-green-600 text-white transition-colors">
              Mark Complete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Scripts -->
    <script>
      // ── Create modal ─────────────────────────────────────────────
      function toggleCreateModal() {
        document.getElementById('create-modal').classList.toggle('hidden');
      }

      async function createMission() {
        var title = document.getElementById('c-title').value.trim();
        var objective = document.getElementById('c-objective').value.trim();
        if (!title || !objective) { showToast('Title and objective are required', 'error'); return; }

        var btn = document.getElementById('create-btn');
        btn.disabled = true;
        btn.textContent = 'Creating...';

        try {
          var body = {
            title: title,
            objective: objective,
            priority: document.getElementById('c-priority').value,
          };

          var res = await fetch('/api/folder/missions', {
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

      // ── Assign modal ─────────────────────────────────────────────
      function openAssignModal(missionId) {
        document.getElementById('assign-mission-id').value = missionId;
        document.getElementById('assign-modal').classList.remove('hidden');
      }

      function closeAssignModal() {
        document.getElementById('assign-modal').classList.add('hidden');
      }

      async function assignAgent() {
        var missionId = document.getElementById('assign-mission-id').value;
        var agentId = document.getElementById('assign-agent').value;
        if (!agentId) { showToast('Select an agent', 'error'); return; }

        var btn = document.getElementById('assign-btn');
        btn.disabled = true;
        btn.textContent = 'Assigning...';

        try {
          var res = await fetch('/api/folder/missions/' + missionId + '/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: agentId }),
          });
          if (res.ok) {
            showToast('Agent assigned!', 'success');
            closeAssignModal();
            setTimeout(function() { location.reload(); }, 500);
          } else {
            var d = await res.json();
            showToast(d.error || 'Assign failed', 'error');
          }
        } finally {
          btn.disabled = false;
          btn.textContent = 'Assign';
        }
      }

      // ── Run mission ─────────────────────────────────────────────
      async function runMission(missionId, agentId) {
        var btn = document.getElementById('run-btn');
        var status = document.getElementById('run-status');
        btn.disabled = true;
        btn.textContent = 'Running...';
        status.classList.remove('hidden');
        status.textContent = 'Executing operative loop — this may take a moment...';

        try {
          var res = await fetch('/api/folder/missions/' + missionId + '/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: agentId }),
          });
          var d = await res.json();
          if (res.ok) {
            status.textContent = 'Outcome: ' + (d.outcome || 'done');
            status.className = 'mt-3 text-xs text-green-400';
            showToast('Mission executed — ' + (d.outcome || 'done'), 'success');
            setTimeout(function() { location.reload(); }, 1500);
          } else {
            status.textContent = 'Error: ' + (d.error || 'unknown');
            status.className = 'mt-3 text-xs text-red-400';
            showToast(d.error || 'Run failed', 'error');
          }
        } catch (err) {
          status.textContent = 'Error: ' + err.message;
          status.className = 'mt-3 text-xs text-red-400';
        } finally {
          btn.disabled = false;
          btn.textContent = 'Run Operative Loop';
        }
      }

      // ── Complete modal ───────────────────────────────────────────
      function completeMission(missionId) {
        document.getElementById('complete-mission-id').value = missionId;
        document.getElementById('complete-modal').classList.remove('hidden');
      }

      function closeCompleteModal() {
        document.getElementById('complete-modal').classList.add('hidden');
      }

      async function submitComplete() {
        var missionId = document.getElementById('complete-mission-id').value;
        var summary = document.getElementById('complete-summary').value.trim();

        var btn = document.getElementById('complete-btn');
        btn.disabled = true;
        btn.textContent = 'Completing...';

        try {
          var res = await fetch('/api/folder/missions/' + missionId + '/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary: summary || 'Completed via dashboard.' }),
          });
          if (res.ok) {
            showToast('Mission completed!', 'success');
            closeCompleteModal();
            setTimeout(function() { location.reload(); }, 500);
          } else {
            var d = await res.json();
            showToast(d.error || 'Complete failed', 'error');
          }
        } finally {
          btn.disabled = false;
          btn.textContent = 'Mark Complete';
        }
      }
    </script>`;

  return c.html(layout("Missions", "/dashboard/missions", content, getAuthUser(c)));
});

// ── Helper: load agent summaries for assignment dropdown ───────────

function loadAgentSummaries(agentsDir: string): AgentSummary[] {
  try {
    return AgentDiscovery.scan(agentsDir).map((id) =>
      AgentLoader.summaryFromPersona(resolve(agentsDir, id))
    );
  } catch {
    return [];
  }
}

// ── Mission detail page ───────────────────────────────────────────

folderMissionsPage.get("/:id", (c) => {
  const missionId = c.req.param("id");
  if (!isValidMissionId(missionId)) {
    return c.text("Invalid mission id", 400);
  }
  const missionsDir = resolve(config.missionsDir);
  const agentsDir = resolve(config.agentsDir);
  const missionPath = resolve(missionsDir, missionId);

  // Load mission data
  let brief;
  try {
    brief = MissionLoader.fromDirectory(missionPath);
  } catch {
    const content = html`
      <div class="fade-in space-y-4">
        <a href="/dashboard/missions" class="text-sm text-gray-400 hover:text-white transition-colors">← Back to Missions</a>
        <div class="bg-gray-900 rounded-lg border border-gray-800 p-8 text-center">
          <p class="text-gray-400">Mission <span class="font-mono text-valor-400">${missionId}</span> not found.</p>
        </div>
      </div>`;
    return c.html(layout("Mission Not Found", "/dashboard/missions", content, getAuthUser(c)));
  }

  const progress = MissionLoader.readProgress(missionPath);
  const decisions = MissionLoader.readDecisions(missionPath);
  const handoff = MissionLoader.readHandoff(missionPath);
  const agents = loadAgentSummaries(agentsDir);

  const saved = c.req.query("saved");
  const isTerminal = ['completed', 'failed', 'aborted'].includes(brief.state.toLowerCase());

  const content = html`
    <div class="fade-in space-y-6">
      ${saved ? html`<script>showToast('Changes saved', 'success')</script>` : ""}

      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <a href="/dashboard/missions" class="text-sm text-gray-400 hover:text-white transition-colors">← Back to Missions</a>
          <h1 class="text-xl font-bold text-gray-100 mt-1">${brief.title || missionId}</h1>
          <span class="font-mono text-sm text-gray-500">${missionId}</span>
        </div>
        <div class="flex items-center gap-3">
          ${statusBadge(brief.state)}
          <span class="text-sm ${PRIORITY_COLORS[brief.priority] ?? 'text-gray-300'}">${brief.priority}</span>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-6">
        <!-- Left column: brief + progress + decisions -->
        <div class="lg:col-span-2 space-y-6">

          <!-- Brief -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Brief</h2>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-500">Assigned To</span>
                <span class="text-gray-200">${brief.assignedTo || "unassigned"}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">Assigned By</span>
                <span class="text-gray-200">${brief.assignedBy || "—"}</span>
              </div>
              ${brief.objectives.length > 0 ? html`
                <div class="pt-2 border-t border-gray-800">
                  <span class="text-gray-500 text-xs uppercase">Objectives</span>
                  <ul class="mt-1 space-y-1">
                    ${brief.objectives.map((o) => html`<li class="text-gray-300 text-sm">• ${o}</li>`)}
                  </ul>
                </div>` : ""}
              ${brief.successCriteria && brief.successCriteria.length > 0 ? html`
                <div class="pt-2 border-t border-gray-800">
                  <span class="text-gray-500 text-xs uppercase">Success Criteria</span>
                  <ul class="mt-1 space-y-1">
                    ${brief.successCriteria.map((sc) => html`<li class="text-gray-300 text-sm">• ${sc}</li>`)}
                  </ul>
                </div>` : ""}
            </div>
          </div>

          <!-- Progress -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Progress</h2>
            ${progress.trim()
              ? html`<pre class="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-800/50 rounded p-3 max-h-80 overflow-y-auto">${progress}</pre>`
              : html`<p class="text-sm text-gray-500">No progress recorded yet.</p>`}
          </div>

          <!-- Decisions -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Decision Log</h2>
            ${decisions.trim() && decisions.trim() !== '# Decision Log'
              ? html`<pre class="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-800/50 rounded p-3 max-h-80 overflow-y-auto">${decisions}</pre>`
              : html`<p class="text-sm text-gray-500">No decisions recorded.</p>`}
          </div>

          ${handoff.trim() ? html`
          <!-- Handoff -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Handoff</h2>
            <pre class="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-800/50 rounded p-3 max-h-60 overflow-y-auto">${handoff}</pre>
          </div>` : ""}
        </div>

        <!-- Right column: actions -->
        <div class="space-y-6">
          ${!isTerminal ? html`
          <!-- Assign Agent -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Assign Agent</h2>
            <form method="POST" action="/dashboard/missions/${missionId}/assign" class="space-y-3">
              <select name="agentId" class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
                <option value="">— Select Agent —</option>
                ${agents.map((a) => html`<option value="${a.id}" ${brief.assignedTo === a.id ? "selected" : ""}>${a.callsign} (Tier ${a.tier}, ${a.division})</option>`)}
              </select>
              <button type="submit" class="w-full px-3 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">
                Assign
              </button>
            </form>
          </div>

          <!-- Add Decision -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Record Decision</h2>
            <form method="POST" action="/dashboard/missions/${missionId}/decision" class="space-y-3">
              <input name="title" type="text" placeholder="Decision title"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
              <textarea name="decision" rows="2" placeholder="What was decided"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
              <textarea name="rationale" rows="2" placeholder="Why (rationale)"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
              <button type="submit" class="w-full px-3 py-2 text-sm font-medium rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors">
                Record Decision
              </button>
            </form>
          </div>

          <!-- Run Mission -->
          ${brief.assignedTo ? html`
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Run Mission</h2>
            <p class="text-xs text-gray-500 mb-3">Execute the operative loop with agent <span class="text-gray-300 font-medium">${brief.assignedTo}</span>. The agent's persona will drive the mission through Observe→Plan→Act→Validate→Reflect→Evolve.</p>
            <button onclick="runMission('${missionId}', '${brief.assignedTo}')" id="run-btn"
              class="w-full px-3 py-2 text-sm font-medium rounded bg-purple-700 hover:bg-purple-600 text-white transition-colors">
              Run Operative Loop
            </button>
            <div id="run-status" class="hidden mt-3 text-xs text-gray-400"></div>
          </div>` : html`
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <p class="text-sm text-gray-500">Assign an agent before running the operative loop.</p>
          </div>`}

          <!-- Complete Mission -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Complete Mission</h2>
            <form method="POST" action="/dashboard/missions/${missionId}/complete" class="space-y-3">
              <textarea name="summary" rows="3" placeholder="Completion summary"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
              <button type="submit" class="w-full px-3 py-2 text-sm font-medium rounded bg-green-700 hover:bg-green-600 text-white transition-colors">
                Mark Complete
              </button>
            </form>
          </div>` : html`
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <p class="text-sm text-gray-500 mb-3">Mission is <span class="font-medium text-gray-300">${brief.state.toLowerCase()}</span>.</p>
            ${brief.state !== 'COMPLETED' ? html`
            <form method="POST" action="/dashboard/missions/${missionId}/reset">
              <button type="submit" class="w-full px-3 py-2 text-sm font-medium rounded bg-yellow-700 hover:bg-yellow-600 text-white transition-colors">
                Reset to Pending — Allow Retry
              </button>
            </form>` : ""}
          </div>`}
        </div>
      </div>
    </div>

    <script>
      async function runMission(missionId, agentId) {
        var btn = document.getElementById('run-btn');
        var status = document.getElementById('run-status');
        btn.disabled = true;
        btn.textContent = 'Running...';
        status.classList.remove('hidden');
        status.textContent = 'Executing operative loop — this may take a moment...';

        try {
          var res = await fetch('/api/folder/missions/' + missionId + '/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: agentId }),
          });
          var d = await res.json();
          if (res.ok) {
            status.textContent = 'Outcome: ' + (d.outcome || 'done');
            status.className = 'mt-3 text-xs text-green-400';
            showToast('Mission executed — ' + (d.outcome || 'done'), 'success');
            setTimeout(function() { location.reload(); }, 1500);
          } else {
            status.textContent = 'Error: ' + (d.error || 'unknown');
            status.className = 'mt-3 text-xs text-red-400';
            showToast(d.error || 'Run failed', 'error');
          }
        } catch (err) {
          status.textContent = 'Error: ' + err.message;
          status.className = 'mt-3 text-xs text-red-400';
        } finally {
          btn.disabled = false;
          btn.textContent = 'Run Operative Loop';
        }
      }
    </script>`;

  return c.html(layout(`Mission ${missionId}`, "/dashboard/missions", content, getAuthUser(c)));
});

// ── Mission detail POST handlers ──────────────────────────────────

folderMissionsPage.post("/:id/assign", async (c) => {
  const missionId = c.req.param("id");
  if (!isValidMissionId(missionId)) {
    return c.text("Invalid mission id", 400);
  }
  const missionsDir = resolve(config.missionsDir);
  const body = await c.req.parseBody();
  const agentId = typeof body.agentId === "string" ? body.agentId : "";

  if (!agentId) {
    return c.redirect(`/dashboard/missions/${missionId}`);
  }

  try {
    MissionManager.assign(missionsDir, missionId, agentId);
  } catch (err: unknown) {
    logger.error("Failed to assign mission", { missionId, agentId, error: err instanceof Error ? err.message : String(err) });
  }

  return c.redirect(`/dashboard/missions/${missionId}?saved=1`);
});

folderMissionsPage.post("/:id/decision", async (c) => {
  const missionId = c.req.param("id");
  if (!isValidMissionId(missionId)) {
    return c.text("Invalid mission id", 400);
  }
  const missionsDir = resolve(config.missionsDir);
  const missionPath = resolve(missionsDir, missionId);
  const body = await c.req.parseBody();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";

  if (title && decision) {
    try {
      MissionWriter.appendDecision(missionPath, {
        title,
        decision,
        rationale: rationale || "No rationale provided",
        decidedBy: "Director",
      });
    } catch (err: unknown) {
      logger.error("Failed to record decision", { missionId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return c.redirect(`/dashboard/missions/${missionId}?saved=1`);
});

folderMissionsPage.post("/:id/reset", async (c) => {
  const missionId = c.req.param("id");
  if (!isValidMissionId(missionId)) {
    return c.text("Invalid mission id", 400);
  }
  const missionsDir = resolve(config.missionsDir);
  const missionPath = resolve(missionsDir, missionId);

  try {
    MissionWriter.updateBriefStatus(missionPath, 'pending');
    MissionWriter.appendProgress(missionPath, {
      phase: 'reset',
      agent: 'director',
      summary: 'Mission reset to pending for retry.',
    });
  } catch (err: unknown) {
    logger.error("Failed to reset mission", { missionId, error: err instanceof Error ? err.message : String(err) });
  }

  return c.redirect(`/dashboard/missions/${missionId}?saved=1`);
});

folderMissionsPage.post("/:id/complete", async (c) => {
  const missionId = c.req.param("id");
  if (!isValidMissionId(missionId)) {
    return c.text("Invalid mission id", 400);
  }
  const missionsDir = resolve(config.missionsDir);
  const body = await c.req.parseBody();
  const summary = typeof body.summary === "string" ? body.summary.trim() : "Completed via dashboard.";

  try {
    MissionManager.complete(missionsDir, missionId, summary);
  } catch (err: unknown) {
    logger.error("Failed to complete mission", { missionId, error: err instanceof Error ? err.message : String(err) });
  }

  return c.redirect(`/dashboard/missions/${missionId}?saved=1`);
});
