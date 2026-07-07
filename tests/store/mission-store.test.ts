import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  MissionLoader,
  MissionWriter,
  MissionManager,
} from '../../src/store/mission-store.js';
import type { DecisionEntry, ProgressEntry, HandoffEntry } from '../../src/store/mission-store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valor-mission-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper: write a standard brief.md ──────────────────────────────────────

function writeBrief(missionPath: string, overrides: Record<string, string> = {}): void {
  fs.mkdirSync(missionPath, { recursive: true });

  const fields = {
    missionId: 'VM-TEST01',
    title: 'Test Mission',
    assignedTo: 'gage',
    assignedBy: 'mira',
    priority: 'high',
    status: 'in_progress',
    objective: 'Complete the test objective',
    ...overrides,
  };

  const id = path.basename(missionPath);

  const lines = [
    `# ${id}: ${fields.title}`,
    '',
    '## Assignment',
    `- **Assigned To:** ${fields.assignedTo}`,
    `- **Assigned By:** ${fields.assignedBy}`,
    `- **Assigned:** 2026-04-09T12:00:00.000Z`,
    `- **Priority:** ${fields.priority}`,
    `- **Status:** ${fields.status}`,
    '',
    '## Objective',
    fields.objective,
    '',
    '## Success Criteria',
    '- Tests pass',
    '- No regressions',
  ];

  fs.writeFileSync(path.join(missionPath, 'brief.md'), lines.join('\n') + '\n', 'utf-8');
}

// ─── MissionManager.create ──────────────────────────────────────────────────

