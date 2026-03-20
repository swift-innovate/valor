import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listUsers, deleteUser } from "../../db/repositories/user-repo.js";
import { deleteUserSessions } from "../../db/repositories/session-repo.js";
import { getAuthUser } from "../../auth/index.js";

export const usersPage = new Hono();

const ROLE_COLORS: Record<string, string> = {
  director: "bg-valor-900 text-valor-300 border border-valor-700",
  operator: "bg-indigo-900 text-indigo-300",
  observer: "bg-gray-800 text-gray-400",
};

usersPage.get("/", (c) => {
  const authUser = getAuthUser(c)!;
  const users = listUsers();

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">User Management</h1>
        <span class="text-sm text-gray-500">${users.length} user${users.length !== 1 ? "s" : ""}</span>
      </div>

      <!-- Create user form -->
      <div class="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h2 class="text-sm font-semibold text-gray-200 mb-3">Create User</h2>
        <div class="grid sm:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs text-gray-400 mb-1">Username</label>
            <input id="new-username" type="text" placeholder="callsign"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Password</label>
            <input id="new-password" type="password"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Role</label>
            <select id="new-role"
              class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500">
              <option value="observer">Observer</option>
              <option value="operator">Operator</option>
              <option value="director">Director</option>
            </select>
          </div>
          <div class="flex items-end">
            <button onclick="createUser()"
              class="w-full px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors">
              Create
            </button>
          </div>
        </div>
      </div>

      <!-- User list -->
      <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th class="px-4 py-3">Username</th>
              <th class="px-4 py-3">Role</th>
              <th class="px-4 py-3">Created</th>
              <th class="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => html`
              <tr class="border-t border-gray-800 hover:bg-gray-800/40 transition-colors">
                <td class="px-4 py-3">
                  <div class="text-sm font-medium text-gray-200">${u.username}</div>
                  <div class="text-xs text-gray-600 font-mono">${u.id}</div>
                </td>
                <td class="px-4 py-3">
                  <span class="text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] ?? ROLE_COLORS.observer}">
                    ${u.role}
                  </span>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500">
                  ${new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <select onchange="changeRole('${u.id}', this.value); this.value='${u.role}'"
                      class="bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none focus:border-valor-500">
                      <option value="">Change role…</option>
                      <option value="observer">Observer</option>
                      <option value="operator">Operator</option>
                      <option value="director">Director</option>
                    </select>
                    ${u.id !== authUser.id ? html`
                      <button onclick="removeUser('${u.id}', '${u.username.replace(/'/g, "\\'")}')"
                        class="px-2 py-1 text-xs rounded bg-red-900 hover:bg-red-700 text-red-300 transition-colors">
                        Remove
                      </button>` : html`
                      <span class="text-xs text-gray-600 italic">you</span>`}
                  </div>
                </td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </div>

    <script>
      async function createUser() {
        const username = document.getElementById('new-username').value.trim();
        const password = document.getElementById('new-password').value;
        const role = document.getElementById('new-role').value;
        if (!username || !password) { showToast('Username and password are required', 'error'); return; }
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, role }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to create', 'error'); }
      }

      async function changeRole(id, role) {
        if (!role) return;
        const res = await fetch('/api/users/' + id + '/role', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to update', 'error'); }
      }

      async function removeUser(id, username) {
        if (!confirm('Remove user "' + username + '"? They will be logged out immediately.')) return;
        const res = await fetch('/api/users/' + id, { method: 'DELETE' });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); showToast(d.error || 'Failed to remove', 'error'); }
      }
    </script>`;

  return c.html(layout("Users", "/dashboard/users", content, authUser));
});
