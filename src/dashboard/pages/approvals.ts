import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listApprovals, getMission, type Approval } from "../../db/index.js";

export const approvalsPage = new Hono();

// ── Status badge ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-900 text-yellow-300 border-yellow-700",
  approved: "bg-green-900 text-green-300 border-green-700",
  rejected: "bg-red-900 text-red-300 border-red-700",
  expired: "bg-gray-700 text-gray-400 border-gray-600",
};

function statusBadge(status: string) {
  return html`<span class="text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] ?? STATUS_COLORS.pending}">
    ${status}
  </span>`;
}

// ── Date helper ─────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ── Action buttons for pending approvals ────────────────────────────

function approvalActions(apr: Approval) {
  if (apr.status !== "pending") {
    return html`<span class="text-xs text-gray-600">
      ${apr.resolved_by ? `by ${apr.resolved_by}` : ""}
    </span>`;
  }

  return html`
    <div class="flex items-center gap-2">
      <button
        onclick="apiCall('POST', '/missions/${apr.mission_id}/approve', { approved: true, resolved_by: 'Director' }).then(() => location.reload())"
        class="px-3 py-1 text-xs font-medium rounded bg-green-700 hover:bg-green-600 text-white transition-colors">
        Approve
      </button>
      <button
        onclick="apiCall('POST', '/missions/${apr.mission_id}/reject', { reason: prompt('Rejection reason:') || 'Rejected', resolved_by: 'Director' }).then(() => location.reload())"
        class="px-3 py-1 text-xs font-medium rounded bg-red-700 hover:bg-red-600 text-white transition-colors">
        Reject
      </button>
    </div>`;
}

// ── Route handler ───────────────────────────────────────────────────

approvalsPage.get("/", (c) => {
  const statusFilter = c.req.query("status") || "pending";

  const approvals = listApprovals({
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  // ── Filter bar ──────────────────────────────────────────────────
  const filters = ["pending", "approved", "rejected", "all"] as const;
  const filterBar = html`
    <div class="flex items-center gap-2 mb-6">
      ${filters.map((f) => {
        const active = f === statusFilter;
        const href = f === "pending" ? "/dashboard/approvals" : `/dashboard/approvals?status=${f}`;
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

  // ── Approval list ───────────────────────────────────────────────
  const rows =
    approvals.length === 0
      ? html`<tr>
          <td colspan="6" class="px-4 py-8 text-center text-gray-500 text-sm">
            No ${statusFilter !== "all" ? statusFilter : ""} approvals found.
          </td>
        </tr>`
      : approvals.map((apr) => {
          const mission = getMission(apr.mission_id);
          return html`
            <tr class="border-t border-gray-800 hover:bg-gray-800/50 transition-colors">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-gray-200">${mission?.title ?? "Unknown mission"}</div>
                <div class="text-xs text-gray-500 mt-0.5">${apr.mission_id}</div>
              </td>
              <td class="px-4 py-3">
                <span class="text-sm text-gray-300">${apr.gate}</span>
              </td>
              <td class="px-4 py-3">${statusBadge(apr.status)}</td>
              <td class="px-4 py-3 text-sm text-gray-400">${apr.requested_by}</td>
              <td class="px-4 py-3 text-sm text-gray-500" title="${apr.created_at}">
                ${timeSince(apr.created_at)}
              </td>
              <td class="px-4 py-3">${approvalActions(apr)}</td>
            </tr>`;
        });

  const content = html`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-xl font-bold text-gray-100">Approval Queue</h1>
        <span class="text-sm text-gray-500">${approvals.length} item${approvals.length !== 1 ? "s" : ""}</span>
      </div>

      ${filterBar}

      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Mission</th>
              <th class="px-4 py-3">Gate</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Requested By</th>
              <th class="px-4 py-3">When</th>
              <th class="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;

  return c.html(layout("Approvals", "/dashboard/approvals", content));
});
