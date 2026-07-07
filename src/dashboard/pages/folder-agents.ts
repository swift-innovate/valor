/**
 * Agent Roster — Folder Store
 *
 * Displays agents from folder-based stores (agents/{id}/persona.md)
 * instead of SQLite. Mounted when config.storeBackend === 'folder'.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { resolve } from "node:path";
import fs from "node:fs";
import path from "node:path";
import { layout } from "../layout.js";
import { getAuthUser } from "../../auth/index.js";
import { config } from "../../config.js";
import { isValidAgentId } from "../../store/ids.js";
import { AgentDiscovery, AgentLoader, AgentWriter, RosterManager } from "../../store/agent-store.js";
import type { AgentSummary } from "../../store/agent-store.js";
import type { OperativeConfig } from "../../execution/types.js";
import { logger } from "../../utils/logger.js";

export const folderAgentsPage = new Hono();

// ── Status dot ─────────────────────────────────────────────────────

function statusDot(status: string) {
  const isActive = status.toLowerCase() === "active";
  return html`<span class="inline-flex items-center gap-1.5">
    <span class="status-dot ${isActive ? "status-healthy" : "status-offline"}"></span>
    <span class="text-xs font-medium ${isActive ? "text-green-300" : "text-gray-500"}">${status}</span>
  </span>`;
}

// ── Tier badge ─────────────────────────────────────────────────────

const TIER_COLORS: Record<number, string> = {
  0: "bg-red-900 text-red-300",
  1: "bg-purple-900 text-purple-300",
  2: "bg-blue-900 text-blue-300",
  3: "bg-gray-700 text-gray-300",
};

function tierBadge(tier: number) {
  const cls = TIER_COLORS[tier] ?? TIER_COLORS[2];
  return html`<span class="text-xs px-2 py-0.5 rounded-full font-medium ${cls}">Tier ${tier}</span>`;
}

// ── Agent card ─────────────────────────────────────────────────────

interface AgentCardData {
  readonly summary: AgentSummary;
  readonly config: OperativeConfig;
  readonly hasWorkingMemory: boolean;
}

function agentCard(data: AgentCardData) {
  const { summary, config: agentConfig, hasWorkingMemory } = data;
  const defaultModel = agentConfig.modelAssignment["default"] ?? "unknown";
  const budget = agentConfig.autonomy.budget;

  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4 fade-in">
      <!-- Header: callsign + status -->
      <div class="flex items-center justify-between mb-3">
        <div>
          <a href="/dashboard/agents/${summary.id}" class="text-sm font-semibold text-gray-100 hover:text-valor-400 transition-colors">${summary.callsign}</a>
          <div class="text-xs text-gray-500 mt-0.5">${summary.id}</div>
        </div>
        ${statusDot(summary.status)}
      </div>

      <!-- Tier + Division -->
      <div class="flex items-center gap-2 mb-3">
        ${tierBadge(summary.tier)}
        <span class="text-xs text-gray-400">${summary.division || "Unassigned"}</span>
      </div>

      <!-- Details -->
      <div class="space-y-1.5 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Role</span>
          <span class="text-gray-300">${summary.role || "None"}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Model</span>
          <span class="text-gray-400 truncate max-w-[200px]" title="${defaultModel}">${defaultModel}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Budget</span>
          <span class="text-gray-300">${budget} act cycles</span>
        </div>
      </div>

      <!-- Memory status -->
      <div class="mt-3 pt-3 border-t border-gray-800">
        <div class="flex items-center justify-between text-xs">
          <span class="text-gray-500">Working Memory</span>
          <span class="${hasWorkingMemory ? "text-green-400" : "text-gray-600"}">${hasWorkingMemory ? "Has content" : "Empty"}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="mt-3 pt-3 border-t border-gray-800 flex justify-end">
        <a href="/api/folder/agents/${summary.id}/memory/working"
          target="_blank"
          class="px-3 py-1 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors">
          Read Memory
        </a>
      </div>
    </div>`;
}

// ── Route handler ──────────────────────────────────────────────────

folderAgentsPage.get("/", (c) => {
  const agentsDir = resolve(config.agentsDir);

  let agentCards: AgentCardData[];
  try {
    const agentIds = AgentDiscovery.scan(agentsDir);
    agentCards = agentIds.map((id) => {
      const agentPath = resolve(agentsDir, id);
      const summary = AgentLoader.summaryFromPersona(agentPath);
      const agentConfig = AgentLoader.fromDirectory(agentPath);
      const workingMemory = AgentLoader.readMemory(agentPath, "working");
      const hasWorkingMemory = workingMemory.trim().length > 0 && workingMemory.trim() !== "# Working";
      return { summary, config: agentConfig, hasWorkingMemory };
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load agents from folder store", { error: message });
    agentCards = [];
  }

  const content = html`
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-gray-100">Agent Roster</h1>
        <span class="text-sm text-gray-500">${agentCards.length} agent${agentCards.length !== 1 ? "s" : ""} <span class="text-xs text-gray-600">(folder store)</span></span>
      </div>

      ${agentCards.length === 0
        ? html`<p class="text-gray-500 text-sm">No agents found in ${agentsDir}. Create agent folders with persona.md to populate.</p>`
        : html`<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${agentCards.map((data) => agentCard(data))}
          </div>`}
    </div>`;

  return c.html(layout("Agents", "/dashboard/agents", content, getAuthUser(c)));
});

// ── Atomic write helper ───────────────────────────────────────────

function atomicWriteSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// ── Persona rebuild helper ────────────────────────────────────────

/**
 * Rebuild persona.md content with updated Identity, Voice, and Model
 * Preferences sections while preserving any trailing sections (e.g.
 * Capabilities, Domain Keywords).
 */
