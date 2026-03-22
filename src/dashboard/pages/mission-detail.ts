/**
 * Mission Detail View — Full mission information with sitrep timeline,
 * artifacts, actions (cancel/retry/reassign/archive).
 *
 * Mission: VM-025
 * Operative: Mira
 */

import { Hono } from "hono";
import { html, raw } from "hono/html";
import { layout } from "../layout.js";
import { natsState } from "../nats-state.js";
import type { DashboardMission, DashboardSitrep } from "../nats-state.js";
import { getAuthUser } from "../../auth/index.js";

export const missionDetailPage = new Hono();

// ── Status colors ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending:  { bg: "bg-blue-900/50",   text: "text-blue-300",   border: "border-blue-700" },
  active:   { bg: "bg-purple-900/50", text: "text-purple-300", border: "border-purple-700" },
  blocked:  { bg: "bg-yellow-900/50", text: "text-yellow-300", border: "border-yellow-700" },
  complete: { bg: "bg-green-900/50",  text: "text-green-300",  border: "border-green-700" },
  failed:   { bg: "bg-red-900/50",    text: "text-red-300",    border: "border-red-700" },
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "text-red-400 font-bold",
  P1: "text-orange-400 font-semibold",
  P2: "text-gray-300",
  P3: "text-gray-500",
};

const TERMINAL_STATUSES = new Set(["complete", "failed"]);

// ── Helpers ──────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return html`<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${c.bg} ${c.text} border ${c.border}">${status.toUpperCase()}</span>`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Sitrep timeline ──────────────────────────────────────────────────

function sitrepTimeline(sitreps: DashboardSitrep[]) {
  if (sitreps.length === 0) {
    return html`<div class="text-gray-500 text-sm italic py-4">No sitreps yet</div>`;
  }

  const statusIcon: Record<string, string> = {
    ACCEPTED: "🟢",
    IN_PROGRESS: "🔵",
    BLOCKED: "🟡",
    COMPLETE: "✅",
    FAILED: "❌",
  };

  return html`
    <div class="space-y-0">
      ${sitreps.map(
        (s, i) => html`
          <div class="relative pl-8 pb-6 ${i < sitreps.length - 1 ? "border-l-2 border-gray-800 ml-3" : "ml-3"}">
            <div class="absolute left-0 top-0 w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-sm -translate-x-[10px]">
              ${statusIcon[s.status] ?? "📋"}
            </div>
            <div class="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-medium ${
                  s.status === "COMPLETE"
                    ? "text-green-400"
                    : s.status === "FAILED"
                    ? "text-red-400"
                    : s.status === "BLOCKED"
                    ? "text-yellow-400"
                    : "text-blue-400"
                }">${s.status}</span>
                <span class="text-xs text-gray-500" title="${formatDate(s.timestamp)}">${formatRelative(s.timestamp)}</span>
              </div>
              <div class="text-sm text-gray-300">${s.summary}</div>
              ${s.progress_pct !== null
                ? html`
                    <div class="mt-2 flex items-center gap-2">
                      <div class="flex-1 bg-gray-700 rounded-full h-1.5">
                        <div class="bg-valor-500 h-1.5 rounded-full transition-all" style="width: ${s.progress_pct}%"></div>
                      </div>
                      <span class="text-xs text-gray-500">${s.progress_pct}%</span>
                    </div>
                  `
                : ""}
              ${s.blockers.length > 0
                ? html`
                    <div class="mt-2 space-y-1">
                      ${s.blockers.map(
                        (b) =>
                          html`<div class="text-xs text-yellow-400/80">⚠️ ${b}</div>`
                      )}
                    </div>
                  `
                : ""}
              ${s.artifacts.length > 0
                ? html`
                    <div class="mt-2 space-y-1">
                      ${s.artifacts.map(
                        (a) =>
                          html`<div class="text-xs text-blue-400/80">📎 ${a}</div>`
                      )}
                    </div>
                  `
                : ""}
            </div>
          </div>
        `
      )}
    </div>
  `;
}

// ── Action buttons ───────────────────────────────────────────────────

