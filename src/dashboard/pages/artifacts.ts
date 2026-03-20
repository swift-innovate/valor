import { Hono } from "hono";
import { html, raw } from "hono/html";
import { layout } from "../layout.js";
import { listArtifacts, getArtifact } from "../../db/repositories/artifact-repo.js";
import { listAgents } from "../../db/repositories/agent-repo.js";
import type { Artifact } from "../../types/index.js";

export const artifactsPage = new Hono();

const TYPE_COLORS: Record<string, string> = {
  code: "bg-blue-900 text-blue-300",
  markdown: "bg-purple-900 text-purple-300",
  config: "bg-yellow-900 text-yellow-300",
  data: "bg-green-900 text-green-300",
  text: "bg-gray-800 text-gray-300",
  log: "bg-orange-900 text-orange-300",
};

function typeBadge(contentType: string) {
  return html`<span class="text-xs px-2 py-0.5 rounded-full font-mono ${TYPE_COLORS[contentType] ?? TYPE_COLORS.text}">${contentType}</span>`;
}

function langBadge(language: string | null) {
  if (!language) return "";
  return html`<span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">${language}</span>`;
}

function timeSince(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Truncate content for preview
function contentPreview(content: string, lines = 30): { truncated: string; isTruncated: boolean } {
  const allLines = content.split("\n");
  const isTruncated = allLines.length > lines;
  return {
    truncated: allLines.slice(0, lines).join("\n"),
    isTruncated,
  };
}

// ── List page ─────────────────────────────────────────────────────────

artifactsPage.get("/", (c) => {
  const createdByFilter = c.req.query("created_by") || "";
  const typeFilter = c.req.query("content_type") || "";
  const convFilter = c.req.query("conversation_id") || "";
  const selectedId = c.req.query("id") || "";

  const agents = listAgents();
  const callsignMap: Record<string, string> = { director: "DIRECTOR", system: "SYSTEM" };
  for (const a of agents) callsignMap[a.id] = a.callsign;

  const artifacts = listArtifacts({
    created_by: createdByFilter || undefined,
    content_type: typeFilter || undefined,
    conversation_id: convFilter || undefined,
  });

  const selected = selectedId ? getArtifact(selectedId) : (artifacts[0] ?? null);

  // ── Filter bar ──────────────────────────────────────────────────
  const agentOptions = html`
    <option value="">All agents</option>
    <option value="director" ${createdByFilter === "director" ? "selected" : ""}>DIRECTOR</option>
    ${agents.map((a) => html`<option value="${a.id}" ${createdByFilter === a.id ? "selected" : ""}>${a.callsign}</option>`)}`;

  const typeOptions = html`
    <option value="">All types</option>
    ${["code", "markdown", "config", "data", "text", "log"].map(
      (t) => html`<option value="${t}" ${typeFilter === t ? "selected" : ""}>${t}</option>`,
    )}`;

  const filterBar = html`
    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <label class="text-xs text-gray-500">Agent:</label>
      <select onchange="applyFilters()" id="f-agent" class="text-sm bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
        ${agentOptions}
      </select>
      <label class="text-xs text-gray-500">Type:</label>
      <select onchange="applyFilters()" id="f-type" class="text-sm bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
        ${typeOptions}
      </select>
    </div>`;

  // ── Left panel: artifact list ────────────────────────────────────
  const artRows =
    artifacts.length === 0
      ? html`<div class="px-4 py-8 text-center text-gray-600 text-sm">No artifacts yet.</div>`
      : artifacts.map((art: Artifact) => {
          const isActive = selected?.id === art.id;
          const params = new URLSearchParams();
          if (createdByFilter) params.set("created_by", createdByFilter);
          if (typeFilter) params.set("content_type", typeFilter);
          params.set("id", art.id);
          return html`
            <a href="/dashboard/artifacts?${params.toString()}"
               class="block px-3 py-3 border-b border-gray-800 hover:bg-gray-800 transition-colors ${isActive ? "bg-gray-800 border-l-2 border-l-valor-500" : ""}">
              <div class="flex items-start justify-between gap-2 mb-1">
                <span class="text-sm text-gray-200 font-medium truncate">${art.title}</span>
                <span class="text-xs text-gray-600 flex-shrink-0">v${art.version}</span>
              </div>
              <div class="flex items-center gap-1.5 mb-1">
                ${typeBadge(art.content_type)}
                ${langBadge(art.language)}
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-600">${callsignMap[art.created_by] ?? art.created_by}</span>
                <span class="text-xs text-gray-600">${timeSince(art.created_at)}</span>
              </div>
              ${art.summary ? html`<div class="text-xs text-gray-600 mt-1 truncate italic">${art.summary}</div>` : ""}
            </a>`;
        });

  // ── Right panel: artifact detail ─────────────────────────────────
  let detailPanel;
  if (!selected) {
    detailPanel = html`<div class="flex items-center justify-center h-full text-gray-600 text-sm">Select an artifact to view its content.</div>`;
  } else {
    const { truncated, isTruncated } = contentPreview(selected.content);
    detailPanel = html`
      <div class="flex flex-col h-full overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-800">
          <div class="flex items-start justify-between gap-3 mb-1">
            <h2 class="text-sm font-semibold text-gray-100">${selected.title}</h2>
            <span class="text-xs text-gray-600 flex-shrink-0">v${selected.version}</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            ${typeBadge(selected.content_type)}
            ${langBadge(selected.language)}
            <span class="text-xs text-gray-500">by ${callsignMap[selected.created_by] ?? selected.created_by}</span>
            <span class="text-xs text-gray-600">${timeSince(selected.created_at)}</span>
            ${selected.conversation_id
              ? html`<a href="/dashboard/comms?conv=${selected.conversation_id}" class="text-xs text-valor-400 hover:underline">→ conversation</a>`
              : ""}
          </div>
          ${selected.summary ? html`<div class="text-xs text-gray-500 mt-1 italic">${selected.summary}</div>` : ""}
        </div>
        <div class="flex-1 overflow-auto p-4">
          <pre id="artifact-content" class="text-xs text-gray-300 bg-gray-950 rounded-lg p-4 overflow-auto leading-relaxed whitespace-pre-wrap"><code>${selected.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>
          ${isTruncated
            ? html`<div class="mt-2 text-xs text-gray-600 italic">Showing first 30 lines of ${selected.content.split("\n").length} total</div>`
            : ""}
        </div>
      </div>`;
  }

  const content = html`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold text-gray-100">Artifacts</h1>
        <span class="text-sm text-gray-500">${artifacts.length} artifact${artifacts.length !== 1 ? "s" : ""}</span>
      </div>

      ${filterBar}

      <div class="flex gap-4 h-[calc(100vh-16rem)]">
        <!-- Left: artifact list -->
        <div class="w-80 flex-shrink-0 bg-gray-900 rounded-lg border border-gray-800 overflow-y-auto">
          ${artRows}
        </div>

        <!-- Right: artifact detail -->
        <div class="flex-1 bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          ${detailPanel}
        </div>
      </div>
    </div>

    <script>
      function applyFilters() {
        var agent = document.getElementById('f-agent').value;
        var type = document.getElementById('f-type').value;
        var params = new URLSearchParams();
        if (agent) params.set('created_by', agent);
        if (type) params.set('content_type', type);
        location.href = '/dashboard/artifacts?' + params.toString();
      }

      function onValorEvent(event) {
        if (event.type === 'artifact.created' || event.type === 'artifact.updated') {
          showToast('Artifact ' + (event.type === 'artifact.created' ? 'created' : 'updated') + ': ' + (event.payload.title || event.payload.artifact_id), 'info');
        }
      }
    </script>`;

  return c.html(layout("Artifacts", "/dashboard/artifacts", content));
});
