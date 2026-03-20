import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type HtmlContent = HtmlEscapedString | Promise<HtmlEscapedString>;

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: "grid" },
  { href: "/dashboard/missions", label: "Missions", icon: "target" },
  { href: "/dashboard/approvals", label: "Approvals", icon: "check-circle" },
  { href: "/dashboard/agents", label: "Agents", icon: "users" },
  { href: "/dashboard/decisions", label: "Decisions", icon: "zap" },
  { href: "/dashboard/agent-cards", label: "Agent Cards", icon: "id-badge" },
  { href: "/dashboard/comms", label: "Comms", icon: "message-square" },
  { href: "/dashboard/artifacts", label: "Artifacts", icon: "file-code" },
];

export function layout(title: string, activePath: string, content: HtmlContent): HtmlContent {
  return html`<!DOCTYPE html>
<html lang="en" class="h-full bg-gray-950">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — VALOR Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            valor: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e', 950: '#082f49' }
          }
        }
      }
    }
  </script>
  <style>
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-healthy { background: #22c55e; }
    .status-degraded { background: #eab308; }
    .status-offline { background: #ef4444; }
    .status-registered { background: #3b82f6; }
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .toast { position: fixed; bottom: 1rem; right: 1rem; z-index: 50; }
  </style>
</head>
<body class="h-full">
  <div class="min-h-full">
    <!-- Nav -->
    <nav class="bg-gray-900 border-b border-gray-800">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-14 items-center justify-between">
          <div class="flex items-center gap-6">
            <span class="text-valor-400 font-bold text-lg tracking-wide">VALOR</span>
            <div class="flex gap-1">
              ${NAV_ITEMS.map(
                (item) => html`
                <a href="${item.href}"
                   id="nav-${item.label.toLowerCase().replace(/\s+/g, '-')}"
                   class="relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                     activePath === item.href
                       ? "bg-gray-800 text-white"
                       : "text-gray-400 hover:text-white hover:bg-gray-800"
                   }">
                  ${item.label}
                  ${item.label === "Comms" ? html`<span id="comms-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-red-500 text-white px-1">0</span>` : ""}
                  ${item.label === "Agent Cards" ? html`<span id="cards-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full bg-yellow-500 text-black px-1">0</span>` : ""}
                </a>`,
              )}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span id="ws-status" class="text-xs text-gray-500">Connecting...</span>
            <span id="client-count" class="text-xs text-gray-600"></span>
          </div>
        </div>
      </div>
    </nav>

    <!-- Content -->
    <main class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      ${content}
    </main>
  </div>

  <!-- Toast container -->
  <div id="toasts" class="toast flex flex-col gap-2"></div>

  <!-- WebSocket client -->
  <script>
    const WS_URL = 'ws://' + window.location.host + '/ws';
    let ws;
    let reconnectTimer;

    function connectWS() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        document.getElementById('ws-status').textContent = 'Live';
        document.getElementById('ws-status').className = 'text-xs text-green-400';
        clearTimeout(reconnectTimer);
      };

      ws.onclose = () => {
        document.getElementById('ws-status').textContent = 'Disconnected';
        document.getElementById('ws-status').className = 'text-xs text-red-400';
        reconnectTimer = setTimeout(connectWS, 3000);
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'connected') return;
          handleEvent(data);
        } catch {}
      };
    }

    var commsUnread = 0;
    var cardsUnread = 0;
    var CURRENT_PAGE = ${raw(JSON.stringify(activePath))};

    function updateBadge(id, count) {
      var badge = document.getElementById(id);
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    function handleEvent(event) {
      // Comms notification — increment badge when not on comms page
      if (event.type === 'comms.message' && CURRENT_PAGE !== '/dashboard/comms') {
        commsUnread++;
        updateBadge('comms-badge', commsUnread);
        var who = (event.payload && event.payload.from_agent_id) || 'unknown';
        var subj = (event.payload && event.payload.subject) || '';
        showToast('New message from ' + who + (subj ? ': ' + subj : ''), 'info');
      } else if (event.type === 'comms.message') {
        // On comms page — don't badge, but still forward to page handler
      }

      // Agent card notification
      if (event.type === 'agent.card.submitted' && CURRENT_PAGE !== '/dashboard/agent-cards') {
        cardsUnread++;
        updateBadge('cards-badge', cardsUnread);
        var cs = (event.payload && event.payload.callsign) || 'unknown';
        showToast('New agent card: ' + cs, 'info');
      }

      // Forward to page-specific handler
      if (typeof onValorEvent === 'function') {
        onValorEvent(event);
      }
    }

    function showToast(message, type) {
      const container = document.getElementById('toasts');
      const toast = document.createElement('div');
      const colors = { info: 'bg-valor-900 border-valor-700', success: 'bg-green-900 border-green-700', error: 'bg-red-900 border-red-700' };
      toast.className = 'fade-in px-4 py-2 rounded-lg border text-sm text-gray-200 ' + (colors[type] || colors.info);
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    async function apiCall(method, path, body) {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(path, opts);
      return res.json();
    }

    connectWS();
  </script>
</body>
</html>`;
}
