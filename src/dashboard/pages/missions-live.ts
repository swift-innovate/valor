import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { natsState } from "../nats-state.js";
import type { DashboardMission } from "../nats-state.js";
import { getAuthUser } from "../../auth/index.js";

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

// ── Mission row ──────────────────────────────────────────────────────

function missionRow(m: DashboardMission) {
  const priorityClass = PRIORITY_COLORS[m.priority] ?? PRIORITY_COLORS.P2;

  return html`
    <tr class="border-b border-gray-800 hover:bg-gray-800/50 transition-colors" data-mission="${m.mission_id}">
      <td class="px-4 py-3">
        <div class="font-mono text-sm text-valor-400">${m.mission_id}</div>
        <div class="text-xs text-gray-500 mt-0.5">${formatDate(m.created_at)}</div>
      </td>
      
      <td class="px-4 py-3">
        <div class="font-medium text-gray-200">${m.title}</div>
        ${m.latest_sitrep
          ? html`<div class="text-xs text-gray-500 mt-1 italic line-clamp-2">${m.latest_sitrep}</div>`
          : ""}
      </td>

      <td class="px-4 py-3">
        <span class="text-sm ${priorityClass}">${m.priority}</span>
      </td>

      <td class="px-4 py-3">
        <div class="text-sm text-gray-300">${m.assigned_to}</div>
      </td>

      <td class="px-4 py-3">
        ${statusBadge(m.status)}
      </td>

      <td class="px-4 py-3">
        ${m.progress_pct !== null
          ? html`
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-gray-800 rounded-full h-2">
                  <div class="bg-valor-500 h-2 rounded-full" style="width: ${m.progress_pct}%"></div>
                </div>
                <span class="text-xs text-gray-500 w-10 text-right">${m.progress_pct}%</span>
              </div>
            `
          : html`<span class="text-xs text-gray-600">—</span>`}
      </td>

      <td class="px-4 py-3">
        ${m.blockers.length > 0
          ? html`
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900 text-yellow-300">
                ⚠️ ${m.blockers.length} blocker${m.blockers.length > 1 ? "s" : ""}
              </span>
            `
          : ""}
        ${m.artifacts.length > 0
          ? html`
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900 text-blue-300">
                📎 ${m.artifacts.length}
              </span>
            `
          : ""}
      </td>
    </tr>`;
}

// ── Route handler ────────────────────────────────────────────────────

