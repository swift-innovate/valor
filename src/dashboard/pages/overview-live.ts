import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { natsState } from "../nats-state.js";
import { getAuthUser } from "../../auth/index.js";

export const overviewPage = new Hono();

// ── Stat card helper ────────────────────────────────────────────────

function statCard(label: string, value: string | number, sub?: string, id?: string) {
  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4" ${id ? `id="${id}"` : ""}>
      <div class="text-xs text-gray-500 uppercase tracking-wide">${label}</div>
      <div class="mt-1 text-2xl font-bold text-gray-100">${value}</div>
      ${sub ? html`<div class="mt-1 text-xs text-gray-500">${sub}</div>` : ""}
    </div>`;
}

// ── Operative card ──────────────────────────────────────────────────

function operativeCard(operative: ReturnType<typeof natsState.getOperative>) {
  if (!operative) return "";

  const statusColors = {
    IDLE: "bg-green-500",
    BUSY: "bg-yellow-500",
    ERROR: "bg-red-500",
    OFFLINE: "bg-gray-500",
  };

  const statusColor = statusColors[operative.status] || statusColors.OFFLINE;

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4 fade-in" data-operative="${operative.callsign}">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${statusColor}"></span>
          <h3 class="text-sm font-semibold text-gray-100">${operative.callsign}</h3>
        </div>
        <span class="text-xs text-gray-600 font-mono uppercase">${operative.status}</span>
      </div>

      ${operative.current_mission
        ? html`
            <div class="text-xs text-gray-400 mb-2">
              Working on: <span class="text-valor-400 font-mono">${operative.current_mission}</span>
            </div>
          `
        : html`<div class="text-xs text-gray-500 italic">Idle</div>`}

      ${operative.last_heartbeat
        ? html`
            <div class="text-xs text-gray-600 mt-2">
              Last seen: ${new Date(operative.last_heartbeat).toLocaleTimeString()}
            </div>
          `
        : ""}
    </div>`;
}

// ── Mission card (recent activity) ──────────────────────────────────

