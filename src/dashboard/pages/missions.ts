import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listMissions } from "../../db/index.js";
import type { Mission, MissionStatus } from "../../types/index.js";

export const missionsPage = new Hono();

// ── Status filter definitions ────────────────────────────────────────

const FILTER_STATUSES = [
  "all",
  "draft",
  "queued",
  "streaming",
  "complete",
  "aar_pending",
  "failed",
  "aborted",
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

// ── Priority badge ───────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400",
  high:     "text-orange-400",
  normal:   "text-gray-300",
  low:      "text-gray-500",
};

// ── Terminal statuses (no abort button) ──────────────────────────────

const TERMINAL_STATUSES: Set<MissionStatus> = new Set([
  "complete",
  "aar_complete",
  "failed",
  "aborted",
  "timed_out",
]);

// ── Helper: render a status badge ────────────────────────────────────

function statusBadge(status: MissionStatus) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color.bg} ${color.text}">
    ${status}
  </span>`;
}

// ── Helper: render action buttons for a mission ──────────────────────

function actionButtons(m: Mission) {
  const buttons: ReturnType<typeof html>[] = [];

  if (m.status === "draft") {
    buttons.push(html`<button
      onclick="apiCall('POST', '/missions/${m.id}/queue').then(() => location.reload())"
      class="px-2 py-1 text-xs font-medium rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors">
      Queue
    </button>`);
  }

  if (m.status === "queued") {
    buttons.push(html`<button
      onclick="apiCall('POST', '/missions/${m.id}/dispatch').then(() => location.reload())"
      class="px-2 py-1 text-xs font-medium rounded bg-indigo-700 hover:bg-indigo-600 text-white transition-colors">
      Dispatch
    </button>`);
  }

  if (m.status === "aar_pending") {
    buttons.push(html`<button
      onclick="apiCall('POST', '/missions/${m.id}/aar', {approved: true}).then(() => location.reload())"
      class="px-2 py-1 text-xs font-medium rounded bg-green-700 hover:bg-green-600 text-white transition-colors">
      Approve AAR
    </button>`);
    buttons.push(html`<button
      onclick="apiCall('POST', '/missions/${m.id}/aar', {approved: false}).then(() => location.reload())"
      class="px-2 py-1 text-xs font-medium rounded bg-red-700 hover:bg-red-600 text-white transition-colors">
      Reject AAR
    </button>`);
  }

  if (!TERMINAL_STATUSES.has(m.status)) {
    buttons.push(html`<button
      onclick="apiCall('POST', '/missions/${m.id}/abort', {reason: 'Director abort'}).then(() => location.reload())"
      class="px-2 py-1 text-xs font-medium rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
      Abort
    </button>`);
  }

  return html`<div class="flex items-center gap-2">${buttons}</div>`;
}

// ── Helper: format date ──────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Route handler ────────────────────────────────────────────────────

missionsPage.get("/", (c) => {
  const status = c.req.query("status");
  const activeFilter = status || "all";

  const missions = listMissions({
    status: status ? (status as MissionStatus) : undefined,
  });

  // ── Filter bar ───────────────────────────────────────────────────

  const filterBar = html`
    <div class="flex flex-wrap items-center gap-2 mb-6">
      ${FILTER_STATUSES.map((f) => {
        const isActive = f === activeFilter;
        const href = f === "all" ? "/dashboard/missions" : `/dashboard/missions?status=${f}`;
        return html`<a
          href="${href}"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            isActive
              ? "bg-valor-700 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }">
          ${f}
        </a>`;
      })}
    </div>`;

  // ── Mission list ─────────────────────────────────────────────────

  const missionRows =
    missions.length === 0
      ? html`<tr>
          <td colspan="6" class="px-4 py-8 text-center text-gray-500 text-sm">
            No missions found${status ? html` with status <strong>${status}</strong>` : ""}.
          </td>
        </tr>`
      : missions.map(
          (m) => html`
            <tr class="border-t border-gray-800 hover:bg-gray-800/50 transition-colors">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-gray-200">${m.title}</div>
                <div class="text-xs text-gray-500 mt-0.5">${m.id}</div>
              </td>
              <td class="px-4 py-3">${statusBadge(m.status)}</td>
              <td class="px-4 py-3">
                <span class="text-sm font-medium ${PRIORITY_COLORS[m.priority] ?? "text-gray-300"}">
                  ${m.priority}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-400">
                ${m.revision_count} / ${m.max_revisions}
              </td>
              <td class="px-4 py-3 text-sm text-gray-400">
                $${m.cost_usd.toFixed(4)}
              </td>
              <td class="px-4 py-3 text-sm text-gray-500">
                ${formatDate(m.created_at)}
              </td>
              <td class="px-4 py-3">${actionButtons(m)}</td>
            </tr>`,
        );

  const content = html`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold text-gray-100">Mission Pipeline</h1>
        <span class="text-sm text-gray-500">${missions.length} mission${missions.length !== 1 ? "s" : ""}</span>
      </div>

      ${filterBar}

      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Title</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Priority</th>
              <th class="px-4 py-3">Revisions</th>
              <th class="px-4 py-3">Cost</th>
              <th class="px-4 py-3">Created</th>
              <th class="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${missionRows}
          </tbody>
        </table>
      </div>
    </div>`;

  return c.html(layout("Missions", "/dashboard/missions", content));
});
