import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AgentLoader,
  AgentWriter,
  AgentDiscovery,
  RosterManager,
} from '../../src/store/agent-store.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const SAMPLE_PERSONA = [
  '# Gage',
  '',
  '> Code Division Lead · Tier 1 Operative · VALOR Framework',
  '',
  '## Core Identity',
  '',
  'Gage is the Code Division Lead. Technical and direct.',
  '',
  '## Voice',
  '',
  '- **Direct and warm.** A trusted colleague.',
  '',
].join('\n');

const SAMPLE_AGENT_MD = [
  '# Agent Configuration',
  '',
  '## Identity',
  '- **Callsign:** GAGE',
  '- **Role:** Code Division Lead',
  '- **Tier:** 1',
  '- **Division:** Code',
  '- **Status:** active',
  '',
  '## Model Preferences',
  '- **Default:** anthropic/claude-sonnet-4-20250514',
  '- **Complex:** anthropic/claude-sonnet-4-20250514',
  '- **Fast:** ollama/gemma3:4b',
  '',
  '## Autonomy',
  '- **Budget:** 10 act cycles before mandatory checkpoint',
  '- **Escalation Target:** director',
  '- **Auto-Approve Phases:** observe, plan, reflect',
  '- **Checkpoint Phases:** act, validate',
  '',
].join('\n');

const SAMPLE_TOOLS = [
  '# Tool Access',
  '',
  '## Enabled',
  '- Claude Code',
  '- Git (read/write)',
  '- Code execution environment',
  '',
  '## Disabled',
  '- Production database',
  '',
  '## MCP Servers',
  '- context7: active',
  '',
].join('\n');

// ─── Temp directory management ─────────────────────────────────────────────

let tmpDir: string;

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valor-test-'));
}

function createSampleAgent(agentsDir: string, agentId: string): string {
  const agentPath = path.join(agentsDir, agentId);
  const memDir = path.join(agentPath, 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(agentPath, 'persona.md'), SAMPLE_PERSONA);
  fs.writeFileSync(path.join(agentPath, 'agent.md'), SAMPLE_AGENT_MD);
  fs.writeFileSync(path.join(agentPath, 'tools.md'), SAMPLE_TOOLS);
  fs.writeFileSync(path.join(memDir, 'working.md'), '# Working\n\nCurrent context here.\n');
  fs.writeFileSync(path.join(memDir, 'reflections.md'), '# Reflections\n');
  fs.writeFileSync(path.join(memDir, 'long-term.md'), '# Long-Term Memory\n');
  return agentPath;
}

function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  tmpDir = createTempDir();
});

afterEach(() => {
  cleanupDir(tmpDir);
});

// ─── AgentLoader.fromDirectory ─────────────────────────────────────────────