function actionButtons(m: DashboardMission, operatives: string[]) {
  const isTerminal = TERMINAL_STATUSES.has(m.status);

  return html`
    <div class="flex flex-wrap items-center gap-2">
      ${!isTerminal
        ? html`
            <button onclick="cancelMission('${m.mission_id}')"
              class="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-900/50 hover:bg-red-800 text-red-300 border border-red-700/50 transition-colors">
              ✕ Cancel
            </button>
          `
        : ""}
      ${m.status === "failed"
        ? html`
            <button onclick="retryMission('${m.mission_id}')"
              class="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-700/50 transition-colors">
              ↻ Retry
            </button>
          `
        : ""}
      ${!isTerminal
        ? html`
            <div class="relative inline-block">
              <select onchange="reassignMission('${m.mission_id}', this.value); this.value='';"
                class="appearance-none bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 pr-8 cursor-pointer hover:border-valor-500 transition-colors">
                <option value="">↗ Reassign...</option>
                ${operatives
                  .filter((op) => op !== m.assigned_to)
                  .map((op) => html`<option value="${op}">${op}</option>`)}
              </select>
            </div>
          `
        : ""}
      ${isTerminal
        ? html`
            <button onclick="archiveMission('${m.mission_id}')"
              class="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700/50 hover:bg-gray-600 text-gray-300 border border-gray-600/50 transition-colors">
              📦 Archive
            </button>
          `
        : ""}
    </div>
  `;
}

// ── Route handler ────────────────────────────────────────────────────

