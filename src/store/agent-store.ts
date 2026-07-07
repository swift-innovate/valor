/**
 * Agent Folder Store — folder-based persistence for VALOR agents.
 *
 * Each agent is a directory under `agents/{agent_id}/` with:
 *   persona.md, rules.md, tools.md, memory/{working,reflections,long-term}.md
 *
 * AgentLoader  — reads agent folders into OperativeConfig
 * AgentWriter  — creates agents and writes memory files atomically
 * AgentDiscovery — scans for agent directories
 * RosterManager — rebuilds ROSTER.md from agent folders
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import type {
  OperativeConfig,
  LoopConfig,
  AutonomyConfig,
  EngramConfig,
  ToolConfig,
  LoopPhase,
  PersistenceMode,
} from '../execution/types.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface CreateAgentOpts {
  readonly callsign: string;
  readonly role: string;
  readonly tier: 0 | 1 | 2 | 3;
  readonly division: string;
  readonly status?: string;
  readonly voice?: string;
  readonly modelPreferences?: {
    readonly default?: string;
    readonly complex?: string;
    readonly fast?: string;
  };
}

export interface AgentSummary {
  readonly id: string;
  readonly callsign: string;
  readonly role: string;
  readonly tier: 0 | 1 | 2 | 3;
  readonly division: string;
  readonly status: string;
}

type MemoryFile = 'working' | 'reflections' | 'long-term';

// ─── Defaults (aligned with config-loader.ts) ──────────────────────────────

const DEFAULT_LOOP: Readonly<LoopConfig> = {
  persistence: 'mission-scoped',
  tickInterval: 1000,
  maxIterationsPerMission: 10,
  idleTimeout: 300_000,
};

const DEFAULT_AUTONOMY: Readonly<AutonomyConfig> = {
  budget: 5,
  escalationTarget: 'director',
  autoApprovePhases: ['observe', 'plan', 'reflect'],
  requiresCheckpoint: ['act'],
};

const DEFAULT_ENGRAM: Readonly<EngramConfig> = {
  readDomains: ['shared'],
  writeDomains: ['shared'],
  recallBudget: 2000,
  retainOnPhases: ['reflect'],
};

const DEFAULT_TOOLS: Readonly<ToolConfig> = {
  enabled: [],
  disabled: [],
};

// ─── Markdown parsing helpers ──────────────────────────────────────────────

/**
 * Extract a value from a Markdown line matching `- **Key:** value`.
 * Returns the trimmed value or undefined if the key is not found.
 */
function extractField(content: string, key: string): string | undefined {
  // Match lines like: - **Key:** value  or  - **Key**: value
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*-\\s*\\*\\*${escapedKey}:\\*\\*\\s*(.+)$`, 'mi');
  const match = pattern.exec(content);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract a named Markdown section (## heading) and return its content.
 * Content is everything between this heading and the next ## heading (or EOF).
 */
function extractSection(content: string, heading: string): string | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^##\\s+${escapedHeading}\\s*$`, 'mi');
  const match = pattern.exec(content);
  if (!match) return undefined;

  const start = match.index + match[0].length;
  // Find the next ## heading or end of string
  const nextHeading = content.indexOf('\n## ', start);
  const end = nextHeading === -1 ? content.length : nextHeading;
  return content.slice(start, end).trim();
}

/**
 * Extract a bullet list from a section. Returns an array of the text after each `-`.
 */
function extractBulletList(sectionContent: string): readonly string[] {
  const items: string[] = [];
  for (const line of sectionContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items;
}

/**
 * Parse a tier value from a string. Returns a valid tier or the default.
 */
function parseTier(raw: string | undefined): 0 | 1 | 2 | 3 {
  if (raw === undefined) return 2;
  const num = parseInt(raw, 10);
  if (num === 0 || num === 1 || num === 2 || num === 3) return num;
  return 2;
}

/**
 * Parse a comma-separated list of LoopPhase names.
 */
function parsePhaseList(raw: string | undefined): LoopPhase[] {
  if (!raw) return [];
  const validPhases: ReadonlySet<string> = new Set([
    'observe', 'plan', 'act', 'validate', 'reflect', 'evolve',
  ]);
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is LoopPhase => validPhases.has(s));
}

// ─── Atomic file write helper ──────────────────────────────────────────────

function atomicWriteSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ─── AgentLoader ───────────────────────────────────────────────────────────

