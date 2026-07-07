#!/usr/bin/env node
/**
 * Seed Migration: Parse ROSTER.md YAML blocks and create agent folder structure.
 *
 * Reads `agents/ROSTER.md`, extracts YAML blocks for each operative,
 * and generates the folder-based agent structure under `agents/{id}/`.
 *
 * Usage:  node --import tsx scripts/seed-agents.ts
 *
 * Idempotent: skips agents whose folders already exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentWriter, RosterManager } from '../src/store/agent-store.js';
import { logger } from '../src/utils/logger.js';

// ─── Resolve project root ──────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'agents');
const ROSTER_PATH = path.join(AGENTS_DIR, 'ROSTER.md');

// ─── Simple YAML-like parser ───────────────────────────────────────────────

interface ParsedAgent {
  readonly operative: string;
  readonly callsign: string;
  readonly division: string;
  readonly role: string;
  readonly capabilities: readonly string[];
  readonly domainKeywords: readonly string[];
  readonly preferredModelTier: string;
  readonly toolAccess: readonly string[];
  readonly escalationRules: string;
  readonly limitations: string;
}

/**
 * Extract all YAML code blocks from the ROSTER.md content.
 */
function extractYamlBlocks(content: string): readonly string[] {
  const blocks: string[] = [];
  const lines = content.split('\n');
  let inBlock = false;
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (line.trim() === '```yaml') {
      inBlock = true;
      currentBlock = [];
      continue;
    }
    if (line.trim() === '```' && inBlock) {
      inBlock = false;
      blocks.push(currentBlock.join('\n'));
      continue;
    }
    if (inBlock) {
      currentBlock.push(line);
    }
  }

  return blocks;
}

/**
 * Parse a simple YAML-like block into a ParsedAgent.
 * Handles scalar values, list items, and folded scalars (>).
 */
function parseYamlBlock(block: string): ParsedAgent {
  const lines = block.split('\n');

  let currentKey = '';
  let inList = false;
  let inFolded = false;

  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};

  for (const rawLine of lines) {
    const line = rawLine;

    // List item (indented with -)
    if (/^\s+-\s+/.test(line) && currentKey) {
      const item = line.replace(/^\s+-\s+/, '').trim();
      if (!lists[currentKey]) lists[currentKey] = [];
      lists[currentKey].push(item);
      inList = true;
      inFolded = false;
      continue;
    }

    // Continuation of folded scalar (indented text after >)
    if (inFolded && /^\s+\S/.test(line) && !line.includes(':')) {
      scalars[currentKey] = scalars[currentKey]
        ? `${scalars[currentKey]} ${line.trim()}`
        : line.trim();
      continue;
    }

    // Top-level key: value
    const keyMatch = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      inList = false;
      inFolded = false;

      if (value === '' || value === '>') {
        // Start of list or folded scalar
        if (value === '>') inFolded = true;
        continue;
      }

      scalars[currentKey] = value;
    }
  }

  return {
    operative: scalars['operative'] ?? '',
    callsign: scalars['callsign'] ?? '',
    division: scalars['division'] ?? '',
    role: scalars['role'] ?? '',
    capabilities: lists['capabilities'] ?? [],
    domainKeywords: lists['domain_keywords'] ?? [],
    preferredModelTier: scalars['preferred_model_tier'] ?? 'balanced',
    toolAccess: lists['tool_access'] ?? [],
    escalationRules: scalars['escalation_rules'] ?? '',
    limitations: scalars['limitations'] ?? '',
  };
}

/**
 * Map a model tier string from ROSTER.md to a provider/model string.
 */
function tierToModel(tier: string): string {
  switch (tier.toLowerCase()) {
    case 'frontier':
      return 'anthropic/claude-sonnet-4-20250514';
    case 'balanced':
      return 'ollama/gemma3:12b';
    case 'local':
      return 'ollama/gemma3:4b';
    default:
      return 'ollama/gemma3:12b';
  }
}

/**
 * Derive an agent tier from the role description.
 * Division Leads and Chiefs = Tier 1, others = Tier 2.
 */
function deriveTier(role: string): 0 | 1 | 2 | 3 {
  const lower = role.toLowerCase();
  if (lower.includes('lead') || lower.includes('chief') || lower.includes('senior architecture')) {
    return 1;
  }
  return 2;
}

/**
 * Derive an agent ID (folder name) from the operative name.
 * Lowercases and converts spaces/hyphens to hyphens.
 * "Crazy-Eddie" -> "crazy-eddie", "Gage" -> "gage"
 */
function deriveAgentId(operative: string): string {
  return operative.toLowerCase().replace(/\s+/g, '-');
}

// ─── Generate file contents ────────────────────────────────────────────────

