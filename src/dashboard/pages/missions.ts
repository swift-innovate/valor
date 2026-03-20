import { Hono } from "hono";
import { html, raw } from "hono/html";
import { layout } from "../layout.js";
import { listMissions, listAgents, listDivisions, getAgent, getDivision } from "../../db/index.js";
import type { Mission, MissionStatus } from "../../types/index.js";
import { getAuthUser } from "../../auth/index.js";

export const missionsPage = new Hono();

// ── Status filter definitions ────────────────────────────────────────

const FILTER_STATUSES = [
  "all", "draft", "queued", "gated", "dispatched",
  "streaming", "complete", "aar_pending", "failed", "aborted",
] as const;

// ── Status color map ─────────────────────────────────────────────────

const STATUS_COLORS: Record<MissionStatus, { bg: string; text: string }> = {
  draft:        { bg: "bg-gray-700",    text: "text-gray-300" },
  queued:       { bg: "bg-blue-900",    text: "text-blue-300" },
  gated:        { bg: "bg-yellow-900",  text: "text-yellow-300" },
  dispatched:   { bg: "bg-indigo-900",  text: "text-indigo-300" },
  streaming:    { bg: "bg-purple-900",  text: "text-purple-300" },
  complete:     { bg: "bg-green-900",   text: "text-green-300" },
  aar_pending:  { bg: "bg-orange-900",  text: "text-orange-300" },
  aar_complete: { bg: "bg-emerald-900", text: "text-emerald-300" },
  failed:       { bg: "bg-red-900",     text: "text-red-300" },
  aborted:      { bg: "bg-gray-700",    text: "text-gray-400" },
  timed_out:    { bg: "bg-gray-700",    text: "text-gray-400" },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 font-semibold",
  high:     "text-orange-400 font-semibold",
  normal:   "text-gray-300",
  low:      "text-gray-500",
};

const TERMINAL_STATUSES = new Set<MissionStatus>([
  "complete", "aar_complete", "failed", "aborted", "timed_out",
]);

// ── Helpers ──────────────────────────────────────────────────────────

function statusBadge(status: MissionStatus) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}">${status}</span>`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Action buttons ───────────────────────────────────────────────────

function actionButtons(m: Mission) {
  const btns: ReturnType<typeof html>[] = [];

  if (m.status === "draft") {
    btns.push(html`<button onclick="missionAction('POST','queue','${m.id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors">Queue</button>`);
  }
  if (m.status === "queued") {
    btns.push(html`<button onclick="missionAction('POST','dispatch','${m.id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-indigo-700 hover:bg-indigo-600 text-white transition-colors">Dispatch</button>`);
  }
  if (m.status === "aar_pending") {
    btns.push(html`<button onclick="missionAar('${m.id}', true)"
      class="px-2 py-1 text-xs font-medium rounded bg-green-700 hover:bg-green-600 text-white transition-colors">✓ AAR</button>`);
    btns.push(html`<button onclick="missionAar('${m.id}', false)"
      class="px-2 py-1 text-xs font-medium rounded bg-red-900 hover:bg-red-700 text-red-300 transition-colors">✗ AAR</button>`);
  }
  if (!TERMINAL_STATUSES.has(m.status)) {
    btns.push(html`<button onclick="abortMission('${m.id}')"
      class="px-2 py-1 text-xs font-medium rounded bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white transition-colors">Abort</button>`);
  }

  return html`<div class="flex items-center gap-1.5 flex-wrap">${btns}</div>`;
}

// ── Route handler ────────────────────────────────────────────────────

