/**
 * Mission Folder Store — folder-based persistence for VALOR missions.
 *
 * Each mission is a directory under `missions/{mission_id}/` containing:
 *   brief.md, decisions.md, progress.md, handoff.md
 *
 * The folder is the source of truth. No database required.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import type { InternalMissionState, MissionBrief } from '../execution/types.js';

// ─── Supporting types ──────────────────────────────────────────────────────

export interface DecisionEntry {
  readonly title: string;
  readonly decision: string;
  readonly rationale: string;
  readonly decidedBy: string;
  readonly impact?: string;
}

export interface ProgressEntry {
  readonly phase: string;
  readonly agent: string;
  readonly summary: string;
}

export interface HandoffEntry {
  readonly summary: string;
  readonly openItems?: readonly string[];
  readonly keyFiles?: readonly string[];
}

export interface CreateMissionOpts {
  readonly priority?: 'low' | 'medium' | 'high' | 'critical';
  readonly assignedTo?: string;
  readonly assignedBy?: string;
  readonly successCriteria?: readonly string[];
}

export interface MissionSummary {
  readonly missionId: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly assignedTo: string;
}

// ─── Status mapping ────────────────────────────────────────────────────────

const STATUS_TO_STATE: Record<string, InternalMissionState> = {
  pending: 'PENDING',
  pending_approval: 'PENDING_APPROVAL',
  assigned: 'ASSIGNED',
  in_progress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  failed: 'FAILED',
  escalated: 'ESCALATED',
  aborted: 'ABORTED',
};

function mapStatusToState(status: string): InternalMissionState {
  const normalized = status.toLowerCase().trim().replace(/\s+/g, '_');
  const state = STATUS_TO_STATE[normalized];
  if (!state) {
    logger.warn('Unknown mission status, defaulting to PENDING', { status });
    return 'PENDING';
  }
  return state;
}

// ─── Atomic write helper ───────────────────────────────────────────────────

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ─── Brief parsing helpers ─────────────────────────────────────────────────

function extractField(content: string, fieldName: string): string {
  // Matches patterns like: - **Field Name:** value
  const pattern = new RegExp(`^\\s*-\\s*\\*\\*${fieldName}:\\*\\*\\s*(.+)$`, 'mi');
  const match = content.match(pattern);
  return match ? match[1].trim() : '';
}

function extractTitle(content: string): string {
  // First line should be: # {MissionId}: {Title}
  const match = content.match(/^#\s+[^:]+:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function extractSection(content: string, heading: string): string {
  // Find the heading, capture everything until the next ## heading or end of string.
  // We avoid multiline `$` ambiguity by splitting on headings instead.
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, 'm');
  const headingMatch = headingPattern.exec(content);
  if (!headingMatch) return '';

  const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
  // Find next ## heading
  const nextHeading = afterHeading.search(/^##\s+/m);
  const sectionBody = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  return sectionBody.trim();
}

function extractObjective(content: string): string {
  return extractSection(content, 'Objective');
}

function extractSuccessCriteria(content: string): string[] {
  const sectionBody = extractSection(content, 'Success Criteria');
  if (!sectionBody) return [];

  const lines = sectionBody.split('\n');
  const criteria: string[] = [];
  for (const line of lines) {
    const itemMatch = line.match(/^\s*-\s+(.+)$/);
    if (itemMatch) {
      criteria.push(itemMatch[1].trim());
    }
  }
  return criteria;
}

// ─── MissionLoader ─────────────────────────────────────────────────────────

export const MissionLoader = {
  /**
   * Read brief.md from a mission directory and hydrate into a MissionBrief.
   * Throws if brief.md does not exist.
   */
  fromDirectory(missionPath: string): MissionBrief {
    const briefPath = path.join(missionPath, 'brief.md');

    if (!fs.existsSync(briefPath)) {
      throw new Error(`Mission brief not found: ${briefPath}`);
    }

    const content = fs.readFileSync(briefPath, 'utf-8');
    const missionId = path.basename(missionPath);
    const title = extractTitle(content);
    const assignedTo = extractField(content, 'Assigned To');
    const assignedBy = extractField(content, 'Assigned By');
    const priorityRaw = extractField(content, 'Priority').toLowerCase();
    const statusRaw = extractField(content, 'Status');
    const objective = extractObjective(content);
    const successCriteria = extractSuccessCriteria(content);

    const validPriorities = ['low', 'medium', 'high', 'critical'] as const;
    const priority = validPriorities.includes(priorityRaw as typeof validPriorities[number])
      ? (priorityRaw as MissionBrief['priority'])
      : 'medium';

    const brief: MissionBrief = {
      missionId,
      title,
      assignedTo,
      assignedBy,
      priority,
      objectives: objective ? [objective] : [],
      successCriteria: successCriteria.length > 0 ? successCriteria : undefined,
      state: mapStatusToState(statusRaw),
    };

    logger.debug('Mission loaded from directory', { missionId, title, state: brief.state });
    return brief;
  },

  /** Read decisions.md content. Returns empty string if file is missing. */
  readDecisions(missionPath: string): string {
    return readFileOrEmpty(path.join(missionPath, 'decisions.md'));
  },

  /** Read progress.md content. Returns empty string if file is missing. */
  readProgress(missionPath: string): string {
    return readFileOrEmpty(path.join(missionPath, 'progress.md'));
  },

  /** Read handoff.md content. Returns empty string if file is missing. */
  readHandoff(missionPath: string): string {
    return readFileOrEmpty(path.join(missionPath, 'handoff.md'));
  },
} as const;