function rebuildPersona(
  existingContent: string,
  fields: {
    readonly callsign: string;
    readonly role: string;
    readonly tier: string;
    readonly division: string;
    readonly status: string;
    readonly voice: string;
    readonly defaultModel: string;
    readonly complexModel: string;
    readonly fastModel: string;
  },
): string {
  // Find content after "## Model Preferences" section to preserve trailing sections
  let trailingSections = "";
  const modelPrefHeading = /^## Model Preferences\s*$/m;
  const modelMatch = modelPrefHeading.exec(existingContent);
  if (modelMatch) {
    const afterModelStart = modelMatch.index + modelMatch[0].length;
    // Find the next ## heading after Model Preferences
    const nextHeading = existingContent.indexOf("\n## ", afterModelStart);
    if (nextHeading !== -1) {
      trailingSections = existingContent.slice(nextHeading);
    }
  } else {
    // No Model Preferences section — check for sections after Voice
    const voiceHeading = /^## Voice\s*$/m;
    const voiceMatch = voiceHeading.exec(existingContent);
    if (voiceMatch) {
      const afterVoiceStart = voiceMatch.index + voiceMatch[0].length;
      // Skip the voice content, find next heading after it
      const nextAfterVoice = existingContent.indexOf("\n## ", afterVoiceStart);
      if (nextAfterVoice !== -1) {
        // Check if it's the Model Preferences section or something else
        const remainder = existingContent.slice(nextAfterVoice);
        const secondHeading = remainder.indexOf("\n## ", 1);
        if (secondHeading !== -1) {
          trailingSections = remainder.slice(secondHeading);
        }
      }
    }
  }

  const lines = [
    `# ${fields.callsign}`,
    "",
    "## Identity",
    `- **Role:** ${fields.role}`,
    `- **Tier:** ${fields.tier}`,
    `- **Division:** ${fields.division}`,
    `- **Status:** ${fields.status}`,
    `- **Callsign:** ${fields.callsign}`,
    "",
    "## Voice",
    fields.voice,
    "",
    "## Model Preferences",
    `- **Default:** ${fields.defaultModel}`,
    `- **Complex:** ${fields.complexModel}`,
    `- **Fast:** ${fields.fastModel}`,
    "",
  ];

  if (trailingSections) {
    lines.push(trailingSections.trimStart());
  }

  return lines.join("\n");
}

// ── Input classes ─────────────────────────────────────────────────

const INPUT_CLS = "w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-valor-500";
const LABEL_CLS = "block text-xs font-medium text-gray-400 mb-1";
const BTN_PRIMARY = "px-4 py-2 text-sm font-medium rounded bg-valor-700 hover:bg-valor-600 text-white transition-colors";
const BTN_SECONDARY = "px-3 py-1.5 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors";

// ── Agent detail / edit page ──────────────────────────────────────