export const AgentLoader = {
  /**
   * Read an agent folder and hydrate into an OperativeConfig.
   * Reads config from agent.md (operational config) and tools.md.
   * Throws if persona.md is missing (it's the agent existence marker).
   */
  fromDirectory(agentPath: string): OperativeConfig {
    const agentId = path.basename(agentPath);

    // persona.md is required — it's the marker that this folder is an agent
    const personaPath = path.join(agentPath, 'persona.md');
    if (!fs.existsSync(personaPath)) {
      throw new Error(`Agent "${agentId}" missing required persona.md at ${personaPath}`);
    }

    // agent.md holds operational config (identity, models, autonomy)
    const agentMdPath = path.join(agentPath, 'agent.md');
    const agentMd = fs.existsSync(agentMdPath)
      ? fs.readFileSync(agentMdPath, 'utf-8')
      : '';

    // Parse identity from agent.md (falls back to persona.md for legacy format)
    const persona = fs.readFileSync(personaPath, 'utf-8');
    const configSource = agentMd || persona;

    const name = extractField(configSource, 'Callsign') ?? agentId.toUpperCase();
    const role = extractField(configSource, 'Role') ?? '';
    const tier = parseTier(extractField(configSource, 'Tier'));
    const division = extractField(configSource, 'Division');

    // Model preferences from agent.md (or persona.md for legacy)
    const modelDefault = extractField(configSource, 'Default');
    const modelComplex = extractField(configSource, 'Complex');
    const modelFast = extractField(configSource, 'Fast');

    const modelAssignment: Record<string, string> = {};
    if (modelDefault) modelAssignment['default'] = modelDefault;
    if (modelComplex) modelAssignment['complex'] = modelComplex;
    if (modelFast) modelAssignment['fast'] = modelFast;
    if (!modelAssignment['default']) {
      modelAssignment['default'] = 'ollama/gemma3:12b';
    }

    // Autonomy from agent.md (or legacy rules.md)
    let autonomy: AutonomyConfig = { ...DEFAULT_AUTONOMY };
    const autonomySource = agentMd || (() => {
      const rulesPath = path.join(agentPath, 'rules.md');
      return fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf-8') : '';
    })();

    if (autonomySource) {
      const budgetRaw = extractField(autonomySource, 'Budget');
      const budget = budgetRaw ? parseInt(budgetRaw, 10) : undefined;
      const escalationTarget = extractField(autonomySource, 'Escalation Target');
      const autoApproveRaw = extractField(autonomySource, 'Auto-Approve Phases');
      const checkpointRaw = extractField(autonomySource, 'Checkpoint Phases')
        ?? extractField(autonomySource, 'Checkpoint Required');

      autonomy = {
        budget: (budget && !isNaN(budget)) ? budget : DEFAULT_AUTONOMY.budget,
        escalationTarget: escalationTarget ?? DEFAULT_AUTONOMY.escalationTarget,
        autoApprovePhases: autoApproveRaw
          ? parsePhaseList(autoApproveRaw)
          : [...DEFAULT_AUTONOMY.autoApprovePhases],
        requiresCheckpoint: checkpointRaw
          ? parsePhaseList(checkpointRaw)
          : [...DEFAULT_AUTONOMY.requiresCheckpoint],
      };
    }

    // tools.md (optional)
    const toolsPath = path.join(agentPath, 'tools.md');
    let tools: ToolConfig = { ...DEFAULT_TOOLS };
    if (fs.existsSync(toolsPath)) {
      const toolsContent = fs.readFileSync(toolsPath, 'utf-8');
      const enabledSection = extractSection(toolsContent, 'Enabled');
      const disabledSection = extractSection(toolsContent, 'Disabled');
      tools = {
        enabled: enabledSection ? [...extractBulletList(enabledSection)] : [],
        disabled: disabledSection ? [...extractBulletList(disabledSection)] : [],
      };
    }

    const config: OperativeConfig = {
      id: agentId,
      name,
      tier,
      division,
      loop: { ...DEFAULT_LOOP },
      autonomy,
      engram: {
        ...DEFAULT_ENGRAM,
        readDomains: [...DEFAULT_ENGRAM.readDomains],
        writeDomains: [...DEFAULT_ENGRAM.writeDomains],
        retainOnPhases: [...DEFAULT_ENGRAM.retainOnPhases],
      },
      modelAssignment,
      tools,
    };

    logger.debug('Agent loaded from directory', { agentId, tier, division });
    return config;
  },

  /**
   * Read a memory file for an agent. Returns the file content or empty string
   * if the file does not exist.
   */
  readMemory(agentPath: string, file: MemoryFile): string {
    const filePath = path.join(agentPath, 'memory', `${file}.md`);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  },

  /**
   * Read the full persona.md content for system prompt injection.
   * This is the agent's "soul" — character, voice, working style, relationships.
   * Returns empty string if the file doesn't exist.
   */
  readPersona(agentPath: string): string {
    const filePath = path.join(agentPath, 'persona.md');
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  },

  /**
   * Build an AgentSummary from agent.md (operational config).
   * Falls back to persona.md for legacy folder format.
   */
  summaryFromPersona(agentPath: string): AgentSummary {
    const agentId = path.basename(agentPath);
    const personaPath = path.join(agentPath, 'persona.md');
    if (!fs.existsSync(personaPath)) {
      throw new Error(`Agent "${agentId}" missing required persona.md`);
    }

    // Prefer agent.md for structured fields, fall back to persona.md (legacy)
    const agentMdPath = path.join(agentPath, 'agent.md');
    const source = fs.existsSync(agentMdPath)
      ? fs.readFileSync(agentMdPath, 'utf-8')
      : fs.readFileSync(personaPath, 'utf-8');

    return {
      id: agentId,
      callsign: extractField(source, 'Callsign') ?? agentId.toUpperCase(),
      role: extractField(source, 'Role') ?? '',
      tier: parseTier(extractField(source, 'Tier')),
      division: extractField(source, 'Division') ?? '',
      status: extractField(source, 'Status') ?? 'active',
    };
  },
};