missionDetailPage.get("/:id", (c) => {
  const missionId = c.req.param("id");
  const mission = natsState.getMission(missionId);

  if (!mission) {
    const content = html`
      <div class="fade-in text-center py-16">
        <div class="text-4xl mb-4">🔍</div>
        <h2 class="text-xl font-bold text-gray-300 mb-2">Mission Not Found</h2>
        <p class="text-gray-500 mb-6">No active mission with ID <code class="text-valor-400">${missionId}</code></p>
        <a href="/dashboard/missions" class="text-valor-400 hover:text-valor-300 transition-colors">← Back to Mission Board</a>
      </div>
    `;
    return c.html(layout("Mission Not Found", "/dashboard/missions", content, getAuthUser(c)));
  }

  const sitreps = natsState.getSitrepHistory(missionId);
  const operatives = natsState.getOperatives().map((o) => o.callsign);
  const verdicts = natsState.getVerdicts().filter((v) => v.mission_id === missionId);
  const sc = STATUS_COLORS[mission.status] ?? STATUS_COLORS.pending;
  const priorityClass = PRIORITY_COLORS[mission.priority] ?? PRIORITY_COLORS.P2;

  const content = html`
    <div class="fade-in space-y-6">
      <!-- Header -->
      <div class="flex items-start justify-between flex-wrap gap-4">
        <div>
          <a href="/dashboard/missions" class="text-xs text-gray-500 hover:text-valor-400 transition-colors mb-2 inline-block">← Mission Board</a>
          <h1 class="text-xl font-bold text-gray-100">${mission.title}</h1>
          <div class="flex items-center gap-3 mt-2">
            <span class="font-mono text-sm text-valor-400">${mission.mission_id}</span>
            ${statusBadge(mission.status)}
            <span class="text-sm ${priorityClass}">${mission.priority}</span>
          </div>
        </div>
        ${actionButtons(mission, operatives)}
      </div>

      <!-- Key info grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Assigned To</div>
          <div class="mt-1 text-lg font-medium text-gray-200">${mission.assigned_to}</div>
        </div>
        <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Created</div>
          <div class="mt-1 text-sm text-gray-300">${formatDate(mission.created_at)}</div>
        </div>
        <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Started</div>
          <div class="mt-1 text-sm text-gray-300">${mission.started_at ? formatDate(mission.started_at) : "—"}</div>
        </div>
        <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Completed</div>
          <div class="mt-1 text-sm text-gray-300">${mission.completed_at ? formatDate(mission.completed_at) : "—"}</div>
        </div>
      </div>

      <!-- Progress bar -->
      ${mission.progress_pct !== null
        ? html`
            <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-gray-500 uppercase tracking-wide">Progress</span>
                <span class="text-sm font-medium text-gray-300">${mission.progress_pct}%</span>
              </div>
              <div class="w-full bg-gray-800 rounded-full h-3">
                <div class="bg-valor-500 h-3 rounded-full transition-all duration-500"
                     style="width: ${mission.progress_pct}%"></div>
              </div>
            </div>
          `
        : ""}

      <!-- Description -->
      <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Description</h2>
        <div class="text-sm text-gray-300 whitespace-pre-wrap">${mission.description || "No description provided."}</div>
      </div>

      <!-- Two-column layout: Sitreps + Sidebar -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Sitrep Timeline (2/3 width) -->
        <div class="lg:col-span-2 bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">
            Sitrep Timeline
            <span class="text-gray-600 font-normal ml-1">(${sitreps.length})</span>
          </h2>
          ${sitrepTimeline(sitreps)}
        </div>

        <!-- Sidebar (1/3 width) -->
        <div class="space-y-4">
          <!-- Artifacts -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
              Artifacts
              <span class="text-gray-600 font-normal ml-1">(${mission.artifacts.length})</span>
            </h2>
            ${mission.artifacts.length === 0
              ? html`<div class="text-gray-500 text-sm italic">No artifacts yet</div>`
              : html`
                  <div class="space-y-2">
                    ${mission.artifacts.map(
                      (a) => html`
                        <div class="flex items-center gap-2 text-sm">
                          <span class="text-blue-400">📎</span>
                          <span class="text-gray-300 break-all">${a}</span>
                        </div>
                      `
                    )}
                  </div>
                `}
          </div>

          <!-- Blockers -->
          ${mission.blockers.length > 0
            ? html`
                <div class="bg-gray-900 rounded-lg border border-yellow-800/50 p-4">
                  <h2 class="text-sm font-medium text-yellow-400 uppercase tracking-wide mb-3">
                    ⚠️ Blockers
                    <span class="text-yellow-600 font-normal ml-1">(${mission.blockers.length})</span>
                  </h2>
                  <div class="space-y-2">
                    ${mission.blockers.map(
                      (b) => html`<div class="text-sm text-yellow-300/80">${b}</div>`
                    )}
                  </div>
                </div>
              `
            : ""}

          <!-- Review Verdicts -->
          ${verdicts.length > 0
            ? html`
                <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
                  <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Review Verdicts</h2>
                  <div class="space-y-3">
                    ${verdicts.map(
                      (v) => html`
                        <div class="border-l-2 ${
                          v.decision === "APPROVE"
                            ? "border-green-500"
                            : v.decision === "RETRY"
                            ? "border-yellow-500"
                            : "border-red-500"
                        } pl-3">
                          <div class="flex items-center justify-between">
                            <span class="text-sm font-medium ${
                              v.decision === "APPROVE"
                                ? "text-green-400"
                                : v.decision === "RETRY"
                                ? "text-yellow-400"
                                : "text-red-400"
                            }">${v.decision}</span>
                            <span class="text-xs text-gray-500">${formatRelative(v.timestamp)}</span>
                          </div>
                          <div class="text-xs text-gray-400 mt-1">${v.reasoning}</div>
                        </div>
                      `
                    )}
                  </div>
                </div>
              `
            : ""}
        </div>
      </div>
    </div>

    <script>
      async function cancelMission(id) {
        if (!confirm('Cancel mission ' + id + '? This cannot be undone.')) return;
        const res = await fetch('/api/missions-live/' + id + '/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          showToast('Mission cancelled', 'success');
          setTimeout(() => location.reload(), 500);
        } else {
          const d = await res.json();
          showToast(d.error || 'Cancel failed', 'error');
        }
      }

      async function retryMission(id) {
        if (!confirm('Retry mission ' + id + '?')) return;
        const res = await fetch('/api/missions-live/' + id + '/retry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          showToast('Mission queued for retry', 'success');
          setTimeout(() => location.reload(), 500);
        } else {
          const d = await res.json();
          showToast(d.error || 'Retry failed', 'error');
        }
      }

      async function reassignMission(id, operative) {
        if (!operative) return;
        if (!confirm('Reassign mission ' + id + ' to ' + operative + '?')) return;
        const res = await fetch('/api/missions-live/' + id + '/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operative }),
        });
        if (res.ok) {
          showToast('Mission reassigned to ' + operative, 'success');
          setTimeout(() => location.reload(), 500);
        } else {
          const d = await res.json();
          showToast(d.error || 'Reassign failed', 'error');
        }
      }

      async function archiveMission(id) {
        if (!confirm('Archive mission ' + id + '?')) return;
        const res = await fetch('/api/missions-live/' + id + '/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          showToast('Mission archived', 'success');
          setTimeout(() => window.location.href = '/dashboard/missions', 500);
        } else {
          const d = await res.json();
          showToast(d.error || 'Archive failed', 'error');
        }
      }
    </script>
  `;

  return c.html(layout(`Mission ${missionId}`, "/dashboard/missions", content, getAuthUser(c)));
});
