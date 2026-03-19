import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listCards } from "../../db/repositories/agent-card-repo.js";
import type { AgentCard } from "../../types/index.js";

export const agentCardsPage = new Hono();

// ── Status badge ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-900 text-yellow-300 border-yellow-700",
  approved: "bg-green-900 text-green-300 border-green-700",
  rejected: "bg-red-900 text-red-300 border-red-700",
  revoked: "bg-gray-700 text-gray-400 border-gray-600",
};

function statusBadge(status: string) {
  return html`<span class="text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] ?? STATUS_COLORS.pending}">
    ${status}
  </span>`;
}

// ── Time since helper ───────────────────────────────────────────────

function timeSince(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Action buttons ──────────────────────────────────────────────────

function cardActions(card: AgentCard) {
  if (card.approval_status === "pending") {
    return html`
      <div class="flex items-center gap-2">
        <button
          onclick="apiCall('POST', '/agent-cards/${card.id}/approve', { approved_by: 'Director' }).then(() => location.reload())"
          class="px-3 py-1 text-xs font-medium rounded bg-green-700 hover:bg-green-600 text-white transition-colors">
          Approve
        </button>
        <button
          onclick="apiCall('POST', '/agent-cards/${card.id}/reject', { reason: prompt('Rejection reason:') || 'Rejected' }).then(() => location.reload())"
          class="px-3 py-1 text-xs font-medium rounded bg-red-700 hover:bg-red-600 text-white transition-colors">
          Reject
        </button>
      </div>`;
  }

  if (card.approval_status === "approved") {
    return html`
      <button
        onclick="if(confirm('Revoke this agent card?')) apiCall('POST', '/agent-cards/${card.id}/revoke').then(() => location.reload())"
        class="px-3 py-1 text-xs font-medium rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors">
        Revoke
      </button>`;
  }

  return html`<span class="text-xs text-gray-600">—</span>`;
}

// ── Skills display ──────────────────────────────────────────────────

function skillTags(skills: string[]) {
  if (skills.length === 0) return html`<span class="text-xs text-gray-600">none</span>`;
  return html`<div class="flex flex-wrap gap-1">
    ${skills.map(
      (s) => html`<span class="text-xs px-1.5 py-0.5 rounded bg-valor-900 text-valor-300">${s}</span>`,
    )}
  </div>`;
}

// ── Route handler ───────────────────────────────────────────────────

agentCardsPage.get("/", (c) => {
  const statusFilter = c.req.query("status") || "pending";

  const cards = listCards({
    approval_status: statusFilter === "all" ? undefined : statusFilter,
  });

  // ── Filter bar ──────────────────────────────────────────────────
  const filters = ["pending", "approved", "rejected", "revoked", "all"] as const;
  const filterBar = html`
    <div class="flex items-center gap-2 mb-6">
      ${filters.map((f) => {
        const active = f === statusFilter;
        const href = f === "pending" ? "/dashboard/agent-cards" : `/dashboard/agent-cards?status=${f}`;
        return html`<a
          href="${href}"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            active
              ? "bg-valor-700 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }">
          ${f}
        </a>`;
      })}
    </div>`;

  // ── Card list ─────────────────────────────────────────────────
  const rows =
    cards.length === 0
      ? html`<tr>
          <td colspan="7" class="px-4 py-8 text-center text-gray-500 text-sm">
            No ${statusFilter !== "all" ? statusFilter : ""} agent cards found.
          </td>
        </tr>`
      : cards.map(
          (card) => html`
            <tr class="border-t border-gray-800 hover:bg-gray-800/50 transition-colors">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-gray-200">${card.callsign}</div>
                <div class="text-xs text-gray-500 mt-0.5">${card.name}</div>
              </td>
              <td class="px-4 py-3 text-sm text-gray-400">${card.operator}</td>
              <td class="px-4 py-3 text-sm text-gray-300">${card.description || "—"}</td>
              <td class="px-4 py-3">${skillTags(card.primary_skills)}</td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-800 text-gray-300">
                  ${card.runtime}
                </span>
              </td>
              <td class="px-4 py-3">${statusBadge(card.approval_status)}</td>
              <td class="px-4 py-3 text-sm text-gray-500" title="${card.submitted_at}">
                ${timeSince(card.submitted_at)}
              </td>
              <td class="px-4 py-3">${cardActions(card)}</td>
            </tr>`,
        );

  const content = html`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold text-gray-100">Agent Cards</h1>
        <span class="text-sm text-gray-500">${cards.length} card${cards.length !== 1 ? "s" : ""}</span>
      </div>

      ${filterBar}

      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Callsign</th>
              <th class="px-4 py-3">Operator</th>
              <th class="px-4 py-3">Description</th>
              <th class="px-4 py-3">Skills</th>
              <th class="px-4 py-3">Runtime</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Submitted</th>
              <th class="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;

  return c.html(layout("Agent Cards", "/dashboard/agent-cards", content));
});
