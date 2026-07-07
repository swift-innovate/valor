/**
 * Tests for CLI command handlers.
 *
 * Tests the exported handler functions directly rather than spawning
 * child processes. Uses temp directories for isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Temp dir helpers ─────────────────────────────────────────────────────

let tmpDir: string;
let agentsDir: string;
let missionsDir: string;

function createTmpDirs() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valor-cli-test-'));
  agentsDir = path.join(tmpDir, 'agents');
  missionsDir = path.join(tmpDir, 'missions');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(missionsDir, { recursive: true });
}

function cleanupTmpDirs() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Seed helpers ─────────────────────────────────────────────────────────

function seedAgentFolder(agentId: string, opts: { callsign: string; role: string; tier: number; division: string }) {
  const agentPath = path.join(agentsDir, agentId);
  fs.mkdirSync(agentPath, { recursive: true });
  fs.mkdirSync(path.join(agentPath, 'memory'), { recursive: true });

  const persona = [
    `# ${opts.callsign}`,
    '',
    `- **Role:** ${opts.role}`,
    `- **Tier:** ${opts.tier}`,
    `- **Division:** ${opts.division}`,
    `- **Status:** active`,
    `- **Voice:** professional`,
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(agentPath, 'persona.md'), persona);
  fs.writeFileSync(path.join(agentPath, 'rules.md'), '# Rules\n');
  fs.writeFileSync(path.join(agentPath, 'tools.md'), '# Tools\n');
  fs.writeFileSync(path.join(agentPath, 'memory', 'working.md'), '# Working Memory\n');
  fs.writeFileSync(path.join(agentPath, 'memory', 'reflections.md'), '# Reflections\n');
  fs.writeFileSync(path.join(agentPath, 'memory', 'long-term.md'), '# Long-Term Memory\n');
}

function seedMissionFolder(missionId: string, title: string, opts?: { status?: string; assignedTo?: string }) {
  const missionPath = path.join(missionsDir, missionId);
  fs.mkdirSync(missionPath, { recursive: true });

  const status = opts?.status ?? 'pending';
  const assignedTo = opts?.assignedTo ?? 'unassigned';

  const brief = [
    `# ${missionId}: ${title}`,
    '',
    '## Assignment',
    `- **Assigned To:** ${assignedTo}`,
    '- **Assigned By:** system',
    `- **Assigned:** ${new Date().toISOString()}`,
    '- **Priority:** medium',
    `- **Status:** ${status}`,
    '',
    '## Objective',
    'Test objective content',
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(missionPath, 'brief.md'), brief);
  fs.writeFileSync(path.join(missionPath, 'decisions.md'), '# Decision Log\n');
  fs.writeFileSync(path.join(missionPath, 'progress.md'), '# Progress\n');
}

// ─── Mock config ──────────────────────────────────────────────────────────

vi.mock('../../src/config.js', () => ({
  config: {
    defaultModel: 'ollama/gemma3:12b',
    agentsDir: '',
    missionsDir: '',
    storeBackend: 'folder',
    logLevel: 'error',
  },
}));

const { config } = await import('../../src/config.js');

// ─── Import CLI handlers ─────────────────────────────────────────────────

const {
  handleAgentList,
  handleAgentCreate,
  handleMissionCreate,
  handleMissionList,
  handleMissionAssign,
  handleRosterRebuild,
  handleStatus,
  dispatch,
} = await import('../../src/cli/index.js');

// ─── Capture stdout ───────────────────────────────────────────────────────

function captureOutput(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join('');
}

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  };

  try {
    fn();
  } finally {
    process.stderr.write = originalWrite;
  }

  return chunks.join('');
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('CLI Commands', () => {
  beforeEach(() => {
    createTmpDirs();
    (config as Record<string, unknown>).agentsDir = agentsDir;
    (config as Record<string, unknown>).missionsDir = missionsDir;
    process.exitCode = undefined;
  });

  afterEach(() => {
    cleanupTmpDirs();
    process.exitCode = undefined;
  });

  describe('agent list', () => {
    it('lists agents from folders', () => {
      seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });
      seedAgentFolder('mira', { callsign: 'Mira', role: 'Chief of Staff', tier: 1, division: 'Command' });

      const output = captureOutput(() => handleAgentList());
      expect(output).toContain('Agents (2)');
    });

    it('shows message when no agents exist', () => {
      const output = captureOutput(() => handleAgentList());
      expect(output).toContain('No agents found');
    });
  });

  describe('agent create', () => {
    it('creates an agent folder', () => {
      const output = captureOutput(() =>
        handleAgentCreate(['TestBot', '--role', 'Tester', '--tier', '2', '--division', 'QA']),
      );

      expect(output).toContain('Agent created: testbot');
      expect(fs.existsSync(path.join(agentsDir, 'testbot', 'persona.md'))).toBe(true);
    });

    it('errors when missing required flags', () => {
      captureStderr(() =>
        handleAgentCreate(['TestBot']),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('mission list', () => {
    it('lists missions from folders', () => {
      seedMissionFolder('VM-001', 'Test Mission 1');
      seedMissionFolder('VM-002', 'Test Mission 2', { status: 'completed' });

      const output = captureOutput(() => handleMissionList());
      expect(output).toContain('Missions (2)');
      expect(output).toContain('VM-001');
      expect(output).toContain('VM-002');
    });

    it('shows message when no missions exist', () => {
      const output = captureOutput(() => handleMissionList());
      expect(output).toContain('No missions found');
    });
  });

  describe('mission create', () => {
    it('creates a mission folder', () => {
      const output = captureOutput(() =>
        handleMissionCreate(['New Mission', '--objective', 'Build something', '--priority', 'high']),
      );

      expect(output).toContain('Mission created: VM-');
    });

    it('errors when missing objective', () => {
      captureStderr(() =>
        handleMissionCreate(['No Objective Mission']),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('mission assign', () => {
    it('assigns agent to mission', () => {
      seedMissionFolder('VM-ASN', 'Assign Test');

      const output = captureOutput(() =>
        handleMissionAssign(['VM-ASN', 'gage']),
      );

      expect(output).toContain('VM-ASN assigned to gage');
    });

    it('errors when args are missing', () => {
      captureStderr(() =>
        handleMissionAssign([]),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('roster rebuild', () => {
    it('rebuilds roster', () => {
      seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });

      const output = captureOutput(() => handleRosterRebuild());
      expect(output).toContain('Roster rebuilt');
    });
  });

  describe('status', () => {
    it('shows aggregate status', () => {
      seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });
      seedMissionFolder('VM-001', 'Active Mission', { status: 'assigned' });
      seedMissionFolder('VM-002', 'Done Mission', { status: 'completed' });
      seedMissionFolder('VM-003', 'Pending Mission', { status: 'pending' });

      const output = captureOutput(() => handleStatus());
      expect(output).toContain('Agents:');
      expect(output).toContain('1');
      expect(output).toContain('Missions (total):');
      expect(output).toContain('3');
    });
  });

  describe('dispatch', () => {
    it('dispatches help on no args', () => {
      const output = captureOutput(() => dispatch([]));
      expect(output).toContain('VALOR CLI');
      expect(output).toContain('Commands:');
    });

    it('dispatches --help flag', () => {
      const output = captureOutput(() => dispatch(['--help']));
      expect(output).toContain('VALOR CLI');
    });

    it('sets exit code for unknown command', () => {
      captureStderr(() => dispatch(['unknown']));
      expect(process.exitCode).toBe(1);
    });

    it('dispatches agent list', () => {
      const output = captureOutput(() => dispatch(['agent', 'list']));
      expect(output).toContain('No agents found');
    });

    it('dispatches mission list', () => {
      const output = captureOutput(() => dispatch(['mission', 'list']));
      expect(output).toContain('No missions found');
    });

    it('dispatches status', () => {
      const output = captureOutput(() => dispatch(['status']));
      expect(output).toContain('VALOR Engine Status');
    });
  });
});