// ─── MissionWriter ─────────────────────────────────────────────────────────

export const MissionWriter = {
  /**
   * Append a decision entry to decisions.md. Creates the file with a header
   * if it does not exist.
   */
  appendDecision(missionPath: string, decision: DecisionEntry): void {
    const filePath = path.join(missionPath, 'decisions.md');
    let content = readFileOrEmpty(filePath);

    if (!content) {
      content = '# Decision Log\n';
    }

    const timestamp = new Date().toISOString();
    const entry = [
      '',
      `## ${timestamp} — ${decision.title}`,
      `- **Decision:** ${decision.decision}`,
      `- **Rationale:** ${decision.rationale}`,
      `- **Decided by:** ${decision.decidedBy}`,
    ];

    if (decision.impact) {
      entry.push(`- **Impact:** ${decision.impact}`);
    }

    content += entry.join('\n') + '\n';

    atomicWriteFileSync(filePath, content);
    logger.debug('Decision appended', { missionPath, title: decision.title });
  },

  /**
   * Append a progress entry row to progress.md. Creates the file with
   * header and table header if it does not exist.
   */
  appendProgress(missionPath: string, entry: ProgressEntry): void {
    const filePath = path.join(missionPath, 'progress.md');
    let content = readFileOrEmpty(filePath);

    if (!content) {
      content = [
        '# Progress',
        '',
        '## Phase Log',
        '| Timestamp | Phase | Agent | Summary |',
        '|-----------|-------|-------|---------|',
        '',
      ].join('\n');
    }

    const timestamp = new Date().toISOString();
    const row = `| ${timestamp} | ${entry.phase} | ${entry.agent} | ${entry.summary} |`;

    // Insert row before the last empty line or at the end of the table
    // Find the table and append after the last row
    const lines = content.split('\n');
    // Find the last non-empty line that looks like a table row or separator
    let insertIndex = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== '') {
        insertIndex = i + 1;
        break;
      }
    }

    lines.splice(insertIndex, 0, row);
    content = lines.join('\n');

    // Ensure trailing newline
    if (!content.endsWith('\n')) {
      content += '\n';
    }

    atomicWriteFileSync(filePath, content);
    logger.debug('Progress entry appended', { missionPath, phase: entry.phase });
  },

  /** Write (or overwrite) handoff.md with atomic write. */
  writeHandoff(missionPath: string, handoff: HandoffEntry): void {
    const filePath = path.join(missionPath, 'handoff.md');

    const sections: string[] = [
      '# Handoff Context',
      '',
      '## Summary',
      handoff.summary,
    ];

    if (handoff.openItems && handoff.openItems.length > 0) {
      sections.push('', '## Open Items');
      for (const item of handoff.openItems) {
        sections.push(`- ${item}`);
      }
    }

    if (handoff.keyFiles && handoff.keyFiles.length > 0) {
      sections.push('', '## Key Files');
      for (const file of handoff.keyFiles) {
        sections.push(`- ${file}`);
      }
    }

    const content = sections.join('\n') + '\n';
    atomicWriteFileSync(filePath, content);
    logger.debug('Handoff written', { missionPath });
  },

  /** Update the Status field in brief.md via atomic write. */
  updateBriefStatus(missionPath: string, status: string): void {
    const briefPath = path.join(missionPath, 'brief.md');
    const content = fs.readFileSync(briefPath, 'utf-8');

    const updated = content.replace(
      /^(\s*-\s*\*\*Status:\*\*\s*).+$/m,
      `$1${status}`,
    );

    atomicWriteFileSync(briefPath, updated);
    logger.debug('Brief status updated', { missionPath, status });
  },

  /** Update the Assigned To field and Assigned date in brief.md. */
  updateBriefAssignment(missionPath: string, agentId: string): void {
    const briefPath = path.join(missionPath, 'brief.md');
    let content = fs.readFileSync(briefPath, 'utf-8');

    content = content.replace(
      /^(\s*-\s*\*\*Assigned To:\*\*\s*).+$/m,
      `$1${agentId}`,
    );

    const now = new Date().toISOString();
    content = content.replace(
      /^(\s*-\s*\*\*Assigned:\*\*\s*).+$/m,
      `$1${now}`,
    );

    atomicWriteFileSync(briefPath, content);
    logger.debug('Brief assignment updated', { missionPath, agentId });
  },
} as const;

// ─── MissionManager ────────────────────────────────────────────────────────