missionsPage.get("/", (c) => {
  const statusFilter = c.req.query("status");
  const operativeFilter = c.req.query("operative");

  let missions = natsState.getMissions({
    status: statusFilter as any,
    operative: operativeFilter,
  });

  const stats = natsState.getStats();
  const operatives = natsState.getOperatives();

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Mission Board — Live</h1>
        <div id="connection-status" class="flex items-center gap-2 text-xs">
          <span class="w-2 h-2 rounded-full bg-gray-500" id="status-dot"></span>
          <span id="status-text" class="text-gray-500">Connecting...</span>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <a href="?status=pending" class="block bg-gray-900 rounded-lg border border-gray-800 p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-blue-400" id="stat-pending">${stats.missions.pending}</div>
          <div class="text-xs text-gray-500 uppercase">Pending</div>
        </a>
        <a href="?status=active" class="block bg-gray-900 rounded-lg border border-gray-800 p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-purple-400" id="stat-active">${stats.missions.active}</div>
          <div class="text-xs text-gray-500 uppercase">Active</div>
        </a>
        <a href="?status=blocked" class="block bg-gray-900 rounded-lg border border-gray-800 p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-yellow-400" id="stat-blocked">${stats.missions.blocked}</div>
          <div class="text-xs text-gray-500 uppercase">Blocked</div>
        </a>
        <a href="?status=complete" class="block bg-gray-900 rounded-lg border border-gray-800 p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-green-400" id="stat-complete">${stats.missions.complete}</div>
          <div class="text-xs text-gray-500 uppercase">Complete</div>
        </a>
        <a href="?status=failed" class="block bg-gray-900 rounded-lg border border-gray-800 p-3 hover:border-valor-500 transition-colors">
          <div class="text-lg font-bold text-red-400" id="stat-failed">${stats.missions.failed}</div>
          <div class="text-xs text-gray-500 uppercase">Failed</div>
        </a>
      </div>

      <!-- Filters -->
      <div class="flex items-center gap-3 flex-wrap">
        <a href="/dashboard/missions" 
           class="${!statusFilter && !operativeFilter ? "bg-valor-600" : "bg-gray-800"} px-3 py-1.5 rounded text-xs font-medium hover:bg-valor-700 transition-colors">
          All Missions
        </a>
        ${operatives
          .filter((op) => op.status !== "OFFLINE")
          .map(
            (op) => html`
              <a href="?operative=${op.callsign}" 
                 class="${operativeFilter === op.callsign ? "bg-valor-600" : "bg-gray-800"} px-3 py-1.5 rounded text-xs font-medium hover:bg-valor-700 transition-colors">
                ${op.callsign}
              </a>
            `
          )}
      </div>

      <!-- Mission table -->
      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-800">
            <thead class="bg-gray-800/50">
              <tr>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Mission ID
                </th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Title
                </th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Priority
                </th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Operative
                </th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Progress
                </th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody id="missions-tbody" class="bg-gray-900 divide-y divide-gray-800">
              ${missions.length === 0
                ? html`
                    <tr>
                      <td colspan="7" class="px-4 py-8 text-center text-gray-500 text-sm">
                        No missions found${statusFilter ? ` with status "${statusFilter}"` : ""}${operativeFilter ? ` assigned to ${operativeFilter}` : ""}.
                      </td>
                    </tr>
                  `
                : missions.map(missionRow)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SSE Client Script -->
    <script>
      (function() {
        let eventSource = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const reconnectDelay = 2000;

        function updateConnectionStatus(connected) {
          const dot = document.getElementById('status-dot');
          const text = document.getElementById('status-text');
          if (connected) {
            dot.className = 'w-2 h-2 rounded-full bg-green-500';
            text.textContent = 'Connected';
            text.className = 'text-green-500';
          } else {
            dot.className = 'w-2 h-2 rounded-full bg-red-500';
            text.textContent = 'Disconnected';
            text.className = 'text-red-500';
          }
        }

        function connect() {
          console.log('[SSE] Connecting to dashboard/sse...');
          eventSource = new EventSource('/dashboard/sse');

          eventSource.addEventListener('connected', (e) => {
            console.log('[SSE] Connected:', e.data);
            updateConnectionStatus(true);
            reconnectAttempts = 0;
          });

          eventSource.addEventListener('initial-state', (e) => {
            const state = JSON.parse(e.data);
            console.log('[SSE] Initial state received:', state);
            // Update stats
            updateStats(state.stats);
          });

          eventSource.addEventListener('mission.updated', (e) => {
            const mission = JSON.parse(e.data);
            console.log('[SSE] Mission updated:', mission);
            // Reload page to update mission list
            // TODO: Update DOM directly without full reload
            setTimeout(() => location.reload(), 500);
          });

          eventSource.addEventListener('sitrep.received', (e) => {
            const sitrep = JSON.parse(e.data);
            console.log('[SSE] Sitrep received:', sitrep);
            // Reload page to update mission list
            // TODO: Update DOM directly without full reload
            setTimeout(() => location.reload(), 500);
          });

          eventSource.addEventListener('ping', (e) => {
            // Silent ping to keep connection alive
          });

          eventSource.onerror = (err) => {
            console.error('[SSE] Connection error:', err);
            updateConnectionStatus(false);
            eventSource.close();

            if (reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++;
              console.log(\`[SSE] Reconnecting (attempt \${reconnectAttempts}/\${maxReconnectAttempts})...\`);
              setTimeout(connect, reconnectDelay * reconnectAttempts);
            } else {
              console.error('[SSE] Max reconnect attempts reached');
            }
          };
        }

        function updateStats(stats) {
          if (!stats) return;
          document.getElementById('stat-pending').textContent = stats.missions.pending;
          document.getElementById('stat-active').textContent = stats.missions.active;
          document.getElementById('stat-blocked').textContent = stats.missions.blocked;
          document.getElementById('stat-complete').textContent = stats.missions.complete;
          document.getElementById('stat-failed').textContent = stats.missions.failed;
        }

        // Start connection
        connect();

        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
          if (eventSource) {
            eventSource.close();
          }
        });
      })();
    </script>`;

  return c.html(layout("Missions", "/dashboard/missions", content, getAuthUser(c)));
});