// ─── AgentWriter ───────────────────────────────────────────────────────────

export const AgentWriter = {
  /**
   * Write a memory file atomically.
   */
  writeMemory(agentPath: string, file: MemoryFile, content: string): void {
    const memDir = path.join(agentPath, 'memory');
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    const filePath = path.join(memDir, `${file}.md`);
    atomicWriteSync(filePath, content);
    logger.debug('Memory written', { agentPath, file });
  },

  /**
   * Append content to an existing memory file (read + append + atomic write).
   * If the file does not exist, creates it with the given content.
   */
  appendMemory(agentPath: string, file: MemoryFile, content: string): void {
    const memDir = path.join(agentPath, 'memory');
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    const filePath = path.join(memDir, `${file}.md`);
    const existing = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8')
      : '';
    const newContent = existing ? `${existing}\n${content}` : content;
    atomicWriteSync(filePath, newContent);
    logger.debug('Memory appended', { agentPath, file });
  },

  /**
   * Create a new agent folder with persona.md (soul), agent.md (config),
   * tools.md (access), and empty memory/ files.
   */
  createAgent(agentsDir: string, agentId: string, opts: CreateAgentOpts): void {
    const agentPath = path.join(agentsDir, agentId);
    if (fs.existsSync(agentPath)) {
      throw new Error(`Agent directory already exists: ${agentPath}`);
    }

    // Create directory tree
    const memDir = path.join(agentPath, 'memory');
    fs.mkdirSync(memDir, { recursive: true });

    const status = opts.status ?? 'active';
    const voice = opts.voice ?? 'Professional and direct.';
    const modelDefault = opts.modelPreferences?.default ?? 'ollama/gemma3:12b';
    const modelComplex = opts.modelPreferences?.complex ?? modelDefault;
    const modelFast = opts.modelPreferences?.fast ?? modelDefault;

    // persona.md — the agent's soul/identity
    const personaContent = [
      `# ${opts.callsign}`,
      '',
      `> ${opts.role} · Tier ${opts.tier} Operative · VALOR Framework`,
      '',
      '## Core Identity',
      '',
      `${opts.callsign} is a VALOR operative in the ${opts.division} division.`,
      '',
      '## Voice',
      '',
      `- ${voice}`,
      '',
      '## Working Style',
      '',
      '- Follows division protocols',
      '- Escalates when uncertain',
      '',
    ].join('\n');

    atomicWriteSync(path.join(agentPath, 'persona.md'), personaContent);

    // agent.md — operational configuration
    const agentMdContent = [
      '# Agent Configuration',
      '',
      '## Identity',
      `- **Callsign:** ${opts.callsign}`,
      `- **Role:** ${opts.role}`,
      `- **Tier:** ${opts.tier}`,
      `- **Division:** ${opts.division}`,
      `- **Status:** ${status}`,
      '',
      '## Model Preferences',
      `- **Default:** ${modelDefault}`,
      `- **Complex:** ${modelComplex}`,
      `- **Fast:** ${modelFast}`,
      '',
      '## Autonomy',
      `- **Budget:** ${DEFAULT_AUTONOMY.budget} act cycles before mandatory checkpoint`,
      `- **Escalation Target:** ${DEFAULT_AUTONOMY.escalationTarget}`,
      `- **Auto-Approve Phases:** ${DEFAULT_AUTONOMY.autoApprovePhases.join(', ')}`,
      `- **Checkpoint Phases:** ${DEFAULT_AUTONOMY.requiresCheckpoint.join(', ')}`,
      `- **Max Iterations Per Mission:** ${DEFAULT_LOOP.maxIterationsPerMission}`,
      `- **Loop Tick Interval:** ${DEFAULT_LOOP.tickInterval}ms`,
      `- **Idle Timeout:** ${DEFAULT_LOOP.idleTimeout / 1000}s`,
      `- **Persistence Mode:** ${DEFAULT_LOOP.persistence}`,
      '',
      '## Escalation Rules',
      '- Escalate when uncertain → division lead or director',
      '',
      '## Capabilities',
      '',
      '## Domain Keywords',
      '',
      '## Division Protocol',
      `- Report to ${opts.division} division lead`,
      '',
    ].join('\n');

    atomicWriteSync(path.join(agentPath, 'agent.md'), agentMdContent);

    // tools.md — tool access
    const toolsContent = [
      '# Tools',
      '',
      '## Enabled',
      '',
      '## Disabled',
      '',
      '## MCP Servers',
      '',
      '## Tool Policies',
      '',
    ].join('\n');

    atomicWriteSync(path.join(agentPath, 'tools.md'), toolsContent);

    // memory/ placeholders
    for (const memFile of ['working', 'reflections', 'long-term'] as const) {
      const title = memFile === 'long-term'
        ? '# Long-Term Memory'
        : `# ${memFile.charAt(0).toUpperCase() + memFile.slice(1)}`;
      atomicWriteSync(path.join(memDir, `${memFile}.md`), `${title}\n`);
    }

    logger.info('Agent created', { agentId, callsign: opts.callsign, division: opts.division });
  },
};