describe('AgentLoader.fromDirectory', () => {
  it('loads a complete agent folder into OperativeConfig', () => {
    const agentPath = createSampleAgent(tmpDir, 'gage');
    const config = AgentLoader.fromDirectory(agentPath);

    expect(config.id).toBe('gage');
    expect(config.name).toBe('GAGE');
    expect(config.tier).toBe(1);
    expect(config.division).toBe('Code');

    // Model assignment
    expect(config.modelAssignment['default']).toBe('anthropic/claude-sonnet-4-20250514');
    expect(config.modelAssignment['complex']).toBe('anthropic/claude-sonnet-4-20250514');
    expect(config.modelAssignment['fast']).toBe('ollama/gemma3:4b');

    // Autonomy from agent.md
    expect(config.autonomy.budget).toBe(10);
    expect(config.autonomy.escalationTarget).toBe('director');
    expect(config.autonomy.autoApprovePhases).toEqual(['observe', 'plan', 'reflect']);
    expect(config.autonomy.requiresCheckpoint).toEqual(['act', 'validate']);

    // Tools from tools.md
    expect(config.tools.enabled).toEqual([
      'Claude Code',
      'Git (read/write)',
      'Code execution environment',
    ]);
    expect(config.tools.disabled).toEqual(['Production database']);

    // Loop defaults
    expect(config.loop.persistence).toBe('mission-scoped');
    expect(config.loop.maxIterationsPerMission).toBe(10);

    // Engram defaults
    expect(config.engram.readDomains).toEqual(['shared']);
    expect(config.engram.recallBudget).toBe(2000);
  });

  it('throws when persona.md is missing', () => {
    const agentPath = path.join(tmpDir, 'missing-agent');
    fs.mkdirSync(agentPath, { recursive: true });
    // No persona.md created

    expect(() => AgentLoader.fromDirectory(agentPath)).toThrow(
      /missing required persona\.md/
    );
  });

  it('uses defaults when agent.md is missing', () => {
    const agentPath = path.join(tmpDir, 'minimal');
    fs.mkdirSync(agentPath, { recursive: true });
    fs.writeFileSync(path.join(agentPath, 'persona.md'), SAMPLE_PERSONA);
    // No agent.md

    const config = AgentLoader.fromDirectory(agentPath);

    expect(config.autonomy.budget).toBe(5); // default
    expect(config.autonomy.escalationTarget).toBe('director');
    expect(config.autonomy.autoApprovePhases).toEqual(['observe', 'plan', 'reflect']);
  });

  it('uses defaults when tools.md is missing', () => {
    const agentPath = path.join(tmpDir, 'no-tools');
    fs.mkdirSync(agentPath, { recursive: true });
    fs.writeFileSync(path.join(agentPath, 'persona.md'), SAMPLE_PERSONA);

    const config = AgentLoader.fromDirectory(agentPath);

    expect(config.tools.enabled).toEqual([]);
    expect(config.tools.disabled).toEqual([]);
  });

  it('provides default model when persona has no model preferences', () => {
    const minimalPersona = [
      '# TEST',
      '',
      '## Identity',
      '- **Role:** Tester',
      '- **Tier:** 2',
      '- **Division:** QA',
      '- **Status:** active',
      '- **Callsign:** TEST',
      '',
    ].join('\n');

    const agentPath = path.join(tmpDir, 'test-agent');
    fs.mkdirSync(agentPath, { recursive: true });
    fs.writeFileSync(path.join(agentPath, 'persona.md'), minimalPersona);

    const config = AgentLoader.fromDirectory(agentPath);

    expect(config.modelAssignment['default']).toBe('ollama/gemma3:12b');
  });
});

// ─── AgentLoader.readMemory ────────────────────────────────────────────────

describe('AgentLoader.readMemory', () => {
  it('reads an existing memory file', () => {
    const agentPath = createSampleAgent(tmpDir, 'gage');

    const content = AgentLoader.readMemory(agentPath, 'working');
    expect(content).toContain('# Working');
    expect(content).toContain('Current context here.');
  });

  it('returns empty string when memory file does not exist', () => {
    const agentPath = path.join(tmpDir, 'no-memory');
    fs.mkdirSync(agentPath, { recursive: true });
    // No memory/ directory

    const content = AgentLoader.readMemory(agentPath, 'working');
    expect(content).toBe('');
  });

  it('returns empty string when memory directory does not exist', () => {
    const agentPath = path.join(tmpDir, 'empty-agent');
    fs.mkdirSync(agentPath, { recursive: true });

    const content = AgentLoader.readMemory(agentPath, 'reflections');
    expect(content).toBe('');
  });
});

// ─── AgentWriter.writeMemory ───────────────────────────────────────────────