describe('MissionManager.create', () => {
  it('creates folder with brief.md, decisions.md, and progress.md', () => {
    const missionId = MissionManager.create(tmpDir, 'Deploy Service', 'Deploy the new service to production', {
      priority: 'critical',
      assignedTo: 'forge',
      assignedBy: 'gage',
      successCriteria: ['Service is running', 'Health check passes'],
    });

    expect(missionId).toMatch(/^VM-[a-zA-Z0-9_-]{6}$/);

    const missionPath = path.join(tmpDir, missionId);
    expect(fs.existsSync(path.join(missionPath, 'brief.md'))).toBe(true);
    expect(fs.existsSync(path.join(missionPath, 'decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(missionPath, 'progress.md'))).toBe(true);

    const brief = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(brief).toContain(`# ${missionId}: Deploy Service`);
    expect(brief).toContain('**Priority:** critical');
    expect(brief).toContain('**Assigned To:** forge');
    expect(brief).toContain('**Assigned By:** gage');
    expect(brief).toContain('**Status:** assigned');
    expect(brief).toContain('Deploy the new service to production');
    expect(brief).toContain('- Service is running');
    expect(brief).toContain('- Health check passes');
  });

  it('creates with default values when no opts provided', () => {
    const missionId = MissionManager.create(tmpDir, 'Simple Task', 'Do the thing');
    const missionPath = path.join(tmpDir, missionId);

    const brief = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(brief).toContain('**Priority:** medium');
    expect(brief).toContain('**Assigned To:** unassigned');
    expect(brief).toContain('**Assigned By:** system');
    expect(brief).toContain('**Status:** pending');
  });
});

// ─── MissionLoader.fromDirectory ────────────────────────────────────────────

describe('MissionLoader.fromDirectory', () => {
  it('parses brief.md into a MissionBrief', () => {
    const missionPath = path.join(tmpDir, 'VM-PARSE1');
    writeBrief(missionPath);

    const brief = MissionLoader.fromDirectory(missionPath);

    expect(brief.missionId).toBe('VM-PARSE1');
    expect(brief.title).toBe('Test Mission');
    expect(brief.assignedTo).toBe('gage');
    expect(brief.assignedBy).toBe('mira');
    expect(brief.priority).toBe('high');
    expect(brief.state).toBe('IN_PROGRESS');
    expect(brief.objectives).toEqual(['Complete the test objective']);
    expect(brief.successCriteria).toEqual(['Tests pass', 'No regressions']);
  });

  it('throws when brief.md is missing', () => {
    const missionPath = path.join(tmpDir, 'VM-MISSING');
    fs.mkdirSync(missionPath, { recursive: true });

    expect(() => MissionLoader.fromDirectory(missionPath)).toThrow('Mission brief not found');
  });

  it('maps all status values correctly', () => {
    const statusMap: Array<[string, string]> = [
      ['pending', 'PENDING'],
      ['in_progress', 'IN_PROGRESS'],
      ['completed', 'COMPLETED'],
      ['failed', 'FAILED'],
      ['escalated', 'ESCALATED'],
      ['aborted', 'ABORTED'],
      ['assigned', 'ASSIGNED'],
    ];

    for (const [status, expectedState] of statusMap) {
      const missionPath = path.join(tmpDir, `VM-STATUS-${status}`);
      writeBrief(missionPath, { status });

      const brief = MissionLoader.fromDirectory(missionPath);
      expect(brief.state).toBe(expectedState);
    }
  });

  it('defaults to medium priority for unrecognized values', () => {
    const missionPath = path.join(tmpDir, 'VM-BADPRI');
    writeBrief(missionPath, { priority: 'ultra' });

    const brief = MissionLoader.fromDirectory(missionPath);
    expect(brief.priority).toBe('medium');
  });

  it('round-trips through MissionManager.create', () => {
    const missionId = MissionManager.create(tmpDir, 'Round Trip', 'Test the round trip', {
      priority: 'high',
      assignedTo: 'forge',
      assignedBy: 'gage',
      successCriteria: ['Data preserved'],
    });

    const brief = MissionLoader.fromDirectory(path.join(tmpDir, missionId));
    expect(brief.missionId).toBe(missionId);
    expect(brief.title).toBe('Round Trip');
    expect(brief.priority).toBe('high');
    expect(brief.assignedTo).toBe('forge');
    expect(brief.assignedBy).toBe('gage');
    expect(brief.objectives).toEqual(['Test the round trip']);
    expect(brief.successCriteria).toEqual(['Data preserved']);
    expect(brief.state).toBe('ASSIGNED');
  });
});

// ─── MissionLoader read helpers ─────────────────────────────────────────────

describe('MissionLoader read helpers', () => {
  it('readDecisions returns empty string when file is missing', () => {
    const missionPath = path.join(tmpDir, 'VM-EMPTY');
    fs.mkdirSync(missionPath, { recursive: true });

    expect(MissionLoader.readDecisions(missionPath)).toBe('');
  });

  it('readProgress returns empty string when file is missing', () => {
    const missionPath = path.join(tmpDir, 'VM-EMPTY2');
    fs.mkdirSync(missionPath, { recursive: true });

    expect(MissionLoader.readProgress(missionPath)).toBe('');
  });

  it('readHandoff returns empty string when file is missing', () => {
    const missionPath = path.join(tmpDir, 'VM-EMPTY3');
    fs.mkdirSync(missionPath, { recursive: true });

    expect(MissionLoader.readHandoff(missionPath)).toBe('');
  });
});

// ─── MissionWriter.appendDecision ──────────────────────────────────────────

describe('MissionWriter.appendDecision', () => {
  it('adds an entry to existing decisions.md', () => {
    const missionPath = path.join(tmpDir, 'VM-DEC1');
    fs.mkdirSync(missionPath, { recursive: true });
    fs.writeFileSync(path.join(missionPath, 'decisions.md'), '# Decision Log\n', 'utf-8');

    const entry: DecisionEntry = {
      title: 'Use TypeScript',
      decision: 'Adopt TypeScript for all new code',
      rationale: 'Type safety reduces bugs',
      decidedBy: 'gage',
      impact: 'All future modules',
    };

    MissionWriter.appendDecision(missionPath, entry);

    const content = fs.readFileSync(path.join(missionPath, 'decisions.md'), 'utf-8');
    expect(content).toContain('# Decision Log');
    expect(content).toContain('Use TypeScript');
    expect(content).toContain('**Decision:** Adopt TypeScript for all new code');
    expect(content).toContain('**Rationale:** Type safety reduces bugs');
    expect(content).toContain('**Decided by:** gage');
    expect(content).toContain('**Impact:** All future modules');
  });

  it('creates decisions.md with header if missing', () => {
    const missionPath = path.join(tmpDir, 'VM-DEC2');
    fs.mkdirSync(missionPath, { recursive: true });

    const entry: DecisionEntry = {
      title: 'First Decision',
      decision: 'Start here',
      rationale: 'Because',
      decidedBy: 'mira',
    };

    MissionWriter.appendDecision(missionPath, entry);

    const content = fs.readFileSync(path.join(missionPath, 'decisions.md'), 'utf-8');
    expect(content).toContain('# Decision Log');
    expect(content).toContain('First Decision');
  });

  it('appends multiple decisions sequentially', () => {
    const missionPath = path.join(tmpDir, 'VM-DEC3');
    fs.mkdirSync(missionPath, { recursive: true });

    MissionWriter.appendDecision(missionPath, {
      title: 'Decision A',
      decision: 'Do A',
      rationale: 'Reason A',
      decidedBy: 'gage',
    });

    MissionWriter.appendDecision(missionPath, {
      title: 'Decision B',
      decision: 'Do B',
      rationale: 'Reason B',
      decidedBy: 'forge',
    });

    const content = fs.readFileSync(path.join(missionPath, 'decisions.md'), 'utf-8');
    expect(content).toContain('Decision A');
    expect(content).toContain('Decision B');
    // Both should be in the same file
    const decisionCount = (content.match(/^##\s+\d{4}-/gm) ?? []).length;
    expect(decisionCount).toBe(2);
  });
});

// ─── MissionWriter.appendProgress ──────────────────────────────────────────

describe('MissionWriter.appendProgress', () => {
  it('adds a row to the progress table', () => {
    const missionPath = path.join(tmpDir, 'VM-PROG1');
    fs.mkdirSync(missionPath, { recursive: true });

    // Create a progress.md with table header
    const header = [
      '# Progress',
      '',
      '## Phase Log',
      '| Timestamp | Phase | Agent | Summary |',
      '|-----------|-------|-------|---------|',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(missionPath, 'progress.md'), header, 'utf-8');

    const entry: ProgressEntry = {
      phase: 'observe',
      agent: 'gage',
      summary: 'Scanned environment',
    };

    MissionWriter.appendProgress(missionPath, entry);

    const content = fs.readFileSync(path.join(missionPath, 'progress.md'), 'utf-8');
    expect(content).toContain('| observe | gage | Scanned environment |');
  });

  it('creates progress.md if missing', () => {
    const missionPath = path.join(tmpDir, 'VM-PROG2');
    fs.mkdirSync(missionPath, { recursive: true });

    MissionWriter.appendProgress(missionPath, {
      phase: 'plan',
      agent: 'forge',
      summary: 'Drafted plan',
    });

    const content = fs.readFileSync(path.join(missionPath, 'progress.md'), 'utf-8');
    expect(content).toContain('# Progress');
    expect(content).toContain('| plan | forge | Drafted plan |');
  });

  it('appends multiple rows', () => {
    const missionPath = path.join(tmpDir, 'VM-PROG3');
    fs.mkdirSync(missionPath, { recursive: true });

    MissionWriter.appendProgress(missionPath, {
      phase: 'observe',
      agent: 'gage',
      summary: 'First observation',
    });

    MissionWriter.appendProgress(missionPath, {
      phase: 'act',
      agent: 'gage',
      summary: 'Took action',
    });

    const content = fs.readFileSync(path.join(missionPath, 'progress.md'), 'utf-8');
    expect(content).toContain('First observation');
    expect(content).toContain('Took action');
  });
});

// ─── MissionWriter.writeHandoff ─────────────────────────────────────────────

describe('MissionWriter.writeHandoff', () => {
  it('creates handoff.md with all sections', () => {
    const missionPath = path.join(tmpDir, 'VM-HAND1');
    fs.mkdirSync(missionPath, { recursive: true });

    const handoff: HandoffEntry = {
      summary: 'Mission completed successfully',
      openItems: ['Review final output', 'Update docs'],
      keyFiles: ['src/store/mission-store.ts', 'tests/store/mission-store.test.ts'],
    };

    MissionWriter.writeHandoff(missionPath, handoff);

    const content = fs.readFileSync(path.join(missionPath, 'handoff.md'), 'utf-8');
    expect(content).toContain('# Handoff Context');
    expect(content).toContain('## Summary');
    expect(content).toContain('Mission completed successfully');
    expect(content).toContain('## Open Items');
    expect(content).toContain('- Review final output');
    expect(content).toContain('- Update docs');
    expect(content).toContain('## Key Files');
    expect(content).toContain('- src/store/mission-store.ts');
  });

  it('omits sections when arrays are empty', () => {
    const missionPath = path.join(tmpDir, 'VM-HAND2');
    fs.mkdirSync(missionPath, { recursive: true });

    MissionWriter.writeHandoff(missionPath, { summary: 'Done' });

    const content = fs.readFileSync(path.join(missionPath, 'handoff.md'), 'utf-8');
    expect(content).toContain('## Summary');
    expect(content).not.toContain('## Open Items');
    expect(content).not.toContain('## Key Files');
  });
});

// ─── MissionWriter.updateBriefStatus ────────────────────────────────────────

describe('MissionWriter.updateBriefStatus', () => {
  it('changes the status in brief.md', () => {
    const missionPath = path.join(tmpDir, 'VM-STAT1');
    writeBrief(missionPath, { status: 'in_progress' });

    MissionWriter.updateBriefStatus(missionPath, 'completed');

    const content = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(content).toContain('**Status:** completed');
    expect(content).not.toContain('**Status:** in_progress');
  });

  it('preserves other fields when updating status', () => {
    const missionPath = path.join(tmpDir, 'VM-STAT2');
    writeBrief(missionPath);

    MissionWriter.updateBriefStatus(missionPath, 'failed');

    const content = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(content).toContain('**Assigned To:** gage');
    expect(content).toContain('**Priority:** high');
    expect(content).toContain('Test Mission');
    expect(content).toContain('**Status:** failed');
  });
});

// ─── MissionManager.assign ──────────────────────────────────────────────────

describe('MissionManager.assign', () => {
  it('updates assignment in brief.md', () => {
    const missionId = MissionManager.create(tmpDir, 'Assign Test', 'Test assignment');

    MissionManager.assign(tmpDir, missionId, 'forge');

    const missionPath = path.join(tmpDir, missionId);
    const content = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(content).toContain('**Assigned To:** forge');
    expect(content).toContain('**Status:** assigned');
  });

  it('throws for non-existent mission', () => {
    expect(() => MissionManager.assign(tmpDir, 'VM-NONEXIST', 'gage'))
      .toThrow('Mission not found');
  });
});

// ─── MissionManager.complete ────────────────────────────────────────────────

describe('MissionManager.complete', () => {
  it('writes handoff and updates status to completed', () => {
    const missionId = MissionManager.create(tmpDir, 'Complete Test', 'Test completion', {
      assignedTo: 'gage',
    });

    MissionManager.complete(tmpDir, missionId, 'All objectives met');

    const missionPath = path.join(tmpDir, missionId);

    // Check handoff exists
    const handoff = fs.readFileSync(path.join(missionPath, 'handoff.md'), 'utf-8');
    expect(handoff).toContain('All objectives met');

    // Check status updated
    const brief = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(brief).toContain('**Status:** completed');
  });

  it('throws for non-existent mission', () => {
    expect(() => MissionManager.complete(tmpDir, 'VM-GHOST', 'done'))
      .toThrow('Mission not found');
  });
});

// ─── MissionManager.list ────────────────────────────────────────────────────

describe('MissionManager.list', () => {
  it('returns summaries of all missions', () => {
    MissionManager.create(tmpDir, 'Mission A', 'Do A', { priority: 'high', assignedTo: 'gage' });
    MissionManager.create(tmpDir, 'Mission B', 'Do B', { priority: 'low', assignedTo: 'forge' });
    MissionManager.create(tmpDir, 'Mission C', 'Do C');

    const list = MissionManager.list(tmpDir);
    expect(list).toHaveLength(3);

    const titles = list.map((s) => s.title);
    expect(titles).toContain('Mission A');
    expect(titles).toContain('Mission B');
    expect(titles).toContain('Mission C');

    const missionA = list.find((s) => s.title === 'Mission A');
    expect(missionA?.priority).toBe('high');
    expect(missionA?.assignedTo).toBe('gage');
    expect(missionA?.status).toBe('assigned');
  });

  it('returns empty array for non-existent directory', () => {
    const result = MissionManager.list(path.join(tmpDir, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('skips directories without brief.md', () => {
    MissionManager.create(tmpDir, 'Real Mission', 'Has brief');

    // Create a directory without brief.md
    fs.mkdirSync(path.join(tmpDir, 'not-a-mission'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'not-a-mission', 'random.txt'), 'hi', 'utf-8');

    const list = MissionManager.list(tmpDir);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Real Mission');
  });

  it('skips non-directory entries', () => {
    MissionManager.create(tmpDir, 'Real One', 'Objective');

    // Create a file in the missions directory (not a folder)
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Notes', 'utf-8');

    const list = MissionManager.list(tmpDir);
    expect(list).toHaveLength(1);
  });
});

// ─── MissionManager.reassign ────────────────────────────────────────────────

describe('MissionManager.reassign', () => {
  it('writes handoff and updates assignment', () => {
    const missionId = MissionManager.create(tmpDir, 'Reassign Test', 'Test reassignment', {
      assignedTo: 'gage',
      assignedBy: 'mira',
    });

    MissionManager.reassign(tmpDir, missionId, 'forge', 'Gage is overloaded');

    const missionPath = path.join(tmpDir, missionId);

    // Check handoff
    const handoff = fs.readFileSync(path.join(missionPath, 'handoff.md'), 'utf-8');
    expect(handoff).toContain('Reassigned from gage to forge');
    expect(handoff).toContain('Gage is overloaded');

    // Check assignment updated
    const brief = fs.readFileSync(path.join(missionPath, 'brief.md'), 'utf-8');
    expect(brief).toContain('**Assigned To:** forge');
    expect(brief).toContain('**Status:** assigned');
  });

  it('throws for non-existent mission', () => {
    expect(() => MissionManager.reassign(tmpDir, 'VM-NOPE', 'forge', 'reason'))
      .toThrow('Mission not found');
  });
});