function generatePersona(agent: ParsedAgent): string {
  const tier = deriveTier(agent.role);
  const defaultModel = tierToModel(agent.preferredModelTier);
  // Use frontier for complex tasks if the agent's preferred tier is frontier
  const complexModel = agent.preferredModelTier === 'frontier'
    ? defaultModel
    : 'anthropic/claude-sonnet-4-20250514';
  // Use local for fast tasks
  const fastModel = agent.preferredModelTier === 'local'
    ? defaultModel
    : 'ollama/gemma3:4b';

  const capabilityLines = agent.capabilities.length > 0
    ? agent.capabilities.map((c) => `- ${c}`).join('\n')
    : '';

  const sections = [
    `# ${agent.callsign}`,
    '',
    '## Identity',
    `- **Role:** ${agent.role}`,
    `- **Tier:** ${tier}`,
    `- **Division:** ${agent.division}`,
    '- **Status:** active',
    `- **Callsign:** ${agent.callsign}`,
    '',
    '## Voice',
    'Professional and mission-focused.',
    '',
    '## Model Preferences',
    `- **Default:** ${defaultModel}`,
    `- **Complex:** ${complexModel}`,
    `- **Fast:** ${fastModel}`,
    '',
  ];

  if (capabilityLines) {
    sections.push('## Capabilities', capabilityLines, '');
  }

  if (agent.domainKeywords.length > 0) {
    sections.push(
      '## Domain Keywords',
      agent.domainKeywords.map((k) => `- ${k}`).join('\n'),
      '',
    );
  }

  return sections.join('\n');
}

function generateRules(agent: ParsedAgent): string {
  const tier = deriveTier(agent.role);
  // Higher tier agents get more budget
  const budget = tier <= 1 ? 10 : 5;
  const escalationTarget = tier <= 1 ? 'director' : 'director';

  const sections = [
    '# Standing Orders',
    '',
    '## Autonomy',
    `- **Budget:** ${budget} act cycles before mandatory checkpoint`,
    `- **Escalation Target:** ${escalationTarget}`,
    '- **Auto-Approve Phases:** observe, plan, reflect',
    '- **Checkpoint Required:** act',
    '',
  ];

  if (agent.escalationRules) {
    sections.push(
      '## Escalation Rules',
      agent.escalationRules,
      '',
    );
  }

  if (agent.limitations) {
    sections.push(
      '## Guardrails',
      agent.limitations,
      '',
    );
  }

  sections.push(
    '## Division Protocol',
    `- Division: ${agent.division}`,
    `- Report through division chain of command`,
    '',
  );

  return sections.join('\n');
}

function generateTools(agent: ParsedAgent): string {
  const enabledLines = agent.toolAccess.length > 0
    ? agent.toolAccess.map((t) => `- ${t}`).join('\n')
    : '';

  return [
    '# Tool Access',
    '',
    '## Enabled',
    enabledLines,
    '',
    '## Disabled',
    '',
    '## MCP Servers',
    '',
  ].join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  logger.info('Seed migration started', { rosterPath: ROSTER_PATH });

  if (!fs.existsSync(ROSTER_PATH)) {
    logger.error('ROSTER.md not found', { path: ROSTER_PATH });
    process.exit(1);
  }

  const rosterContent = fs.readFileSync(ROSTER_PATH, 'utf-8');
  const blocks = extractYamlBlocks(rosterContent);

  logger.info('YAML blocks extracted', { count: blocks.length });

  let created = 0;
  let skipped = 0;

  for (const block of blocks) {
    const agent = parseYamlBlock(block);

    if (!agent.operative || !agent.callsign) {
      logger.warn('Skipping invalid YAML block (missing operative/callsign)');
      continue;
    }

    const agentId = deriveAgentId(agent.operative);
    const agentPath = path.join(AGENTS_DIR, agentId);

    if (fs.existsSync(agentPath)) {
      logger.info('Agent folder already exists, skipping', { agentId });
      skipped++;
      continue;
    }

    // Create directory tree
    const memDir = path.join(agentPath, 'memory');
    fs.mkdirSync(memDir, { recursive: true });

    // Write persona.md
    const personaContent = generatePersona(agent);
    fs.writeFileSync(`${path.join(agentPath, 'persona.md')}.tmp`, personaContent, 'utf-8');
    fs.renameSync(`${path.join(agentPath, 'persona.md')}.tmp`, path.join(agentPath, 'persona.md'));

    // Write rules.md
    const rulesContent = generateRules(agent);
    fs.writeFileSync(`${path.join(agentPath, 'rules.md')}.tmp`, rulesContent, 'utf-8');
    fs.renameSync(`${path.join(agentPath, 'rules.md')}.tmp`, path.join(agentPath, 'rules.md'));

    // Write tools.md
    const toolsContent = generateTools(agent);
    fs.writeFileSync(`${path.join(agentPath, 'tools.md')}.tmp`, toolsContent, 'utf-8');
    fs.renameSync(`${path.join(agentPath, 'tools.md')}.tmp`, path.join(agentPath, 'tools.md'));

    // Create memory placeholder files
    for (const memFile of ['working', 'reflections', 'long-term'] as const) {
      const title = memFile === 'long-term'
        ? '# Long-Term Memory'
        : `# ${memFile.charAt(0).toUpperCase() + memFile.slice(1)}`;
      const memPath = path.join(memDir, `${memFile}.md`);
      fs.writeFileSync(`${memPath}.tmp`, `${title}\n`, 'utf-8');
      fs.renameSync(`${memPath}.tmp`, memPath);
    }

    logger.info('Agent folder created', {
      agentId,
      callsign: agent.callsign,
      division: agent.division,
    });
    created++;
  }

  // Rebuild ROSTER.md as index format
  logger.info('Rebuilding ROSTER.md index', { agentsDir: AGENTS_DIR });
  RosterManager.rebuild(AGENTS_DIR);

  logger.info('Seed migration complete', { created, skipped, total: created + skipped });
}

main();