missionsPage.get("/", (c) => {
  const status = c.req.query("status");
  const divisionFilter = c.req.query("division_id");
  const activeFilter = status || "all";

  const missions = listMissions({
    status: status ? (status as MissionStatus) : undefined,
    division_id: divisionFilter || undefined,
  });

  const agents = listAgents({});
  const divisions = listDivisions();

  // Build lookup maps for display
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const divMap = new Map(divisions.map((d) => [d.id, d]));

  // ── Filter bar ───────────────────────────────────────────────────

  const filterBar = html`
    <div class="flex flex-wrap items-center gap-2">
      ${FILTER_STATUSES.map((f) => {
        const isActive = f === activeFilter;
        const params = new URLSearchParams();
        if (f !== "all") params.set("status", f);
        if (divisionFilter) params.set("division_id", divisionFilter);
        const qs = params.toString();
        const href = `/dashboard/missions${qs ? `?${qs}` : ""}`;
        return html`<a href="${href}"
          class="px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            isActive ? "bg-valor-700 text-white" : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }">${f}</a>`;
      })}
      <span class="text-gray-700">|</span>
      <select onchange="window.location.href='/dashboard/missions' + (this.value ? '?division_id=' + this.value : '')"
        class="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded px-2 py-1">
        <option value="">All Divisions</option>
        ${divisions.map((d) => html`<option value="${d.id}" ${divisionFilter === d.id ? "selected" : ""}>${d.name}</option>`)}
      </select>
    </div>`;

  // ── Create mission form ──────────────────────────────────────────

  const createForm = html`
    <div class="bg-gray-900 rounded-lg border border-gray-800">
      <button onclick="toggleCreate()" id="create-toggle"
        class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:text-white transition-colors">
        <span>+ Create Mission</span>
        <span id="create-chevron" class="text-gray-500 text-xs">▼</span>
      </button>
      <div id="create-form" class="hidden border-t border-gray-800 p-4 space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-400 mb-1">Title <span class="text-red-400">*</span></label>
            <input id="c-title" type="text" placeholder="Mission title"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-400 mb-1">Objective <span class="text-red-400">*</span></label>
            <textarea id="c-objective" rows="3" placeholder="What does this mission need to accomplish?"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Priority</label>
            <select id="c-priority"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Max Revisions</label>
            <input id="c-revisions" type="number" value="3" min="1" max="10"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Division</label>
            <select id="c-division"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
              <option value="">— Unassigned —</option>
              ${divisions.map((d) => html`<option value="${d.id}">${d.name}</option>`)}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Assign Agent</label>
            <select id="c-agent"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
              <option value="">— Unassigned —</option>
              ${agents.map((a) => html`<option value="${a.id}">${a.callsign} (${a.runtime})</option>`)}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Constraints <span class="text-gray-600 font-normal">(one per line)</span></label>
            <textarea id="c-constraints" rows="2" placeholder="No external API calls&#10;Output must be idempotent"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Deliverables <span class="text-gray-600 font-normal">(one per line)</span></label>
            <textarea id="c-deliverables" rows="2" placeholder="Pull request URL&#10;Test coverage report"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-400 mb-1">Success Criteria <span class="text-gray-600 font-normal">(one per line)</span></label>
            <textarea id="c-success" rows="2" placeholder="All tests pass&#10;No regressions in existing functionality"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
        </div>
        <div class="flex items-center justify-end gap-3">
          <button onclick="toggleCreate()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
          <button onclick="createMission()"
            class="px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">
            Create Mission
          </button>
        </div>
      </div>
    </div>`;

  // ── Mission table ────────────────────────────────────────────────

  const missionRows = missions.length === 0
    ? html`<tr><td colspan="8" class="px-4 py-10 text-center text-gray-500 text-sm">
        No missions found${status ? html` with status <strong class="text-gray-400">${status}</strong>` : ""}
        ${divisionFilter ? html` in <strong class="text-gray-400">${divMap.get(divisionFilter)?.name ?? divisionFilter}</strong>` : ""}.
      </td></tr>`
    : missions.map((m) => {
        const agent = m.assigned_agent_id ? agentMap.get(m.assigned_agent_id) : null;
        const division = m.division_id ? divMap.get(m.division_id) : null;
        const canEdit = !TERMINAL_STATUSES.has(m.status);

        return html`
          <tr class="border-t border-gray-800 hover:bg-gray-800/40 transition-colors group">
            <!-- Title -->
            <td class="px-4 py-3">
              <div class="text-sm font-medium text-gray-200">${m.title}</div>
              <div class="text-xs text-gray-600 mt-0.5 font-mono">${m.id}</div>
            </td>
            <!-- Status -->
            <td class="px-4 py-3 whitespace-nowrap">${statusBadge(m.status)}</td>
            <!-- Priority -->
            <td class="px-4 py-3">
              ${canEdit
                ? html`<select
                    onchange="updateField('${m.id}', 'priority', this.value)"
                    class="bg-transparent border-0 text-xs font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-valor-500 rounded px-1 ${PRIORITY_COLORS[m.priority] ?? "text-gray-300"}">
                    ${["critical","high","normal","low"].map((p) => html`<option value="${p}" ${m.priority === p ? "selected" : ""}>${p}</option>`)}
                  </select>`
                : html`<span class="text-xs font-medium ${PRIORITY_COLORS[m.priority] ?? "text-gray-300"}">${m.priority}</span>`}
            </td>
            <!-- Division -->
            <td class="px-4 py-3">
              ${canEdit
                ? html`<select
                    onchange="updateField('${m.id}', 'division_id', this.value || null)"
                    class="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1 max-w-[140px] focus:outline-none focus:border-valor-500">
                    <option value="">None</option>
                    ${divisions.map((d) => html`<option value="${d.id}" ${m.division_id === d.id ? "selected" : ""}>${d.name}</option>`)}
                  </select>`
                : html`<span class="text-xs text-gray-400">${division?.name ?? "—"}</span>`}
            </td>
            <!-- Assigned Agent -->
            <td class="px-4 py-3">
              ${canEdit
                ? html`<select
                    onchange="updateField('${m.id}', 'assigned_agent_id', this.value || null)"
                    class="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1 max-w-[160px] focus:outline-none focus:border-valor-500">
                    <option value="">Unassigned</option>
                    ${agents.map((a) => html`<option value="${a.id}" ${m.assigned_agent_id === a.id ? "selected" : ""}>${a.callsign}</option>`)}
                  </select>`
                : html`<span class="text-xs text-gray-400">${agent?.callsign ?? "—"}</span>`}
            </td>
            <!-- Cost / Revisions -->
            <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
              <div>$${m.cost_usd.toFixed(4)}</div>
              <div class="text-gray-600">${m.revision_count}/${m.max_revisions} rev</div>
            </td>
            <!-- Created -->
            <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${formatDate(m.created_at)}</td>
            <!-- Actions -->
            <td class="px-4 py-3">${actionButtons(m)}</td>
          </tr>`;
      });

  const content = html`
    <div class="fade-in space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Mission Pipeline</h1>
        <span class="text-sm text-gray-500">${missions.length} mission${missions.length !== 1 ? "s" : ""}</span>
      </div>

      ${createForm}

      ${filterBar}

      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-x-auto">
        <table class="w-full min-w-[900px]">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Title</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Priority</th>
              <th class="px-4 py-3">Division</th>
              <th class="px-4 py-3">Agent</th>
              <th class="px-4 py-3">Cost / Rev</th>
              <th class="px-4 py-3">Created</th>
              <th class="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>${missionRows}</tbody>
        </table>
      </div>
    </div>

    <script>
      // ── Create mission ─────────────────────────────────────────────
      function toggleCreate() {
        const form = document.getElementById('create-form');
        const chev = document.getElementById('create-chevron');
        const hidden = form.classList.toggle('hidden');
        chev.textContent = hidden ? '▼' : '▲';
      }

      function lines(id) {
        return document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
      }

      async function createMission() {
        const title = document.getElementById('c-title').value.trim();
        const objective = document.getElementById('c-objective').value.trim();
        if (!title || !objective) { showToast('Title and objective are required', 'error'); return; }
        const body = {
          title,
          objective,
          priority: document.getElementById('c-priority').value,
          max_revisions: parseInt(document.getElementById('c-revisions').value, 10) || 3,
          division_id: document.getElementById('c-division').value || null,
          assigned_agent_id: document.getElementById('c-agent').value || null,
          constraints: lines('c-constraints'),
          deliverables: lines('c-deliverables'),
          success_criteria: lines('c-success'),
        };
        const res = await fetch('/missions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify(body),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to create', 'error'); }
      }

      // ── Inline update (priority, division, agent) ──────────────────
      async function updateField(id, field, value) {
        const res = await fetch('/missions/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) {
          const d = await res.json();
          showToast(d.error || 'Update failed', 'error');
          location.reload(); // reset select to actual value
        }
      }

      // ── Mission lifecycle actions ───────────────────────────────────
      async function missionAction(method, action, id) {
        const res = await fetch('/missions/' + id + '/' + action, {
          method,
          headers: { 'X-VALOR-Role': 'director' },
        });
        const d = await res.json();
        if (res.ok) { location.reload(); }
        else { showToast(d.error || 'Action failed', 'error'); }
      }

      async function missionAar(id, approved) {
        const res = await fetch('/missions/' + id + '/aar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'AAR failed', 'error'); }
      }

      async function abortMission(id) {
        if (!confirm('Abort this mission?')) return;
        const res = await fetch('/missions/' + id + '/abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify({ reason: 'Director abort' }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Abort failed', 'error'); }
      }

      // ── WebSocket handler ──────────────────────────────────────────
      function onValorEvent(event) {
        if (event.type && event.type.startsWith('mission.')) {
          location.reload();
        }
      }
    </script>`;

  return c.html(layout("Missions", "/dashboard/missions", content, getAuthUser(c)));
});
