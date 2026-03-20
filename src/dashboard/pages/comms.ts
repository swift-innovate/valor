import { Hono } from "hono";
import { html, raw } from "hono/html";
import { layout } from "../layout.js";
import { listConversations, getConversation } from "../../db/repositories/comms-repo.js";
import { getAuthUser } from "../../auth/index.js";
import { getArtifact } from "../../db/repositories/artifact-repo.js";
import { listAgents } from "../../db/repositories/agent-repo.js";
import type { CommsConversation, Artifact } from "../../types/index.js";
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

function senderLabel(fromAgentId: string, callsignMap: Record<string, string>): string {
  if (fromAgentId === "director") return "DIRECTOR";
  return callsignMap[fromAgentId] ?? fromAgentId;
}

function senderColor(fromAgentId: string): string {
  if (fromAgentId === "director") return "text-yellow-400 font-bold";
  // Deterministic color from string
  const colors = ["text-valor-400", "text-green-400", "text-purple-400", "text-pink-400", "text-orange-400"];
  let hash = 0;
  for (const c of fromAgentId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

// ── Artifact rendering ────────────────────────────────────────────────

const ARTIFACT_TYPE_COLORS: Record<string, string> = {
  code: "bg-blue-900 text-blue-300",
  markdown: "bg-purple-900 text-purple-300",
  config: "bg-yellow-900 text-yellow-300",
  data: "bg-green-900 text-green-300",
  text: "bg-gray-800 text-gray-300",
  log: "bg-orange-900 text-orange-300",
};

function renderArtifact(artifact: Artifact) {
  const lines = artifact.content.split("\n");
  const isTruncated = lines.length > 30;
  const displayContent = isTruncated ? lines.slice(0, 30).join("\n") : artifact.content;
  // Escape HTML entities for safe rendering
  const escaped = displayContent
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const typeBadge = html`<span class="text-xs px-1.5 py-0.5 rounded-full font-mono ${ARTIFACT_TYPE_COLORS[artifact.content_type] ?? ARTIFACT_TYPE_COLORS.text}">${artifact.content_type}</span>`;
  const langBadge = artifact.language
    ? html`<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">${artifact.language}</span>`
    : "";

  return html`
    <div class="mt-2 rounded-lg border border-gray-700 overflow-hidden">
      <div class="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span class="text-xs font-medium text-gray-300">${artifact.title}</span>
        ${typeBadge}
        ${langBadge}
        <span class="text-xs text-gray-600 ml-auto">v${artifact.version}</span>
        <a href="/dashboard/artifacts?id=${artifact.id}" class="text-xs text-valor-400 hover:underline ml-1">view</a>
      </div>
      ${artifact.summary
        ? html`<div class="px-3 py-1 text-xs text-gray-500 italic bg-gray-900 border-b border-gray-800">${artifact.summary}</div>`
        : ""}
      <pre class="text-xs text-gray-300 bg-gray-950 p-3 overflow-x-auto max-h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap"><code>${raw(escaped)}</code></pre>
      ${isTruncated
        ? html`<div class="px-3 py-1 text-xs text-gray-600 italic bg-gray-900 border-t border-gray-800">Showing first 30 of ${lines.length} lines — <a href="/dashboard/artifacts?id=${artifact.id}" class="text-valor-400 hover:underline">show more</a></div>`
        : ""}
    </div>`;
}

// ── Route handler ─────────────────────────────────────────────────────

commsPage.get("/", (c) => {
  const agentFilter = c.req.query("agent") || "";
  const selectedConvId = c.req.query("conv") || "";

  const agents = listAgents();
  const callsignMap: Record<string, string> = { director: "DIRECTOR" };
  for (const a of agents) callsignMap[a.id] = a.callsign;
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
                    <span class="text-xs text-gray-600">${conv.participants.slice(0, 3).map((p: string) => callsignMap[p] ?? p).join(", ")}${conv.participants.length > 3 ? ` +${conv.participants.length - 3}` : ""}</span>
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
          const attachmentIds = Array.isArray(payload.attachments) ? (payload.attachments as string[]) : [];
          const attachedArtifacts = attachmentIds
            .map((id: string) => getArtifact(id))
            .filter((a): a is Artifact => a !== null);
          return html`
            <div class="px-4 py-3 ${isDirector ? "border-l-2 border-yellow-600 bg-yellow-950/20" : "border-b border-gray-800/50"}">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-semibold ${senderColor(fromId)}">${senderLabel(fromId, callsignMap)}</span>
                ${isDirector ? html`<span class="text-xs px-1.5 py-0.5 rounded bg-yellow-900 text-yellow-400 border border-yellow-800">DIRECTOR</span>` : ""}
                ${priorityBadge(payload.priority as string)}
                ${categoryBadge(payload.category as string)}
                ${attachmentIds.length > 0 ? html`<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">📎 ${attachmentIds.length}</span>` : ""}
                <span class="text-xs text-gray-600 ml-auto">${timeSince(msg.timestamp)}</span>
              </div>
              ${payload.subject
                ? html`<div class="text-xs font-medium text-gray-400 mb-1">${payload.subject as string}</div>`
                : ""}
              ${msg.in_reply_to
                ? html`<div class="text-xs text-gray-600 mb-1 italic">↩ replying to ${msg.in_reply_to}</div>`
                : ""}
              <div class="text-sm text-gray-300 leading-relaxed">${payload.body as string}</div>
              ${attachedArtifacts.map((art) => renderArtifact(art))}
            </div>`;
        });

  const threadHeader = activeConvId
    ? html`<div class="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
        <span class="text-xs font-medium text-gray-500 font-mono">${activeConvId}</span>
        <span class="text-xs text-gray-600">${messages.length} message${messages.length !== 1 ? "s" : ""}</span>
      </div>`
    : "";

  // Latest subject from thread for reply pre-fill
  const latestSubject = messages.length > 0
    ? (messages[messages.length - 1].payload.subject as string ?? "")
    : "";
  // Who to reply to: last non-director sender, or first participant
  const lastAgentSender = [...messages].reverse()
    .find((m) => m.payload.from_agent_id !== "director")?.payload.from_agent_id as string ?? "";

  // Serialize callsign map for client-side JS (use raw() to prevent HTML escaping inside <script>)
  const callsignMapRaw = raw(JSON.stringify(callsignMap));
  const activeConvIdRaw = raw(JSON.stringify(activeConvId));
  const latestSubjectRaw = raw(JSON.stringify(latestSubject));
  const lastAgentSenderRaw = raw(JSON.stringify(lastAgentSender));
  const agentListRaw = raw(JSON.stringify(agents.map((a) => ({ id: a.id, callsign: a.callsign }))));

  // ── Reply compose box ────────────────────────────────────────────
  const replyBox = activeConvId ? html`
    <div class="border-t border-gray-800 bg-gray-900/80 p-3 space-y-2 flex-shrink-0">
      <div class="flex items-center gap-2">
        <input id="reply-subject" type="text" placeholder="Subject"
          class="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-valor-500">
        <select id="reply-priority"
          class="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-valor-500">
          <option value="routine">routine</option>
          <option value="priority">priority</option>
          <option value="flash">flash</option>
        </select>
        <select id="reply-category"
          class="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-valor-500">
          <option value="response">response</option>
          <option value="advisory">advisory</option>
          <option value="request">request</option>
          <option value="coordination">coordination</option>
          <option value="escalation">escalation</option>
          <option value="status_update">status update</option>
          <option value="task_handoff">task handoff</option>
        </select>
      </div>
      <div class="flex gap-2">
        <textarea id="reply-body" rows="3" placeholder="Write a message…"
          class="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
        <button onclick="sendReply()"
          class="px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors self-end">
          Send
        </button>
      </div>
    </div>` : html`
    <div class="border-t border-gray-800 px-4 py-3 text-xs text-gray-600 text-center flex-shrink-0">
      Select a conversation to reply, or start a new one.
    </div>`;

  // ── New conversation panel ───────────────────────────────────────
  const newConvPanel = html`
    <div id="new-conv-panel" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-200">New Conversation</h3>
          <button onclick="closeNewConv()" class="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-gray-400 mb-1">To (Agent)</label>
            <select id="nc-to-agent"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
              <option value="">— Select agent —</option>
              ${agents.map((a) => html`<option value="${a.id}">${a.callsign}</option>`)}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Subject</label>
            <input id="nc-subject" type="text"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
          </div>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="block text-xs text-gray-400 mb-1">Priority</label>
              <select id="nc-priority"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
                <option value="routine">routine</option>
                <option value="priority">priority</option>
                <option value="flash">flash</option>
              </select>
            </div>
            <div class="flex-1">
              <label class="block text-xs text-gray-400 mb-1">Category</label>
              <select id="nc-category"
                class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
                <option value="advisory">advisory</option>
                <option value="request">request</option>
                <option value="coordination">coordination</option>
                <option value="task_handoff">task handoff</option>
                <option value="escalation">escalation</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Message</label>
            <textarea id="nc-body" rows="4"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500 resize-none"></textarea>
          </div>
        </div>
        <div class="flex items-center justify-end gap-3 pt-1">
          <button onclick="closeNewConv()" class="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
          <button onclick="submitNewConv()"
            class="px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">
            Send Message
          </button>
        </div>
      </div>
    </div>`;

  const content = html`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold text-gray-100">Comms</h1>
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500">${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}</span>
          <button onclick="openNewConv()"
            class="px-3 py-1.5 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">
            + New
          </button>
        </div>
      </div>

      ${agentFilterBar}

      <div class="flex gap-4 h-[calc(100vh-18rem)]">
        <!-- Left: conversation list -->
        <div class="w-80 flex-shrink-0 bg-gray-900 rounded-lg border border-gray-800 overflow-y-auto">
          ${convRows}
        </div>

        <!-- Right: message thread + compose -->
        <div class="flex-1 bg-gray-900 rounded-lg border border-gray-800 flex flex-col overflow-hidden">
          ${threadHeader}
          <div id="message-thread" class="flex-1 overflow-y-auto">
            ${messageRows}
          </div>
          ${replyBox}
        </div>
      </div>
    </div>

    ${newConvPanel}

    <script>
      const ACTIVE_CONV_ID = ${activeConvIdRaw};
      const CALLSIGN_MAP = ${callsignMapRaw};
      const LATEST_SUBJECT = ${latestSubjectRaw};
      const LAST_AGENT_SENDER = ${lastAgentSenderRaw};
      const AGENT_LIST = ${agentListRaw};

      // Pre-fill reply subject
      var subjectEl = document.getElementById('reply-subject');
      if (subjectEl && LATEST_SUBJECT) {
        subjectEl.value = LATEST_SUBJECT.startsWith('Re: ') ? LATEST_SUBJECT : 'Re: ' + LATEST_SUBJECT;
      }

      function resolveCallsign(agentId) {
        return CALLSIGN_MAP[agentId] || agentId;
      }

      // ── Reply ────────────────────────────────────────────────────
      async function sendReply() {
        if (!ACTIVE_CONV_ID) return;
        var body = document.getElementById('reply-body').value.trim();
        if (!body) { showToast('Message body is required', 'error'); return; }
        var subject = document.getElementById('reply-subject').value.trim() || LATEST_SUBJECT || 'Re: (no subject)';
        var priority = document.getElementById('reply-priority').value;
        var category = document.getElementById('reply-category').value;

        var payload = {
          from_agent_id: 'director',
          to_agent_id: LAST_AGENT_SENDER || null,
          to_division_id: null,
          subject,
          body,
          priority,
          category,
          conversation_id: ACTIVE_CONV_ID,
        };
        // If no known agent sender, require a to_agent — fallback: treat as broadcast within conv
        if (!payload.to_agent_id) {
          showToast('No agent to reply to in this conversation', 'error');
          return;
        }

        var res = await fetch('/comms/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          document.getElementById('reply-body').value = '';
        } else {
          var d = await res.json();
          showToast(d.error || 'Failed to send', 'error');
        }
      }

      // ── New conversation ─────────────────────────────────────────
      function openNewConv() {
        document.getElementById('new-conv-panel').classList.remove('hidden');
        document.getElementById('nc-subject').focus();
      }
      function closeNewConv() {
        document.getElementById('new-conv-panel').classList.add('hidden');
      }

      async function submitNewConv() {
        var toAgent = document.getElementById('nc-to-agent').value;
        var subject = document.getElementById('nc-subject').value.trim();
        var body = document.getElementById('nc-body').value.trim();
        var priority = document.getElementById('nc-priority').value;
        var category = document.getElementById('nc-category').value;

        if (!toAgent) { showToast('Select an agent to message', 'error'); return; }
        if (!subject)  { showToast('Subject is required', 'error'); return; }
        if (!body)     { showToast('Message body is required', 'error'); return; }

        var res = await fetch('/comms/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_agent_id: 'director',
            to_agent_id: toAgent,
            to_division_id: null,
            subject,
            body,
            priority,
            category,
          }),
        });
        if (res.ok) {
          var evt = await res.json();
          closeNewConv();
          window.location.href = '/dashboard/comms?conv=' + evt.conversation_id;
        } else {
          var d = await res.json();
          showToast(d.error || 'Failed to send', 'error');
        }
      }

      // Close modal on backdrop click
      document.getElementById('new-conv-panel').addEventListener('click', function(e) {
        if (e.target === this) closeNewConv();
      });

      // Ctrl+Enter to send reply
      document.getElementById('reply-body')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply();
      });

      // ── WebSocket: append incoming messages ──────────────────────
      function onValorEvent(event) {
        if (event.type !== 'comms.message') return;
        if (!ACTIVE_CONV_ID || event.payload.conversation_id !== ACTIVE_CONV_ID) return;

        var thread = document.getElementById('message-thread');
        if (!thread) return;

        var p = event.payload;
        var isDirector = p.from_agent_id === 'director';
        var senderName = resolveCallsign(p.from_agent_id);
        var colorClass = isDirector ? 'text-yellow-400 font-bold' : 'text-valor-400';
        var div = document.createElement('div');
        div.className = 'px-4 py-3 ' + (isDirector ? 'border-l-2 border-yellow-600 bg-yellow-950/20' : 'border-b border-gray-800/50') + ' fade-in';

        var h = '<div class="flex items-center gap-2 mb-1">';
        h += '<span class="text-sm font-semibold ' + colorClass + '">' + senderName + '</span>';
        if (isDirector) h += '<span class="text-xs px-1.5 py-0.5 rounded bg-yellow-900 text-yellow-400 border border-yellow-800">DIRECTOR</span>';
        h += '<span class="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-800 text-gray-400">' + (p.priority || '') + '</span>';
        h += '<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">' + (p.category || '').replace(/_/g, ' ') + '</span>';
        h += '<span class="text-xs text-gray-600 ml-auto">just now</span>';
        h += '</div>';
        if (p.subject) h += '<div class="text-xs font-medium text-gray-400 mb-1">' + p.subject + '</div>';
        h += '<div class="text-sm text-gray-300 leading-relaxed">' + (p.body || '') + '</div>';

        div.innerHTML = h;
        thread.appendChild(div);
        thread.scrollTop = thread.scrollHeight;
      }
    </script>`;

  return c.html(layout("Comms", "/dashboard/comms", content, getAuthUser(c)));
});
