/**
 * Tests for folder-backed agent and mission API routes.
 *
 * Uses temp directories for agents and missions so tests don't touch
 * the real project folders. Mocks the config to redirect paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Temp dir helpers ─────────────────────────────────────────────────────

let tmpDir: string;
let agentsDir: string;
let missionsDir: string;

function createTmpDirs() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valor-test-'));
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

function seedMissionFolder(missionId: string, title: string, opts?: { status?: string; assignedTo?: string; priority?: string }) {
  const missionPath = path.join(missionsDir, missionId);
  fs.mkdirSync(missionPath, { recursive: true });

  const status = opts?.status ?? 'pending';
  const assignedTo = opts?.assignedTo ?? 'unassigned';
  const priority = opts?.priority ?? 'medium';

  const brief = [
    `# ${missionId}: ${title}`,
    '',
    '## Assignment',
    `- **Assigned To:** ${assignedTo}`,
    '- **Assigned By:** system',
    `- **Assigned:** ${new Date().toISOString()}`,
    `- **Priority:** ${priority}`,
    `- **Status:** ${status}`,
    '',
    '## Objective',
    'Test objective content',
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(missionPath, 'brief.md'), brief);
  fs.writeFileSync(path.join(missionPath, 'decisions.md'), '# Decision Log\n');
  fs.writeFileSync(path.join(missionPath, 'progress.md'), '# Progress\n');
}

// ─── Mock config before importing routes ──────────────────────────────────

vi.mock('../../src/config.js', () => ({
  config: {
    agentsDir: '',
    missionsDir: '',
    storeBackend: 'folder',
    logLevel: 'error',
  },
}));

// Import after mock setup
const { config } = await import('../../src/config.js');

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Folder Agent Routes', () => {
  let app: Hono;

  beforeEach(async () => {
    createTmpDirs();
    // Point the mocked config at our temp dirs
    (config as Record<string, unknown>).agentsDir = agentsDir;
    (config as Record<string, unknown>).missionsDir = missionsDir;

    // Dynamic import to get fresh route instances with updated config
    const { folderAgentRoutes } = await import('../../src/api/folder-agents.js');
    app = new Hono();
    app.route('/api/folder/agents', folderAgentRoutes);
  });

  afterEach(() => {
    cleanupTmpDirs();
  });

  it('GET /api/folder/agents — lists agents from folders', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });
    seedAgentFolder('mira', { callsign: 'Mira', role: 'Chief of Staff', tier: 1, division: 'Command' });

    const res = await app.request('/api/folder/agents');
    expect(res.status).toBe(200);

    const data = await res.json() as unknown[];
    expect(data.length).toBe(2);
  });

  it('GET /api/folder/agents — returns empty list when no agents exist', async () => {
    const res = await app.request('/api/folder/agents');
    expect(res.status).toBe(200);

    const data = await res.json() as unknown[];
    expect(data.length).toBe(0);
  });

  it('GET /api/folder/agents/:id — returns agent config', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });

    const res = await app.request('/api/folder/agents/gage');
    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    // OperativeConfig.id is set by AgentLoader.fromDirectory
    expect(data.id).toBe('gage');
  });

  it('GET /api/folder/agents/:id — returns 404 for missing agent', async () => {
    const res = await app.request('/api/folder/agents/nonexistent');
    expect(res.status).toBe(404);

    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toBeTruthy();
  });

  it('POST /api/folder/agents — creates agent folder', async () => {
    const res = await app.request('/api/folder/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callsign: 'TestAgent',
        role: 'Tester',
        tier: 2,
        division: 'QA',
      }),
    });

    expect(res.status).toBe(201);

    const data = await res.json() as Record<string, unknown>;
    // OperativeConfig.id is set to the folder name by AgentLoader
    expect(data.id).toBe('testagent');

    // Verify folder was created
    expect(fs.existsSync(path.join(agentsDir, 'testagent', 'persona.md'))).toBe(true);
  });

  it('POST /api/folder/agents — returns 400 for missing required fields', async () => {
    const res = await app.request('/api/folder/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callsign: 'Incomplete' }),
    });

    expect(res.status).toBe(400);
  });

  it('GET /api/folder/agents/:id/memory/:file — reads memory file', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });

    const res = await app.request('/api/folder/agents/gage/memory/working');
    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.agentId).toBe('gage');
    expect(data.file).toBe('working');
    expect(typeof data.content).toBe('string');
  });

  it('GET /api/folder/agents/:id/memory/:file — returns 400 for invalid file name', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });

    const res = await app.request('/api/folder/agents/gage/memory/invalid');
    expect(res.status).toBe(400);
  });

  it('PUT /api/folder/agents/:id/memory/:file — writes memory file', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });

    const res = await app.request('/api/folder/agents/gage/memory/working', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Updated working memory\nNew content here.' }),
    });

    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });

  it('POST /api/folder/agents/roster/rebuild — rebuilds roster', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });

    const res = await app.request('/api/folder/agents/roster/rebuild', {
      method: 'POST',
    });

    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });
});

describe('Folder Mission Routes', () => {
  let app: Hono;

  beforeEach(async () => {
    createTmpDirs();
    (config as Record<string, unknown>).agentsDir = agentsDir;
    (config as Record<string, unknown>).missionsDir = missionsDir;

    const { folderMissionRoutes } = await import('../../src/api/folder-missions.js');
    app = new Hono();
    app.route('/api/folder/missions', folderMissionRoutes);
  });

  afterEach(() => {
    cleanupTmpDirs();
  });

  it('GET /api/folder/missions — lists missions', async () => {
    seedMissionFolder('VM-001', 'Test Mission 1');
    seedMissionFolder('VM-002', 'Test Mission 2', { status: 'completed' });

    const res = await app.request('/api/folder/missions');
    expect(res.status).toBe(200);

    const data = await res.json() as unknown[];
    expect(data.length).toBe(2);
  });

  it('GET /api/folder/missions — returns empty list when no missions', async () => {
    const res = await app.request('/api/folder/missions');
    expect(res.status).toBe(200);

    const data = await res.json() as unknown[];
    expect(data.length).toBe(0);
  });

  it('POST /api/folder/missions — creates mission', async () => {
    const res = await app.request('/api/folder/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Mission',
        objective: 'Test the folder store',
        priority: 'high',
      }),
    });

    expect(res.status).toBe(201);

    const data = await res.json() as Record<string, unknown>;
    expect(data.missionId).toBeTruthy();
    expect(data.title).toBe('New Mission');
  });

  it('POST /api/folder/missions — returns 400 for missing fields', async () => {
    const res = await app.request('/api/folder/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No objective' }),
    });

    expect(res.status).toBe(400);
  });

  it('GET /api/folder/missions/:id — returns mission brief', async () => {
    seedMissionFolder('VM-TEST', 'Test Mission');

    const res = await app.request('/api/folder/missions/VM-TEST');
    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.missionId).toBe('VM-TEST');
  });

  it('GET /api/folder/missions/:id — returns 404 for missing mission', async () => {
    const res = await app.request('/api/folder/missions/VM-NOPE');
    expect(res.status).toBe(404);
  });

  it('POST /api/folder/missions/:id/assign — assigns agent', async () => {
    seedMissionFolder('VM-ASGN', 'Assignment Test');

    const res = await app.request('/api/folder/missions/VM-ASGN/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'gage' }),
    });

    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.assignedTo).toBe('gage');
  });

  it('POST /api/folder/missions/:id/assign — returns 400 without agentId', async () => {
    seedMissionFolder('VM-ASGN', 'Assignment Test');

    const res = await app.request('/api/folder/missions/VM-ASGN/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('POST /api/folder/missions/:id/complete — completes mission', async () => {
    seedMissionFolder('VM-COMP', 'Complete Test', { status: 'in_progress' });

    const res = await app.request('/api/folder/missions/VM-COMP/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'All tasks done.' }),
    });

    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.state).toBe('COMPLETED');
  });

  it('POST /api/folder/missions/:id/decisions — appends decision', async () => {
    seedMissionFolder('VM-DEC', 'Decision Test');

    const res = await app.request('/api/folder/missions/VM-DEC/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Use folder store',
        decision: 'Switch to folder-based persistence',
        rationale: 'Simpler than SQLite for MVP',
        decidedBy: 'gage',
      }),
    });

    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);

    // Verify file was written
    const decisionsContent = fs.readFileSync(
      path.join(missionsDir, 'VM-DEC', 'decisions.md'),
      'utf-8',
    );
    expect(decisionsContent).toContain('Use folder store');
  });

  it('POST /api/folder/missions/:id/progress — appends progress', async () => {
    seedMissionFolder('VM-PROG', 'Progress Test');

    const res = await app.request('/api/folder/missions/VM-PROG/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase: 'observe',
        agent: 'gage',
        summary: 'Initial observation complete',
      }),
    });

    expect(res.status).toBe(200);
  });

  it('GET /api/folder/missions/:id/handoff — returns 404 when no handoff exists', async () => {
    seedMissionFolder('VM-HND', 'Handoff Test');

    const res = await app.request('/api/folder/missions/VM-HND/handoff');
    // The mission exists but has no handoff.md content
    expect(res.status).toBe(404);
  });
});

describe('Folder Routes — path traversal guards', () => {
  let app: Hono;

  beforeEach(async () => {
    createTmpDirs();
    (config as Record<string, unknown>).agentsDir = agentsDir;
    (config as Record<string, unknown>).missionsDir = missionsDir;

    const { folderAgentRoutes } = await import('../../src/api/folder-agents.js');
    const { folderMissionRoutes } = await import('../../src/api/folder-missions.js');
    app = new Hono();
    app.route('/api/folder/agents', folderAgentRoutes);
    app.route('/api/folder/missions', folderMissionRoutes);
  });

  afterEach(() => {
    cleanupTmpDirs();
  });

  it('rejects traversal in GET agent id', async () => {
    const res = await app.request('/api/folder/agents/..%2F..%2Fetc');
    expect(res.status).toBe(400);
  });

  it('rejects traversal in agent memory write', async () => {
    const res = await app.request('/api/folder/agents/..%2F..%2Fevil/memory/working', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'pwned' }),
    });
    expect(res.status).toBe(400);
    // Nothing may be written outside agentsDir
    expect(fs.existsSync(path.join(agentsDir, '..', 'evil'))).toBe(false);
  });

  it('rejects agent creation with traversal callsign', async () => {
    const res = await app.request('/api/folder/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callsign: '../evil', role: 'x', division: 'x' }),
    });
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(agentsDir, '..', 'evil'))).toBe(false);
  });

  it('rejects traversal in mission id on writes', async () => {
    for (const [url, body] of [
      ['/api/folder/missions/..%2Fescape/decisions', { title: 't', decision: 'd', rationale: 'r', decidedBy: 'x' }],
      ['/api/folder/missions/..%2Fescape/progress', { phase: 'act', agent: 'a', summary: 's' }],
      ['/api/folder/missions/..%2Fescape/complete', { summary: 's' }],
      ['/api/folder/missions/..%2Fescape/assign', { agentId: 'gage' }],
    ] as const) {
      const res = await app.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    expect(fs.existsSync(path.join(missionsDir, '..', 'escape'))).toBe(false);
  });

  it('rejects non-VM mission ids', async () => {
    const res = await app.request('/api/folder/missions/completed');
    expect(res.status).toBe(400);
  });

  it('rejects invalid agentId in mission run body', async () => {
    seedMissionFolder('VM-042', 'Test', { assignedTo: 'gage' });
    const res = await app.request('/api/folder/missions/VM-042/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: '../../etc' }),
    });
    expect(res.status).toBe(400);
  });

  it('still accepts valid ids', async () => {
    seedAgentFolder('gage', { callsign: 'Gage', role: 'Code Lead', tier: 1, division: 'Code' });
    const res = await app.request('/api/folder/agents/gage');
    expect(res.status).toBe(200);
  });
});