folderAgentsPage.get("/:id", (c) => {
  const agentId = c.req.param("id");
  if (!isValidAgentId(agentId)) {
    return c.text("Invalid agent id", 400);
  }
  const agentsDir = resolve(config.agentsDir);
  const agentPath = resolve(agentsDir, agentId);

  const saved = c.req.query("saved");
  const memorySaved = c.req.query("memory_saved");

  let summary: AgentSummary;
  let agentConfig: OperativeConfig;
  let personaRaw: string;
  let workingMemory: string;
  let reflectionsMemory: string;
  let longTermMemory: string;

  try {
    summary = AgentLoader.summaryFromPersona(agentPath);
    agentConfig = AgentLoader.fromDirectory(agentPath);
    personaRaw = fs.readFileSync(path.join(agentPath, "persona.md"), "utf-8");
    workingMemory = AgentLoader.readMemory(agentPath, "working");
    reflectionsMemory = AgentLoader.readMemory(agentPath, "reflections");
    longTermMemory = AgentLoader.readMemory(agentPath, "long-term");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load agent detail", { agentId, error: message });
    return c.html(
      layout(
        "Agent Not Found",
        "/dashboard/agents",
        html`<div class="fade-in space-y-4">
          <a href="/dashboard/agents" class="text-sm text-valor-400 hover:text-valor-300">&larr; Back to Roster</a>
          <p class="text-red-400 text-sm">Failed to load agent "${agentId}": ${message}</p>
        </div>`,
        getAuthUser(c),
      ),
    );
  }

  // Extract voice from persona
  const voiceMatch = /^## Voice\s*\n([\s\S]*?)(?=\n## |\n*$)/m.exec(personaRaw);
  const voice = voiceMatch ? voiceMatch[1].trim() : "";

  const defaultModel = agentConfig.modelAssignment["default"] ?? "";
  const complexModel = agentConfig.modelAssignment["complex"] ?? "";
  const fastModel = agentConfig.modelAssignment["fast"] ?? "";

  const content = html`
    <div class="fade-in space-y-6">
      <!-- Toast for save success -->
      ${saved === "1" ? html`<script>setTimeout(function(){ showToast('Persona saved successfully', 'success'); }, 100);</script>` : ""}
      ${memorySaved === "1" ? html`<script>setTimeout(function(){ showToast('Memory saved successfully', 'success'); }, 100);</script>` : ""}

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <a href="/dashboard/agents" class="text-sm text-valor-400 hover:text-valor-300 transition-colors">&larr; Roster</a>
          <div>
            <h1 class="text-xl font-bold text-gray-100">${summary.callsign}</h1>
            <span class="text-xs text-gray-500">${summary.id}</span>
          </div>
          ${statusDot(summary.status)}
          ${tierBadge(summary.tier)}
        </div>
      </div>

      <!-- Two-column layout -->
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Left column: Persona form (2 cols) -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Persona Section -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-200 mb-4">Persona</h2>
            <form method="POST" action="/dashboard/agents/${agentId}">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class="${LABEL_CLS}">Callsign</label>
                  <input type="text" name="callsign" value="${summary.callsign}" class="${INPUT_CLS}" />
                </div>
                <div>
                  <label class="${LABEL_CLS}">Role</label>
                  <input type="text" name="role" value="${summary.role}" class="${INPUT_CLS}" />
                </div>
                <div>
                  <label class="${LABEL_CLS}">Tier</label>
                  <select name="tier" class="${INPUT_CLS}">
                    ${[0, 1, 2, 3].map(
                      (t) => html`<option value="${t}" ${t === summary.tier ? "selected" : ""}>${t}</option>`,
                    )}
                  </select>
                </div>
                <div>
                  <label class="${LABEL_CLS}">Division</label>
                  <input type="text" name="division" value="${summary.division}" class="${INPUT_CLS}" />
                </div>
                <div>
                  <label class="${LABEL_CLS}">Status</label>
                  <select name="status" class="${INPUT_CLS}">
                    ${["active", "inactive", "suspended"].map(
                      (s) => html`<option value="${s}" ${s === summary.status ? "selected" : ""}>${s}</option>`,
                    )}
                  </select>
                </div>
              </div>

              <div class="mt-4">
                <label class="${LABEL_CLS}">Voice</label>
                <textarea name="voice" rows="2" class="${INPUT_CLS}">${voice}</textarea>
              </div>

              <h3 class="text-xs font-semibold text-gray-400 mt-5 mb-3">Model Preferences</h3>
              <div class="grid gap-4 sm:grid-cols-3">
                <div>
                  <label class="${LABEL_CLS}">Default</label>
                  <input type="text" name="defaultModel" value="${defaultModel}" class="${INPUT_CLS}" />
                </div>
                <div>
                  <label class="${LABEL_CLS}">Complex</label>
                  <input type="text" name="complexModel" value="${complexModel}" class="${INPUT_CLS}" />
                </div>
                <div>
                  <label class="${LABEL_CLS}">Fast</label>
                  <input type="text" name="fastModel" value="${fastModel}" class="${INPUT_CLS}" />
                </div>
              </div>

              <div class="mt-5 flex justify-end">
                <button type="submit" class="${BTN_PRIMARY}">Save Persona</button>
              </div>
            </form>
          </div>

          <!-- Memory Section -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-200 mb-4">Memory</h2>

            <!-- Tab buttons -->
            <div class="flex gap-1 mb-4">
              <button onclick="showMemoryTab('working')" id="tab-working" class="${BTN_SECONDARY} bg-gray-700 text-white">Working</button>
              <button onclick="showMemoryTab('reflections')" id="tab-reflections" class="${BTN_SECONDARY}">Reflections</button>
              <button onclick="showMemoryTab('long-term')" id="tab-long-term" class="${BTN_SECONDARY}">Long-Term</button>
            </div>

            <!-- Working memory -->
            <div id="mem-working" class="">
              <form method="POST" action="/dashboard/agents/${agentId}/memory/working">
                <textarea name="content" rows="12" class="${INPUT_CLS} font-mono text-xs">${workingMemory}</textarea>
                <div class="mt-3 flex justify-end">
                  <button type="submit" class="${BTN_PRIMARY}">Save Working Memory</button>
                </div>
              </form>
            </div>

            <!-- Reflections memory -->
            <div id="mem-reflections" class="hidden">
              <form method="POST" action="/dashboard/agents/${agentId}/memory/reflections">
                <textarea name="content" rows="12" class="${INPUT_CLS} font-mono text-xs">${reflectionsMemory}</textarea>
                <div class="mt-3 flex justify-end">
                  <button type="submit" class="${BTN_PRIMARY}">Save Reflections</button>
                </div>
              </form>
            </div>

            <!-- Long-term memory -->
            <div id="mem-long-term" class="hidden">
              <form method="POST" action="/dashboard/agents/${agentId}/memory/long-term">
                <textarea name="content" rows="12" class="${INPUT_CLS} font-mono text-xs">${longTermMemory}</textarea>
                <div class="mt-3 flex justify-end">
                  <button type="submit" class="${BTN_PRIMARY}">Save Long-Term Memory</button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- Right column: Autonomy (read-only) -->
        <div class="space-y-6">
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-200 mb-4">Autonomy</h2>
            <div class="space-y-3 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Budget</span>
                <span class="text-gray-300">${agentConfig.autonomy.budget} act cycles</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Escalation Target</span>
                <span class="text-gray-300">${agentConfig.autonomy.escalationTarget}</span>
              </div>
              <div>
                <span class="text-gray-500">Auto-Approve Phases</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  ${agentConfig.autonomy.autoApprovePhases.map(
                    (phase) => html`<span class="px-1.5 py-0.5 rounded bg-green-900 text-green-300 text-[10px] font-medium">${phase}</span>`,
                  )}
                  ${agentConfig.autonomy.autoApprovePhases.length === 0 ? html`<span class="text-gray-600">None</span>` : ""}
                </div>
              </div>
              <div>
                <span class="text-gray-500">Checkpoint Phases</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  ${agentConfig.autonomy.requiresCheckpoint.map(
                    (phase) => html`<span class="px-1.5 py-0.5 rounded bg-yellow-900 text-yellow-300 text-[10px] font-medium">${phase}</span>`,
                  )}
                  ${agentConfig.autonomy.requiresCheckpoint.length === 0 ? html`<span class="text-gray-600">None</span>` : ""}
                </div>
              </div>
            </div>
          </div>

          <!-- Tools (read-only) -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-200 mb-4">Tools</h2>
            <div class="space-y-3 text-xs">
              <div>
                <span class="text-gray-500">Enabled</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  ${agentConfig.tools.enabled.map(
                    (tool) => html`<span class="px-1.5 py-0.5 rounded bg-blue-900 text-blue-300 text-[10px] font-medium">${tool}</span>`,
                  )}
                  ${agentConfig.tools.enabled.length === 0 ? html`<span class="text-gray-600">None configured</span>` : ""}
                </div>
              </div>
              <div>
                <span class="text-gray-500">Disabled</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  ${agentConfig.tools.disabled.map(
                    (tool) => html`<span class="px-1.5 py-0.5 rounded bg-red-900 text-red-300 text-[10px] font-medium">${tool}</span>`,
                  )}
                  ${agentConfig.tools.disabled.length === 0 ? html`<span class="text-gray-600">None</span>` : ""}
                </div>
              </div>
            </div>
          </div>

          <!-- Quick info -->
          <div class="bg-gray-900 rounded-lg border border-gray-800 p-5">
            <h2 class="text-sm font-semibold text-gray-200 mb-4">Configuration</h2>
            <div class="space-y-2 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Loop Tick</span>
                <span class="text-gray-300">${agentConfig.loop.tickInterval}ms</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Max Iterations</span>
                <span class="text-gray-300">${agentConfig.loop.maxIterationsPerMission}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Idle Timeout</span>
                <span class="text-gray-300">${Math.round(agentConfig.loop.idleTimeout / 1000)}s</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Persistence</span>
                <span class="text-gray-300">${agentConfig.loop.persistence}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab switching script -->
    <script>
      function showMemoryTab(name) {
        var tabs = ['working', 'reflections', 'long-term'];
        for (var i = 0; i < tabs.length; i++) {
          var tab = tabs[i];
          var panel = document.getElementById('mem-' + tab);
          var btn = document.getElementById('tab-' + tab);
          if (tab === name) {
            panel.classList.remove('hidden');
            btn.classList.remove('bg-gray-800');
            btn.classList.add('bg-gray-700', 'text-white');
          } else {
            panel.classList.add('hidden');
            btn.classList.add('bg-gray-800');
            btn.classList.remove('bg-gray-700', 'text-white');
          }
        }
      }
    </script>`;

  return c.html(layout(`${summary.callsign} — Agent`, "/dashboard/agents", content, getAuthUser(c)));
});