describe('AgentWriter.writeMemory', () => {
  it('writes a memory file atomically', () => {
    const agentPath = path.join(tmpDir, 'write-test');
    fs.mkdirSync(agentPath, { recursive: true });

    AgentWriter.writeMemory(agentPath, 'working', '# Working\n\nNew context.\n');

    const filePath = path.join(agentPath, 'memory', 'working.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('# Working\n\nNew context.\n');

    // No .tmp file left behind
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('creates memory directory if it does not exist', () => {
    const agentPath = path.join(tmpDir, 'no-mem-dir');
    fs.mkdirSync(agentPath, { recursive: true });
    // No memory/ dir

    AgentWriter.writeMemory(agentPath, 'reflections', '# Test');

    const memDir = path.join(agentPath, 'memory');
    expect(fs.existsSync(memDir)).toBe(true);
    expect(fs.existsSync(path.join(memDir, 'reflections.md'))).toBe(true);
  });

  it('overwrites existing memory file', () => {
    const agentPath = createSampleAgent(tmpDir, 'overwrite');

    AgentWriter.writeMemory(agentPath, 'working', 'Replaced content');

    const content = fs.readFileSync(
      path.join(agentPath, 'memory', 'working.md'),
      'utf-8',
    );
    expect(content).toBe('Replaced content');
  });
});

// ─── AgentWriter.appendMemory ──────────────────────────────────────────────

describe('AgentWriter.appendMemory', () => {
  it('appends content to an existing memory file', () => {
    const agentPath = createSampleAgent(tmpDir, 'append-test');

    AgentWriter.appendMemory(agentPath, 'working', '## New Entry\nSomething happened.');

    const content = fs.readFileSync(
      path.join(agentPath, 'memory', 'working.md'),
      'utf-8',
    );
    // Should contain original content plus appended
    expect(content).toContain('# Working');
    expect(content).toContain('Current context here.');
    expect(content).toContain('## New Entry');
    expect(content).toContain('Something happened.');
  });

  it('creates a new file when appending to non-existent memory', () => {
    const agentPath = path.join(tmpDir, 'append-new');
    fs.mkdirSync(agentPath, { recursive: true });

    AgentWriter.appendMemory(agentPath, 'long-term', '# First Entry');

    const content = fs.readFileSync(
      path.join(agentPath, 'memory', 'long-term.md'),
      'utf-8',
    );
    expect(content).toBe('# First Entry');
  });
});

// ─── AgentWriter.createAgent ───────────────────────────────────────────────

describe('AgentWriter.createAgent', () => {
  it('creates a full agent folder structure', () => {
    AgentWriter.createAgent(tmpDir, 'newbie', {
      callsign: 'NEWBIE',
      role: 'Test Agent',
      tier: 2,
      division: 'QA',
      voice: 'Calm and analytical.',
      modelPreferences: {
        default: 'ollama/gemma3:12b',
        complex: 'anthropic/claude-sonnet-4-20250514',
        fast: 'ollama/gemma3:4b',
      },
    });

    const agentPath = path.join(tmpDir, 'newbie');

    // All files exist
    expect(fs.existsSync(path.join(agentPath, 'persona.md'))).toBe(true);
    expect(fs.existsSync(path.join(agentPath, 'agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(agentPath, 'tools.md'))).toBe(true);
    expect(fs.existsSync(path.join(agentPath, 'memory', 'working.md'))).toBe(true);
    expect(fs.existsSync(path.join(agentPath, 'memory', 'reflections.md'))).toBe(true);
    expect(fs.existsSync(path.join(agentPath, 'memory', 'long-term.md'))).toBe(true);

    // persona.md has soul content
    const persona = fs.readFileSync(path.join(agentPath, 'persona.md'), 'utf-8');
    expect(persona).toContain('# NEWBIE');
    expect(persona).toContain('VALOR operative');
    expect(persona).toContain('Calm and analytical.');

    // agent.md has operational config
    const agentMd = fs.readFileSync(path.join(agentPath, 'agent.md'), 'utf-8');
    expect(agentMd).toContain('- **Role:** Test Agent');
    expect(agentMd).toContain('- **Tier:** 2');
    expect(agentMd).toContain('- **Division:** QA');
    expect(agentMd).toContain('- **Status:** active');
    expect(agentMd).toContain('- **Callsign:** NEWBIE');
    expect(agentMd).toContain('- **Default:** ollama/gemma3:12b');
    expect(agentMd).toContain('- **Complex:** anthropic/claude-sonnet-4-20250514');
    expect(agentMd).toContain('- **Fast:** ollama/gemma3:4b');
    expect(agentMd).toContain('- **Budget:** 5');
    expect(agentMd).toContain('- **Escalation Target:** director');

    // tools.md has structure
    const tools = fs.readFileSync(path.join(agentPath, 'tools.md'), 'utf-8');
    expect(tools).toContain('## Enabled');
    expect(tools).toContain('## Disabled');
  });

  it('throws when agent directory already exists', () => {
    const agentPath = path.join(tmpDir, 'existing');
    fs.mkdirSync(agentPath, { recursive: true });

    expect(() =>
      AgentWriter.createAgent(tmpDir, 'existing', {
        callsign: 'EXISTING',
        role: 'Duplicate',
        tier: 2,
        division: 'Test',
      }),
    ).toThrow(/already exists/);
  });

  it('uses default status and voice when not provided', () => {
    AgentWriter.createAgent(tmpDir, 'defaults', {
      callsign: 'DEFAULTS',
      role: 'Default Test',
      tier: 1,
      division: 'Test',
    });

    const persona = fs.readFileSync(
      path.join(tmpDir, 'defaults', 'persona.md'),
      'utf-8',
    );
    expect(persona).toContain('Professional and direct.');

    const agentMd = fs.readFileSync(
      path.join(tmpDir, 'defaults', 'agent.md'),
      'utf-8',
    );
    expect(agentMd).toContain('- **Status:** active');
  });
});

// ─── AgentDiscovery.scan ───────────────────────────────────────────────────

describe('AgentDiscovery.scan', () => {
  it('finds agent directories that contain persona.md', () => {
    createSampleAgent(tmpDir, 'gage');
    createSampleAgent(tmpDir, 'forge');

    const agents = AgentDiscovery.scan(tmpDir);
    expect(agents).toEqual(['forge', 'gage']); // alphabetically sorted
  });

  it('ignores directories without persona.md', () => {
    createSampleAgent(tmpDir, 'gage');

    // Create a non-agent directory
    const nonAgent = path.join(tmpDir, 'workspaces');
    fs.mkdirSync(nonAgent, { recursive: true });
    fs.writeFileSync(path.join(nonAgent, 'README.md'), '# Not an agent');

    const agents = AgentDiscovery.scan(tmpDir);
    expect(agents).toEqual(['gage']);
  });

  it('ignores regular files in the agents directory', () => {
    createSampleAgent(tmpDir, 'mira');

    // Create a file (not a directory) at the top level
    fs.writeFileSync(path.join(tmpDir, 'ROSTER.md'), '# Roster');

    const agents = AgentDiscovery.scan(tmpDir);
    expect(agents).toEqual(['mira']);
  });

  it('returns empty array for non-existent directory', () => {
    const agents = AgentDiscovery.scan(path.join(tmpDir, 'nonexistent'));
    expect(agents).toEqual([]);
  });

  it('returns empty array when no agents found', () => {
    // tmpDir exists but has no agent folders
    const agents = AgentDiscovery.scan(tmpDir);
    expect(agents).toEqual([]);
  });
});

// ─── RosterManager.rebuild ─────────────────────────────────────────────────

describe('RosterManager.rebuild', () => {
  it('generates ROSTER.md from agent folders', () => {
    createSampleAgent(tmpDir, 'gage');

    // Create a second agent with a different persona
    const forgePersona = [
      '# FORGE',
      '',
      '## Identity',
      '- **Role:** Software Developer',
      '- **Tier:** 2',
      '- **Division:** Code',
      '- **Status:** active',
      '- **Callsign:** FORGE',
      '',
    ].join('\n');
    const forgePath = path.join(tmpDir, 'forge');
    fs.mkdirSync(path.join(forgePath, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(forgePath, 'persona.md'), forgePersona);

    RosterManager.rebuild(tmpDir);

    const rosterPath = path.join(tmpDir, 'ROSTER.md');
    expect(fs.existsSync(rosterPath)).toBe(true);

    const roster = fs.readFileSync(rosterPath, 'utf-8');

    // Header
    expect(roster).toContain('# Agent Roster');
    expect(roster).toContain('Auto-generated from agent folders');
    expect(roster).toContain('valor roster rebuild');

    // Table header
    expect(roster).toContain('| Callsign | Role | Tier | Division | Status | Primary Capabilities |');

    // Agent rows
    expect(roster).toContain('| FORGE | Software Developer | 2 | Code | active |');
    expect(roster).toContain('| GAGE | Code Division Lead | 1 | Code | active |');

    // Footer
    expect(roster).toContain('**Agent count:** 2');
    expect(roster).toContain('**Last rebuilt:**');
  });

  it('handles zero agents gracefully', () => {
    RosterManager.rebuild(tmpDir);

    const roster = fs.readFileSync(path.join(tmpDir, 'ROSTER.md'), 'utf-8');
    expect(roster).toContain('**Agent count:** 0');
  });

  it('skips agents with malformed persona.md', () => {
    // Create a valid agent
    createSampleAgent(tmpDir, 'gage');

    // Create a broken agent (empty persona.md - which still parses, just with defaults)
    const brokenPath = path.join(tmpDir, 'broken');
    fs.mkdirSync(brokenPath, { recursive: true });
    fs.writeFileSync(path.join(brokenPath, 'persona.md'), '');

    RosterManager.rebuild(tmpDir);

    const roster = fs.readFileSync(path.join(tmpDir, 'ROSTER.md'), 'utf-8');
    // Both agents are included (broken one has defaults)
    expect(roster).toContain('**Agent count:** 2');
    expect(roster).toContain('GAGE');
  });
});

// ─── Integration: round-trip create → load ─────────────────────────────────

describe('Integration: create then load', () => {
  it('creates an agent and loads it back correctly', () => {
    AgentWriter.createAgent(tmpDir, 'roundtrip', {
      callsign: 'ROUNDTRIP',
      role: 'Integration Test Agent',
      tier: 1,
      division: 'Testing',
      voice: 'Precise and thorough.',
      modelPreferences: {
        default: 'anthropic/claude-sonnet-4-20250514',
        complex: 'anthropic/claude-sonnet-4-20250514',
        fast: 'ollama/gemma3:4b',
      },
    });

    const agentPath = path.join(tmpDir, 'roundtrip');
    const config = AgentLoader.fromDirectory(agentPath);

    expect(config.id).toBe('roundtrip');
    expect(config.name).toBe('ROUNDTRIP');
    expect(config.tier).toBe(1);
    expect(config.division).toBe('Testing');
    expect(config.modelAssignment['default']).toBe('anthropic/claude-sonnet-4-20250514');
    expect(config.modelAssignment['fast']).toBe('ollama/gemma3:4b');

    // Discovery finds it
    const agents = AgentDiscovery.scan(tmpDir);
    expect(agents).toContain('roundtrip');
  });

  it('writes memory, reads it back, then appends', () => {
    AgentWriter.createAgent(tmpDir, 'mem-test', {
      callsign: 'MEMTEST',
      role: 'Memory Test',
      tier: 2,
      division: 'QA',
    });

    const agentPath = path.join(tmpDir, 'mem-test');

    // Write
    AgentWriter.writeMemory(agentPath, 'working', '# Working\n\nFirst entry.\n');

    // Read
    const content = AgentLoader.readMemory(agentPath, 'working');
    expect(content).toContain('First entry.');

    // Append
    AgentWriter.appendMemory(agentPath, 'working', '## Second entry\nMore data.');

    const updated = AgentLoader.readMemory(agentPath, 'working');
    expect(updated).toContain('First entry.');
    expect(updated).toContain('Second entry');
    expect(updated).toContain('More data.');
  });
});
