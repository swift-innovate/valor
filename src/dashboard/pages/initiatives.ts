import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import {
  listInitiatives,
  listMissions,
  getInitiativeProgress,
} from "../../db/index.js";
import { getAuthUser } from "../../auth/index.js";
import type { Initiative } from "../../db/repositories/initiative-repo.js";
import type { Mission } from "../../types/index.js";

export const initiativesPage = new Hono();

// ── Helpers ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:    { bg: "bg-green-900",  text: "text-green-300" },
  paused:    { bg: "bg-yellow-900", text: "text-yellow-300" },
  complete:  { bg: "bg-blue-900",   text: "text-blue-300" },
  cancelled: { bg: "bg-gray-700",   text: "text-gray-400" },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 font-semibold",
  high:     "text-orange-400 font-semibold",
  normal:   "text-gray-300",
  low:      "text-gray-500",
};

const MISSION_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:       { bg: "bg-gray-800",    text: "text-gray-400" },
  queued:      { bg: "bg-blue-900",    text: "text-blue-300" },
  gated:       { bg: "bg-yellow-900",  text: "text-yellow-300" },
  dispatched:  { bg: "bg-purple-900",  text: "text-purple-300" },
  streaming:   { bg: "bg-valor-900",   text: "text-valor-300" },
  complete:    { bg: "bg-green-900",   text: "text-green-300" },
  aar_pending: { bg: "bg-blue-900",    text: "text-blue-300" },
  aar_complete:{ bg: "bg-teal-900",    text: "text-teal-300" },
  failed:      { bg: "bg-red-900",     text: "text-red-300" },
  aborted:     { bg: "bg-gray-700",    text: "text-gray-400" },
  timed_out:   { bg: "bg-orange-900",  text: "text-orange-300" },
};

function statusBadge(status: string) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.active;
  return html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}">${status}</span>`;
}

function missionStatusBadge(status: string) {
  const c = MISSION_STATUS_COLORS[status] ?? MISSION_STATUS_COLORS.draft;
  return html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}">${status}</span>`;
}