function missionCard(mission: ReturnType<typeof natsState.getMission>) {
  if (!mission) return "";

  const statusColors = {
    pending: "bg-blue-900 text-blue-300",
    active: "bg-purple-900 text-purple-300",
    blocked: "bg-yellow-900 text-yellow-300",
    complete: "bg-green-900 text-green-300",
    failed: "bg-red-900 text-red-300",
  };

  const statusClass = statusColors[mission.status] || statusColors.pending;

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4 fade-in" data-mission="${mission.mission_id}">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-mono text-gray-500">${mission.mission_id}</span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}">
          ${mission.status}
        </span>
      </div>

      <h4 class="text-sm font-semibold text-gray-100 mb-1">${mission.title}</h4>
      
      <div class="flex items-center gap-2 text-xs text-gray-500 mb-2">
        <span class="text-valor-400">${mission.assigned_to}</span>
        <span>•</span>
        <span>${mission.priority}</span>
      </div>

      ${mission.progress_pct !== null
        ? html`
            <div class="w-full bg-gray-800 rounded-full h-1.5 mb-2">
              <div class="bg-valor-500 h-1.5 rounded-full" style="width: ${mission.progress_pct}%"></div>
            </div>
          `
        : ""}

      ${mission.latest_sitrep
        ? html`<div class="text-xs text-gray-400 italic">${mission.latest_sitrep}</div>`
        : ""}
    </div>`;
}

// ── Event feed item ─────────────────────────────────────────────────

function eventItem(event: ReturnType<typeof natsState.getEvents>[0]) {
  const typeIcons: Record<string, string> = {
    "mission.dispatched": "📋",
    "sitrep": "📊",
    "agent.online": "🟢",
    "agent.offline": "🔴",
    "review.verdict": "⚖️",
    "system.startup": "🚀",
    "system.shutdown": "🛑",
  };

  const icon = typeIcons[event.event_type] || "•";

  return html`
    <div class="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0" data-event="${event.id}">
      <span class="text-lg">${icon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-gray-300">${event.summary}</div>
        <div class="text-xs text-gray-600 mt-0.5">
          ${new Date(event.timestamp).toLocaleTimeString()} • ${event.source}
        </div>
      </div>
    </div>`;
}

// ── Route handler ───────────────────────────────────────────────────

overviewPage.get("/", (c) => {
  const stats = natsState.getStats();
  const operatives = natsState.getOperatives();
  const recentMissions = natsState.getMissions().slice(0, 6);
  const recentEvents = natsState.getEvents(10);

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Mission Control — Live Overview</h1>
        <div id="connection-status" class="flex items-center gap-2 text-xs">
          <span class="w-2 h-2 rounded-full bg-gray-500" id="status-dot"></span>
          <span id="status-text" class="text-gray-500">Connecting...</span>
        </div>
      </div>

      <!-- Global stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        ${statCard("Operatives", stats.operatives.total, `${stats.operatives.online} online`, "stat-operatives")}
        ${statCard("Active Missions", stats.missions.active, `${stats.missions.total} total`, "stat-missions")}
        ${statCard("Pending", stats.missions.pending, "", "stat-pending")}
        ${statCard("Blocked", stats.missions.blocked, "", "stat-blocked")}
      </div>

      <!-- Two-column layout -->
      <div class="grid lg:grid-cols-2 gap-6">
        <!-- Left: Fleet Status -->
        <div>
          <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Fleet Status</h2>
          <div id="operatives-grid" class="grid gap-3">
            ${operatives.length === 0
              ? html`<p class="text-gray-500 text-sm">No operatives online.</p>`
              : operatives.map(operativeCard)}
          </div>
        </div>

        <!-- Right: Recent Activity -->
        <div class="space-y-6">
          <!-- Recent Missions -->
          <div>
            <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Recent Missions</h2>
            <div id="missions-grid" class="grid gap-3">
              ${recentMissions.length === 0
                ? html`<p class="text-gray-500 text-sm">No recent missions.</p>`
                : recentMissions.map(missionCard)}
            </div>
          </div>

          <!-- Activity Feed -->
          <div>
            <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Activity Feed</h2>
            <div id="event-feed" class="bg-gray-900 rounded-lg border border-gray-800 p-4 max-h-96 overflow-y-auto">
              ${recentEvents.length === 0
                ? html`<p class="text-gray-500 text-sm">No recent activity.</p>`
                : recentEvents.map(eventItem)}
            </div>
          </div>
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
            if (state.stats) updateStats(state.stats);
          });

          eventSource.addEventListener('mission.updated', (e) => {
            const mission = JSON.parse(e.data);
            console.log('[SSE] Mission updated:', mission);
            updateMissionCard(mission);
          });

          eventSource.addEventListener('operative.updated', (e) => {
            const operative = JSON.parse(e.data);
            console.log('[SSE] Operative updated:', operative);
            updateOperativeCard(operative);
          });

          eventSource.addEventListener('event.added', (e) => {
            const event = JSON.parse(e.data);
            console.log('[SSE] Event added:', event);
            prependEvent(event);
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
          const el = document.getElementById('stat-missions');
          if (el) el.querySelector('.text-2xl').textContent = stats.missions.active;
          const pending = document.getElementById('stat-pending');
          if (pending) pending.querySelector('.text-2xl').textContent = stats.missions.pending;
          const blocked = document.getElementById('stat-blocked');
          if (blocked) blocked.querySelector('.text-2xl').textContent = stats.missions.blocked;
        }

        function updateMissionCard(mission) {
          // Update existing card or ignore — avoids reload loop
          const card = document.querySelector('[data-mission="' + mission.mission_id + '"]');
          if (!card) return;
          const badge = card.querySelector('.rounded-full');
          if (badge) badge.textContent = mission.status;
        }

        function updateOperativeCard(operative) {
          const card = document.querySelector('[data-operative="' + operative.callsign + '"]');
          if (!card) return;
          const status = card.querySelector('.font-mono');
          if (status) status.textContent = operative.status;
        }

        function prependEvent(event) {
          const feed = document.getElementById('event-feed');
          if (!feed) return;
          const div = document.createElement('div');
          div.className = 'flex items-start gap-3 py-2 border-b border-gray-800';
          div.innerHTML = '<span class="text-lg">\\u2022</span><div class="flex-1 min-w-0"><div class="text-sm text-gray-300">' + (event.summary || '') + '</div><div class="text-xs text-gray-600 mt-0.5">' + new Date().toLocaleTimeString() + '</div></div>';
          feed.prepend(div);
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

  return c.html(layout("Overview", "/dashboard", content, getAuthUser(c)));
});
