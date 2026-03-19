import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listConversations, getConversation } from "../../db/repositories/comms-repo.js";
import { listAgents } from "../../db/repositories/agent-repo.js";
import type { CommsConversation } from "../../types/index.js";
import type { EventEnvelope } from "../../types/index.js";

export const commsPage = new Hono();

// ── Priority badge ────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  routine: "bg-gray-800 text-gray-400",
  priority: "bg-yellow-900 text-yellow-300",
  flash: "bg-red-900 text-red-300 border border-red-700",
};

function priorityBadge(priority: string) {
  return html`<span class="text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.routine}">
    ${priority}
  </span>`;
}

// ── Category badge ────────────────────────────────────────────────────

function categoryBadge(category: string) {
  return html`<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">${category.replace(/_/g, " ")}</span>`;
}

// ── Time format ───────────────────────────────────────────────────────

function timeSince(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Sender label ──────────────────────────────────────────────────────

function senderLabel(fromAgentId: string): string {
  if (fromAgentId === "director") return "DIRECTOR";
  return fromAgentId;
}

function senderColor(fromAgentId: string): string {
  if (fromAgentId === "director") return "text-yellow-400 font-bold";
  // Deterministic color from string
  const colors = ["text-valor-400", "text-green-400", "text-purple-400", "text-pink-400", "text-orange-400"];
  let hash = 0;
  for (const c of fromAgentId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

// ── Route handler ─────────────────────────────────────────────────────

commsPage.get("/", (c) => {
  const agentFilter = c.req.query("agent") || "";
  const selectedConvId = c.req.query("conv") || "";

  const agents = listAgents();
  const conversations = listConversations(agentFilter || undefined);
  const messages: EventEnvelope[] = selectedConvId
    ? getConversation(selectedConvId)
    : conversations.length > 0
      ? getConversation(conversations[0].conversation_id)
      : [];
  const activeConvId = selectedConvId || (conversations.length > 0 ? conversations[0].conversation_id : "");

  // ── Agent filter dropdown ─────────────────────────────────────────
  const agentOptions = html`
    <option value="">All agents</option>
    <option value="director" ${agentFilter === "director" ? "selected" : ""}>DIRECTOR</option>
    ${agents.map(
      (a) =>
        html`<option value="${a.id}" ${agentFilter === a.id ? "selected" : ""}>${a.callsign}</option>`,
    )}`;

  const agentFilterBar = html`
    <div class="flex items-center gap-3 mb-4">
      <label class="text-xs text-gray-500 font-medium">Filter by agent:</label>
      <select
        id="agent-filter"
        onchange="location.href='/dashboard/comms?agent=' + this.value"
        class="text-sm bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
        ${agentOptions}
      </select>
    </div>`;

  // ── Left panel: conversation list ────────────────────────────────
  const convRows =
    conversations.length === 0
      ? html`<div class="px-4 py-8 text-center text-gray-600 text-sm">No conversations yet.</div>`
      : conversations.map((conv: CommsConversation) => {
          const isActive = conv.conversation_id === activeConvId;
          const shortId = conv.conversation_id.slice(0, 12) + "…";
          return html`
            <a
              href="/dashboard/comms?${agentFilter ? `agent=${agentFilter}&` : ""}conv=${conv.conversation_id}"
              class="block px-3 py-3 border-b border-gray-800 cursor-pointer transition-colors hover:bg-gray-800 ${
                isActive ? "bg-gray-800 border-l-2 border-l-valor-500" : ""
              }">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    ${conv.has_flash
                      ? html`<span class="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></span>`
                      : ""}
                    <span class="text-xs font-medium text-gray-300 truncate">
                      ${conv.latest_subject ?? shortId}
                    </span>
                  </div>
                  <div class="text-xs text-gray-600 truncate">${conv.latest_body_preview ?? ""}</div>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs text-gray-600">${conv.message_count} msg${conv.message_count !== 1 ? "s" : ""}</span>
                    <span class="text-xs text-gray-700">·</span>
                    <span class="text-xs text-gray-600">${conv.participants.slice(0, 2).join(", ")}${conv.participants.length > 2 ? ` +${conv.participants.length - 2}` : ""}</span>
                  </div>
                </div>
                <span class="text-xs text-gray-600 flex-shrink-0">${timeSince(conv.last_message_at)}</span>
              </div>
            </a>`;
        });

  // ── Right panel: message thread ──────────────────────────────────
  const messageRows =
    messages.length === 0
      ? html`<div class="flex items-center justify-center h-full text-gray-600 text-sm">
          ${activeConvId ? "No messages in this conversation." : "Select a conversation to view messages."}
        </div>`
      : messages.map((msg) => {
          const payload = msg.payload;
          const fromId = (payload.from_agent_id as string) ?? "unknown";
          const isDirector = fromId === "director";
          return html`
            <div class="px-4 py-3 ${isDirector ? "border-l-2 border-yellow-600 bg-yellow-950/20" : "border-b border-gray-800/50"}">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-semibold ${senderColor(fromId)}">${senderLabel(fromId)}</span>
                ${isDirector ? html`<span class="text-xs px-1.5 py-0.5 rounded bg-yellow-900 text-yellow-400 border border-yellow-800">DIRECTOR</span>` : ""}
                ${priorityBadge(payload.priority as string)}
                ${categoryBadge(payload.category as string)}
                <span class="text-xs text-gray-600 ml-auto">${timeSince(msg.timestamp)}</span>
              </div>
              ${payload.subject
                ? html`<div class="text-xs font-medium text-gray-400 mb-1">${payload.subject as string}</div>`
                : ""}
              ${msg.in_reply_to
                ? html`<div class="text-xs text-gray-600 mb-1 italic">↩ replying to ${msg.in_reply_to}</div>`
                : ""}
              <div class="text-sm text-gray-300 leading-relaxed">${payload.body as string}</div>
            </div>`;
        });

  const threadHeader = activeConvId
    ? html`<div class="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
        <span class="text-xs font-medium text-gray-500 font-mono">${activeConvId}</span>
        <span class="text-xs text-gray-600">${messages.length} message${messages.length !== 1 ? "s" : ""}</span>
      </div>`
    : "";

  const content = html`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold text-gray-100">Comms Log</h1>
        <span class="text-sm text-gray-500">${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}</span>
      </div>

      ${agentFilterBar}

      <div class="flex gap-4 h-[calc(100vh-16rem)]">
        <!-- Left: conversation list -->
        <div class="w-80 flex-shrink-0 bg-gray-900 rounded-lg border border-gray-800 overflow-y-auto">
          ${convRows}
        </div>

        <!-- Right: message thread -->
        <div class="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex flex-col overflow-hidden">
          ${threadHeader}
          <div id="message-thread" class="flex-1 overflow-y-auto">
            ${messageRows}
          </div>
        </div>
      </div>
    </div>

    <script>
      const ACTIVE_CONV_ID = ${JSON.stringify(activeConvId)};

      function onValorEvent(event) {
        if (event.type !== 'comms.message') return;
        if (!ACTIVE_CONV_ID || event.conversation_id !== ACTIVE_CONV_ID) return;

        // Append new message to thread
        const thread = document.getElementById('message-thread');
        if (!thread) return;

        const p = event.payload;
        const isDirector = p.from_agent_id === 'director';
        const div = document.createElement('div');
        div.className = 'px-4 py-3 border-b border-gray-800/50 fade-in';
        div.innerHTML = \`
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-semibold \${isDirector ? 'text-yellow-400 font-bold' : 'text-valor-400'}">\${isDirector ? 'DIRECTOR' : p.from_agent_id}</span>
            <span class="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-800 text-gray-400">\${p.priority}</span>
            <span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">\${p.category?.replace(/_/g,' ')}</span>
            <span class="text-xs text-gray-600 ml-auto">just now</span>
          </div>
          \${p.subject ? \`<div class="text-xs font-medium text-gray-400 mb-1">\${p.subject}</div>\` : ''}
          <div class="text-sm text-gray-300 leading-relaxed">\${p.body}</div>
        \`;
        thread.appendChild(div);
        thread.scrollTop = thread.scrollHeight;
      }
    </script>`;

  return c.html(layout("Comms", "/dashboard/comms", content));
});