function progressBar(pct: number) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-valor-500" : "bg-gray-500";
  return html`
    <div class="flex items-center gap-2">
      <div class="flex-1 bg-gray-800 rounded-full h-2 min-w-[80px]">
        <div class="${color} h-2 rounded-full transition-all" style="width: ${pct}%"></div>
      </div>
      <span class="text-xs text-gray-400 w-10 text-right">${pct}%</span>
    </div>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ── Mission row within an initiative ─────────────────────────────────

function missionRow(m: Mission) {
  return html`
    <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer text-sm"
        onclick="window.location='/dashboard/missions/${m.id}'">
      <td class="px-3 py-2 font-mono text-xs text-gray-500">${m.id.slice(0, 12)}…</td>
      <td class="px-3 py-2 text-gray-300">${m.title}</td>
      <td class="px-3 py-2">
        <span class="text-xs ${PRIORITY_COLORS[m.priority] ?? PRIORITY_COLORS.normal}">${m.priority}</span>
      </td>
      <td class="px-3 py-2 text-xs text-gray-400">${m.assigned_agent_id ?? "—"}</td>
      <td class="px-3 py-2">${missionStatusBadge(m.status)}</td>
    </tr>`;
}

// ── Status action buttons ─────────────────────────────────────────────

function statusActions(initiative: Initiative) {
  const id = initiative.id;
  const btnBase = "px-3 py-1 text-xs rounded font-medium transition-colors";
  if (initiative.status === "active") {
    return html`
      <div class="flex items-center gap-2">
        <button onclick="updateStatus('${id}', 'paused')"
          class="${btnBase} bg-yellow-900 text-yellow-300 hover:bg-yellow-800">Pause</button>
        <button onclick="updateStatus('${id}', 'complete')"
          class="${btnBase} bg-blue-900 text-blue-300 hover:bg-blue-800">Complete</button>
        <button onclick="updateStatus('${id}', 'cancelled')"
          class="${btnBase} bg-gray-700 text-gray-400 hover:bg-gray-600">Cancel</button>
      </div>`;
  }
  if (initiative.status === "paused") {
    return html`
      <div class="flex items-center gap-2">
        <button onclick="updateStatus('${id}', 'active')"
          class="${btnBase} bg-green-900 text-green-300 hover:bg-green-800">Resume</button>
        <button onclick="updateStatus('${id}', 'cancelled')"
          class="${btnBase} bg-gray-700 text-gray-400 hover:bg-gray-600">Cancel</button>
      </div>`;
  }
  return html``;
}

// ── Initiative card ───────────────────────────────────────────────────

function initiativeCard(initiative: Initiative, missions: Mission[]) {
  const progress = getInitiativeProgress(initiative.id);
  const priorityClass = PRIORITY_COLORS[initiative.priority] ?? PRIORITY_COLORS.normal;
  const id = initiative.id;

  return html`
    <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden fade-in">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-gray-800">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 flex-wrap">
              <span class="font-mono text-xs text-gray-600">${id.slice(0, 14)}…</span>
              ${statusBadge(initiative.status)}
              <span class="text-xs ${priorityClass}">${initiative.priority}</span>
              ${initiative.target_date
                ? html`<span class="text-xs text-gray-500">Due ${formatDate(initiative.target_date)}</span>`
                : ""}
            </div>
            <h2 class="text-lg font-semibold text-gray-100 mt-1" id="title-display-${id}">${initiative.title}</h2>
            <p class="text-sm text-gray-400 mt-0.5 line-clamp-2" id="obj-display-${id}">${initiative.objective}</p>
          </div>
          <div class="text-right shrink-0 space-y-2">
            <div class="text-xs text-gray-500 mb-1">${progress.completed} / ${progress.total_missions} missions</div>
            ${progressBar(progress.progress_pct)}
            <div class="flex items-center justify-end gap-2 mt-2">
              ${statusActions(initiative)}
              ${initiative.status !== "complete" && initiative.status !== "cancelled"
                ? html`<button onclick="toggleEdit('${id}')"
                    class="px-3 py-1 text-xs rounded font-medium transition-colors bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200">Edit</button>`
                : ""}
            </div>
          </div>
        </div>
      </div>

      <!-- Inline edit form (hidden by default) -->
      <div id="edit-form-${id}" class="hidden border-b border-gray-800 px-5 py-4 bg-gray-950/50">
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-500 mb-1">Title</label>
            <input id="edit-title-${id}" type="text" value="${initiative.title}"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-500 mb-1">Objective</label>
            <textarea id="edit-objective-${id}" rows="2"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none">${initiative.objective}</textarea>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Priority</label>
            <select id="edit-priority-${id}"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none">
              ${(["critical", "high", "normal", "low"] as const).map((p) =>
                html`<option value="${p}" ${initiative.priority === p ? "selected" : ""}>${p}</option>`)}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Owner</label>
            <input id="edit-owner-${id}" type="text" value="${initiative.owner ?? ""}"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Target Date</label>
            <input id="edit-target-${id}" type="date" value="${initiative.target_date?.split("T")[0] ?? ""}"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none" />
          </div>
        </div>
        <div class="flex items-center justify-end gap-3 mt-4">
          <button onclick="toggleEdit('${id}')" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
          <button onclick="saveEdit('${id}')"
            class="px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">Save</button>
        </div>
      </div>

      <!-- Mission list -->
      ${missions.length > 0
        ? html`
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-800 text-xs text-gray-600 uppercase tracking-wider">
                  <th class="px-3 py-2 text-left">ID</th>
                  <th class="px-3 py-2 text-left">Title</th>
                  <th class="px-3 py-2 text-left">Priority</th>
                  <th class="px-3 py-2 text-left">Agent</th>
                  <th class="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                ${missions.map((m) => missionRow(m))}
              </tbody>
            </table>
          </div>`
        : html`<div class="px-5 py-4 text-sm text-gray-600 italic">No missions assigned yet.</div>`}
    </div>`;
}

// ── Route ─────────────────────────────────────────────────────────────

initiativesPage.get("/", (c) => {
  const user = getAuthUser(c);
  const statusFilter = c.req.query("status");

  const initiatives = listInitiatives(statusFilter ? { status: statusFilter as any } : undefined);

  // Fetch all DB missions and group by initiative_id
  const allMissions = listMissions({});
  const missionsByInitiative = new Map<string, Mission[]>();
  for (const m of allMissions) {
    const iid = (m as Mission & { initiative_id?: string | null }).initiative_id;
    if (iid) {
      const list = missionsByInitiative.get(iid) ?? [];
      list.push(m);
      missionsByInitiative.set(iid, list);
    }
  }

  const createForm = html`
    <div class="bg-gray-900 rounded-lg border border-gray-800">
      <button onclick="toggleCreate()" id="create-toggle"
        class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:text-white transition-colors">
        <span>+ Create Initiative</span>
        <span id="create-chevron" class="text-gray-500 text-xs">▼</span>
      </button>
      <div id="create-form" class="hidden border-t border-gray-800 p-4 space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-500 mb-1">Title <span class="text-red-400">*</span></label>
            <input id="c-title" type="text" placeholder="Initiative title"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-gray-500 mb-1">Objective <span class="text-red-400">*</span></label>
            <textarea id="c-objective" rows="2" placeholder="What should this initiative achieve?"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none"></textarea>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Priority</label>
            <select id="c-priority"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none">
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="normal" selected>normal</option>
              <option value="low">low</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Owner</label>
            <input id="c-owner" type="text" placeholder="Agent callsign or director"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Target Date</label>
            <input id="c-target-date" type="date"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-valor-500 focus:outline-none" />
          </div>
        </div>
        <div class="flex items-center justify-end gap-3">
          <button onclick="toggleCreate()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
          <button onclick="createInitiative()"
            class="px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">Create</button>
        </div>
      </div>
    </div>`;

  const content = html`
    <div class="fade-in space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <h1 class="text-xl font-bold text-gray-100">Initiatives</h1>
        <div class="flex items-center gap-2">
          ${(["active", "paused", "complete", "cancelled"] as const).map((s) =>
            html`<a href="/dashboard/initiatives?status=${s}"
              class="px-3 py-1 text-xs rounded-full transition-colors ${
                statusFilter === s
                  ? "bg-valor-700 text-white"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-400"
              }">${s}</a>`,
          )}
          <a href="/dashboard/initiatives"
            class="px-3 py-1 text-xs rounded-full transition-colors ${
              !statusFilter ? "bg-valor-700 text-white" : "bg-gray-800 hover:bg-gray-700 text-gray-400"
            }">all</a>
        </div>
      </div>

      ${createForm}

      ${initiatives.length === 0
        ? html`
          <div class="text-center py-16 text-gray-600">
            <div class="text-4xl mb-3">📋</div>
            <p class="text-sm">No initiatives found.</p>
            <p class="text-xs mt-1">Use the form above to create one.</p>
          </div>`
        : html`<div class="space-y-4">
            ${initiatives.map((ini) =>
              initiativeCard(ini, missionsByInitiative.get(ini.id) ?? []),
            )}
          </div>`}
    </div>

    <script>
      // ── Create initiative ─────────────────────────────────────────
      function toggleCreate() {
        const form = document.getElementById('create-form');
        const chev = document.getElementById('create-chevron');
        const hidden = form.classList.toggle('hidden');
        chev.textContent = hidden ? '▼' : '▲';
      }

      async function createInitiative() {
        const title = document.getElementById('c-title').value.trim();
        const objective = document.getElementById('c-objective').value.trim();
        if (!title || !objective) { showToast('Title and objective are required', 'error'); return; }
        const body = {
          title,
          objective,
          priority: document.getElementById('c-priority').value,
          owner: document.getElementById('c-owner').value.trim() || undefined,
          target_date: document.getElementById('c-target-date').value || undefined,
        };
        const res = await fetch('/initiatives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify(body),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to create initiative', 'error'); }
      }

      // ── Status update ─────────────────────────────────────────────
      async function updateStatus(id, status) {
        const res = await fetch('/initiatives/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify({ status }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Status update failed', 'error'); }
      }

      // ── Inline edit ───────────────────────────────────────────────
      function toggleEdit(id) {
        const form = document.getElementById('edit-form-' + id);
        form.classList.toggle('hidden');
      }

      async function saveEdit(id) {
        const title = document.getElementById('edit-title-' + id).value.trim();
        const objective = document.getElementById('edit-objective-' + id).value.trim();
        if (!title || !objective) { showToast('Title and objective are required', 'error'); return; }
        const body = {
          title,
          objective,
          priority: document.getElementById('edit-priority-' + id).value,
          owner: document.getElementById('edit-owner-' + id).value.trim() || null,
          target_date: document.getElementById('edit-target-' + id).value || null,
        };
        const res = await fetch('/initiatives/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify(body),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to update initiative', 'error'); }
      }
    </script>`;

  return c.html(layout("Initiatives", "/dashboard/initiatives", content, user));
});