export const MissionManager = {
  /**
   * Create a new mission folder with brief.md, decisions.md, and progress.md.
   * Returns the generated mission ID (format: VM-{nanoid(6)}).
   */
  create(
    missionsDir: string,
    title: string,
    objective: string,
    opts?: CreateMissionOpts,
  ): string {
    const missionId = `VM-${nanoid(6)}`;
    const missionPath = path.join(missionsDir, missionId);

    fs.mkdirSync(missionPath, { recursive: true });

    const priority = opts?.priority ?? 'medium';
    const assignedTo = opts?.assignedTo ?? 'unassigned';
    const assignedBy = opts?.assignedBy ?? 'system';
    const now = new Date().toISOString();
    const status = opts?.assignedTo ? 'assigned' : 'pending';

    // Build brief.md
    const briefLines: string[] = [
      `# ${missionId}: ${title}`,
      '',
      '## Assignment',
      `- **Assigned To:** ${assignedTo}`,
      `- **Assigned By:** ${assignedBy}`,
      `- **Assigned:** ${now}`,
      `- **Priority:** ${priority}`,
      `- **Status:** ${status}`,
      '',
      '## Objective',
      objective,
    ];

    if (opts?.successCriteria && opts.successCriteria.length > 0) {
      briefLines.push('', '## Success Criteria');
      for (const criterion of opts.successCriteria) {
        briefLines.push(`- ${criterion}`);
      }
    }

    const briefContent = briefLines.join('\n') + '\n';
    atomicWriteFileSync(path.join(missionPath, 'brief.md'), briefContent);

    // Create empty decisions.md
    atomicWriteFileSync(
      path.join(missionPath, 'decisions.md'),
      '# Decision Log\n',
    );

    // Create empty progress.md
    atomicWriteFileSync(
      path.join(missionPath, 'progress.md'),
      [
        '# Progress',
        '',
        '## Phase Log',
        '| Timestamp | Phase | Agent | Summary |',
        '|-----------|-------|-------|---------|',
        '',
      ].join('\n'),
    );

    logger.info('Mission created', { missionId, title, priority, assignedTo });
    return missionId;
  },

  /** Assign a mission to an agent. Updates brief.md assignment and status. */
  assign(missionsDir: string, missionId: string, agentId: string): void {
    const missionPath = path.join(missionsDir, missionId);

    if (!fs.existsSync(path.join(missionPath, 'brief.md'))) {
      throw new Error(`Mission not found: ${missionId}`);
    }

    MissionWriter.updateBriefAssignment(missionPath, agentId);
    MissionWriter.updateBriefStatus(missionPath, 'assigned');

    logger.info('Mission assigned', { missionId, agentId });
  },

  /** Mark a mission as completed: write handoff.md and update status. */
  complete(missionsDir: string, missionId: string, summary: string): void {
    const missionPath = path.join(missionsDir, missionId);

    if (!fs.existsSync(path.join(missionPath, 'brief.md'))) {
      throw new Error(`Mission not found: ${missionId}`);
    }

    MissionWriter.writeHandoff(missionPath, { summary });
    MissionWriter.updateBriefStatus(missionPath, 'completed');

    logger.info('Mission completed', { missionId });
  },

  /**
   * List all missions by scanning subdirectories. Returns a summary for
   * each mission that has a brief.md.
   */
  list(missionsDir: string): MissionSummary[] {
    if (!fs.existsSync(missionsDir)) {
      return [];
    }

    const entries = fs.readdirSync(missionsDir, { withFileTypes: true });
    const summaries: MissionSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const missionPath = path.join(missionsDir, entry.name);
      const briefPath = path.join(missionPath, 'brief.md');

      if (!fs.existsSync(briefPath)) continue;

      try {
        const content = fs.readFileSync(briefPath, 'utf-8');
        summaries.push({
          missionId: entry.name,
          title: extractTitle(content),
          status: extractField(content, 'Status'),
          priority: extractField(content, 'Priority'),
          assignedTo: extractField(content, 'Assigned To'),
        });
      } catch (err) {
        logger.warn('Failed to read mission brief', {
          missionId: entry.name,
          error: String(err),
        });
      }
    }

    return summaries;
  },

  /**
   * Reassign a mission to a different agent. Writes a handoff with the
   * reason, then updates the brief.md assignment.
   */
  reassign(
    missionsDir: string,
    missionId: string,
    newAgentId: string,
    reason: string,
  ): void {
    const missionPath = path.join(missionsDir, missionId);

    if (!fs.existsSync(path.join(missionPath, 'brief.md'))) {
      throw new Error(`Mission not found: ${missionId}`);
    }

    // Read current assignment for handoff context
    const brief = MissionLoader.fromDirectory(missionPath);

    MissionWriter.writeHandoff(missionPath, {
      summary: `Reassigned from ${brief.assignedTo} to ${newAgentId}. Reason: ${reason}`,
      openItems: [`Previous assignee: ${brief.assignedTo}`, `Reason for reassignment: ${reason}`],
    });

    MissionWriter.updateBriefAssignment(missionPath, newAgentId);
    MissionWriter.updateBriefStatus(missionPath, 'assigned');

    logger.info('Mission reassigned', {
      missionId,
      from: brief.assignedTo,
      to: newAgentId,
      reason,
    });
  },
} as const;