// ─── AgentDiscovery ────────────────────────────────────────────────────────

export const AgentDiscovery = {
  /**
   * Scan a directory for agent folders (those containing persona.md).
   * Returns an array of agent IDs (folder names), sorted alphabetically.
   */
  scan(agentsDir: string): readonly string[] {
    if (!fs.existsSync(agentsDir)) {
      logger.warn('Agents directory does not exist', { agentsDir });
      return [];
    }

    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    const agentIds: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const personaPath = path.join(agentsDir, entry.name, 'persona.md');
      if (fs.existsSync(personaPath)) {
        agentIds.push(entry.name);
      }
    }

    agentIds.sort();
    logger.debug('Agent discovery scan complete', { agentsDir, count: agentIds.length });
    return agentIds;
  },
};

// ─── RosterManager ─────────────────────────────────────────────────────────

export const RosterManager = {
  /**
   * Rebuild ROSTER.md from all agent folders.
   * Scans each agent, reads persona.md summary, writes the index file atomically.
   */
  rebuild(agentsDir: string): void {
    const agentIds = AgentDiscovery.scan(agentsDir);
    const summaries: AgentSummary[] = [];

    for (const id of agentIds) {
      try {
        const summary = AgentLoader.summaryFromPersona(path.join(agentsDir, id));
        summaries.push(summary);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('Skipping agent during roster rebuild', { agentId: id, error: message });
      }
    }

    const timestamp = new Date().toISOString();
    const tableRows = summaries.map((s) =>
      `| ${s.callsign} | ${s.role} | ${s.tier} | ${s.division} | ${s.status} | |`
    );

    const content = [
      '# Agent Roster',
      '',
      '> Auto-generated from agent folders. Do not edit directly.',
      '> Regenerate: `valor roster rebuild`',
      '',
      '| Callsign | Role | Tier | Division | Status | Primary Capabilities |',
      '|----------|------|------|----------|--------|---------------------|',
      ...tableRows,
      '',
      `**Last rebuilt:** ${timestamp}`,
      `**Agent count:** ${summaries.length}`,
      '',
    ].join('\n');

    const rosterPath = path.join(agentsDir, 'ROSTER.md');
    atomicWriteSync(rosterPath, content);

    logger.info('Roster rebuilt', { agentCount: summaries.length, timestamp });
  },
};