// ── POST: Save persona edits ──────────────────────────────────────

folderAgentsPage.post("/:id", async (c) => {
  const agentId = c.req.param("id");
  if (!isValidAgentId(agentId)) {
    return c.text("Invalid agent id", 400);
  }
  const agentsDir = resolve(config.agentsDir);
  const agentPath = resolve(agentsDir, agentId);
  const personaPath = path.join(agentPath, "persona.md");

  try {
    const body = await c.req.parseBody();

    const callsign = String(body["callsign"] ?? "").trim();
    const role = String(body["role"] ?? "").trim();
    const tier = String(body["tier"] ?? "2").trim();
    const division = String(body["division"] ?? "").trim();
    const status = String(body["status"] ?? "active").trim();
    const voice = String(body["voice"] ?? "").trim();
    const defaultModel = String(body["defaultModel"] ?? "").trim();
    const complexModel = String(body["complexModel"] ?? "").trim();
    const fastModel = String(body["fastModel"] ?? "").trim();

    if (!callsign) {
      return c.redirect(`/dashboard/agents/${agentId}?error=callsign_required`);
    }

    // Read existing persona to preserve trailing sections
    const existingContent = fs.existsSync(personaPath)
      ? fs.readFileSync(personaPath, "utf-8")
      : "";

    const newContent = rebuildPersona(existingContent, {
      callsign,
      role,
      tier,
      division,
      status,
      voice,
      defaultModel,
      complexModel,
      fastModel,
    });

    atomicWriteSync(personaPath, newContent);
    logger.info("Agent persona updated via dashboard", { agentId, callsign });

    // Rebuild ROSTER.md to reflect the changes
    try {
      RosterManager.rebuild(agentsDir);
    } catch (rosterErr: unknown) {
      const msg = rosterErr instanceof Error ? rosterErr.message : String(rosterErr);
      logger.warn("Failed to rebuild roster after persona edit", { agentId, error: msg });
    }

    return c.redirect(`/dashboard/agents/${agentId}?saved=1`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to save agent persona", { agentId, error: message });
    return c.redirect(`/dashboard/agents/${agentId}?error=save_failed`);
  }
});

// ── POST: Save memory file ───────────────────────────────────────

folderAgentsPage.post("/:id/memory/:file", async (c) => {
  const agentId = c.req.param("id");
  if (!isValidAgentId(agentId)) {
    return c.text("Invalid agent id", 400);
  }
  const file = c.req.param("file");
  const agentsDir = resolve(config.agentsDir);
  const agentPath = resolve(agentsDir, agentId);

  // Validate memory file name
  const validFiles = new Set(["working", "reflections", "long-term"]);
  if (!validFiles.has(file)) {
    return c.redirect(`/dashboard/agents/${agentId}?error=invalid_file`);
  }

  try {
    const body = await c.req.parseBody();
    const content = String(body["content"] ?? "");

    AgentWriter.writeMemory(agentPath, file as "working" | "reflections" | "long-term", content);
    logger.info("Agent memory updated via dashboard", { agentId, file });

    return c.redirect(`/dashboard/agents/${agentId}?memory_saved=1`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to save agent memory", { agentId, file, error: message });
    return c.redirect(`/dashboard/agents/${agentId}?error=memory_save_failed`);
  }
});
