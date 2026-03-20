import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listDivisions, getDivision, getRoster, listAgents } from "../../db/index.js";
import type { Division } from "../../types/index.js";

export const divisionsPage = new Hono();

// ── Role badge ──────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  lead:      "bg-valor-900 text-valor-300 border border-valor-700",
  member:    "bg-gray-800 text-gray-300",
  operative: "bg-indigo-900 text-indigo-300",
};

function roleBadge(role: string) {
  return html`<span class="text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role] ?? ROLE_COLORS.member}">
    ${role}
  </span>`;
}

// ── Division card ───────────────────────────────────────────────────

function divisionCard(div: Division) {
  const roster = getRoster(div.id);
  const lead = roster.find((r) => r.role === "lead");
  const memberCount = roster.length;

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 fade-in" id="div-${div.id}">
      <!-- Header -->
      <div class="p-4 border-b border-gray-800">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-gray-100 truncate">${div.name}</h3>
            <div class="text-xs text-gray-500 mt-0.5 font-mono">${div.namespace}</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs text-gray-500">${memberCount} member${memberCount !== 1 ? "s" : ""}</span>
            <button
              onclick="deleteDivision('${div.id}', '${div.name.replace(/'/g, "\\'")}')"
              class="px-2 py-1 text-xs rounded bg-red-900 hover:bg-red-700 text-red-300 transition-colors">
              Delete
            </button>
          </div>
        </div>

        <!-- Lead -->
        <div class="mt-2 text-xs flex items-center gap-1.5">
          <span class="text-gray-500">Lead:</span>
          <span class="text-gray-300">${lead ? lead.callsign : html`<span class="text-gray-600 italic">unassigned</span>`}</span>
        </div>

        <!-- Policy summary -->
        <div class="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          <span>Budget: <span class="text-gray-400">$${div.autonomy_policy.max_cost_autonomous_usd}</span></span>
          <span>Auto-dispatch: <span class="${div.autonomy_policy.auto_dispatch_enabled ? "text-green-400" : "text-red-400"}">${div.autonomy_policy.auto_dispatch_enabled ? "on" : "off"}</span></span>
          <span>Escalate after: <span class="text-gray-400">${div.escalation_policy.escalate_after_failures} failures</span></span>
        </div>
      </div>

      <!-- Roster -->
      <div class="p-3">
        <div class="text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">Roster</div>
        ${roster.length === 0
          ? html`<p class="text-xs text-gray-600 italic px-1">No members</p>`
          : html`<div class="space-y-1">
              ${roster.map((m) => html`
                <div class="flex items-center justify-between px-2 py-1.5 rounded bg-gray-800/50 group">
                  <div class="flex items-center gap-2 min-w-0">
                    ${roleBadge(m.role)}
                    <span class="text-xs text-gray-200 truncate">${m.callsign}</span>
                  </div>
                  <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    ${m.role !== "lead" ? html`
                      <button
                        onclick="transferLead('${div.id}', '${m.agent_id}')"
                        title="Make lead"
                        class="px-1.5 py-0.5 text-xs rounded bg-valor-900 hover:bg-valor-700 text-valor-300 transition-colors">
                        ↑ Lead
                      </button>
                    ` : ""}
                    ${m.role !== "lead" ? html`
                      <button
                        onclick="removeMember('${div.id}', '${m.agent_id}', '${m.callsign.replace(/'/g, "\\'")}')"
                        title="Remove from division"
                        class="px-1.5 py-0.5 text-xs rounded bg-gray-700 hover:bg-red-900 text-gray-400 hover:text-red-300 transition-colors">
                        ✕
                      </button>
                    ` : ""}
                  </div>
                </div>`)}
            </div>`}

        <!-- Add member -->
        <div class="mt-2 pt-2 border-t border-gray-800/50">
          <div class="flex gap-2">
            <select id="add-agent-${div.id}"
              class="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 min-w-0">
              <option value="">Add agent…</option>
              ${listAgents({}).filter((a) => !roster.some((r) => r.agent_id === a.id)).map(
                (a) => html`<option value="${a.id}">${a.callsign}</option>`,
              )}
            </select>
            <select id="add-role-${div.id}"
              class="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 w-28">
              <option value="member">member</option>
              <option value="operative">operative</option>
            </select>
            <button
              onclick="addMember('${div.id}')"
              class="px-3 py-1.5 text-xs rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors whitespace-nowrap">
              Add
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Create division form ─────────────────────────────────────────────

const createForm = html`
  <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
    <h2 class="text-sm font-semibold text-gray-100 mb-3">Create Division</h2>
    <div class="grid sm:grid-cols-2 gap-3">
      <div>
        <label class="block text-xs text-gray-400 mb-1">Name</label>
        <input id="new-name" type="text" placeholder="Code Division"
          class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-valor-500">
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">Namespace</label>
        <input id="new-namespace" type="text" placeholder="code"
          class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-valor-500">
      </div>
    </div>
    <div class="mt-3 flex justify-end">
      <button onclick="createDivision()"
        class="px-4 py-1.5 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">
        Create
      </button>
    </div>
  </div>`;

// ── Route ────────────────────────────────────────────────────────────

divisionsPage.get("/", (c) => {
  const divisions = listDivisions();

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Divisions</h1>
        <span class="text-sm text-gray-500">${divisions.length} division${divisions.length !== 1 ? "s" : ""}</span>
      </div>

      ${createForm}

      ${divisions.length === 0
        ? html`<p class="text-gray-500 text-sm">No divisions yet. Create one above.</p>`
        : html`<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${divisions.map((d) => divisionCard(d))}
          </div>`}
    </div>

    <script>
      async function createDivision() {
        const name = document.getElementById('new-name').value.trim();
        const namespace = document.getElementById('new-namespace').value.trim();
        if (!name || !namespace) { showToast('Name and namespace are required', 'error'); return; }
        const res = await fetch('/divisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify({ name, namespace }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to create', 'error'); }
      }

      async function deleteDivision(id, name) {
        if (!confirm('Delete division "' + name + '"? All members must be removed first.')) return;
        const res = await fetch('/divisions/' + id, {
          method: 'DELETE',
          headers: { 'X-VALOR-Role': 'director' },
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to delete', 'error'); }
      }

      async function addMember(divId) {
        const agentId = document.getElementById('add-agent-' + divId).value;
        const role = document.getElementById('add-role-' + divId).value;
        if (!agentId) { showToast('Select an agent', 'error'); return; }
        const res = await fetch('/divisions/' + divId + '/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify({ agent_id: agentId, role }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to add', 'error'); }
      }

      async function removeMember(divId, agentId, callsign) {
        if (!confirm('Remove ' + callsign + ' from division?')) return;
        const res = await fetch('/divisions/' + divId + '/members/' + agentId, {
          method: 'DELETE',
          headers: { 'X-VALOR-Role': 'director' },
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to remove', 'error'); }
      }

      async function transferLead(divId, agentId) {
        if (!confirm('Transfer division lead to this agent?')) return;
        const res = await fetch('/divisions/' + divId + '/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VALOR-Role': 'director' },
          body: JSON.stringify({ agent_id: agentId }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to transfer lead', 'error'); }
      }

      function onValorEvent(event) {
        if (event.type && event.type.startsWith('division.')) {
          location.reload();
        }
      }
    </script>`;

  return c.html(layout("Divisions", "/dashboard/divisions", content));
});
