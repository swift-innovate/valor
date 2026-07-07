/**
 * Folder-backed mission CRUD routes (Hono).
 *
 * Mounted at /api/folder/missions when config.storeBackend === 'folder'.
 * Delegates to MissionLoader, MissionWriter, and MissionManager
 * from the folder-based mission store.
 */

import { Hono } from 'hono';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  MissionLoader,
  MissionWriter,
  MissionManager,
} from '../store/mission-store.js';
import type { DecisionEntry, ProgressEntry } from '../store/mission-store.js';
import { executeFolderMission } from '../execution/index.js';
import { isValidMissionId, isValidAgentId } from '../store/ids.js';

export const folderMissionRoutes = new Hono();

// ── GET / — List missions ──────────────────────────────────────────────────

folderMissionRoutes.get('/', (c) => {
  try {
    const missionsDir = resolve(config.missionsDir);
    const missions = MissionManager.list(missionsDir);
    return c.json(missions);
  } catch (err) {
    logger.error('Failed to list missions', { error: String(err) });
    return c.json({ error: 'Failed to list missions' }, 500);
  }
});

// ── GET /:id — Get single mission (MissionBrief) ──────────────────────────

folderMissionRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const missionPath = resolve(config.missionsDir, id);

  try {
    const brief = MissionLoader.fromDirectory(missionPath);
    return c.json(brief);
  } catch (err) {
    logger.debug('Mission not found', { missionId: id, error: String(err) });
    return c.json({ error: 'Mission not found' }, 404);
  }
});

// ── POST / — Create a new mission ──────────────────────────────────────────

folderMissionRoutes.post('/', async (c) => {
  const body = await c.req.json();

  if (!body.title || !body.objective) {
    return c.json({ error: 'title and objective are required' }, 400);
  }

  try {
    const missionsDir = resolve(config.missionsDir);
    const missionId = MissionManager.create(
      missionsDir,
      body.title,
      body.objective,
      {
        priority: body.priority,
        assignedTo: body.assignedTo,
        assignedBy: body.assignedBy,
        successCriteria: body.successCriteria,
      },
    );

    const missionPath = resolve(missionsDir, missionId);
    const brief = MissionLoader.fromDirectory(missionPath);

    logger.info('Mission created via folder API', { missionId });
    return c.json(brief, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create mission', { error: message });
    return c.json({ error: message }, 400);
  }
});

// ── POST /:id/assign — Assign agent to mission ────────────────────────────

folderMissionRoutes.post('/:id/assign', async (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const body = await c.req.json();

  if (!body.agentId) {
    return c.json({ error: 'agentId is required' }, 400);
  }

  try {
    const missionsDir = resolve(config.missionsDir);
    MissionManager.assign(missionsDir, id, body.agentId);

    const missionPath = resolve(missionsDir, id);
    const brief = MissionLoader.fromDirectory(missionPath);

    return c.json(brief);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      return c.json({ error: 'Mission not found' }, 404);
    }
    logger.error('Failed to assign mission', { missionId: id, error: message });
    return c.json({ error: message }, 400);
  }
});

// ── POST /:id/complete — Complete mission with handoff ─────────────────────

folderMissionRoutes.post('/:id/complete', async (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const body = await c.req.json();

  if (!body.summary) {
    return c.json({ error: 'summary is required' }, 400);
  }

  try {
    const missionsDir = resolve(config.missionsDir);
    MissionManager.complete(missionsDir, id, body.summary);

    const missionPath = resolve(missionsDir, id);
    const brief = MissionLoader.fromDirectory(missionPath);

    return c.json(brief);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      return c.json({ error: 'Mission not found' }, 404);
    }
    logger.error('Failed to complete mission', { missionId: id, error: message });
    return c.json({ error: message }, 400);
  }
});

// ── POST /:id/decisions — Append decision ──────────────────────────────────

folderMissionRoutes.post('/:id/decisions', async (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const body = await c.req.json();

  if (!body.title || !body.decision || !body.rationale || !body.decidedBy) {
    return c.json(
      { error: 'title, decision, rationale, and decidedBy are required' },
      400,
    );
  }

  const missionPath = resolve(config.missionsDir, id);

  try {
    const entry: DecisionEntry = {
      title: body.title,
      decision: body.decision,
      rationale: body.rationale,
      decidedBy: body.decidedBy,
      impact: body.impact,
    };
    MissionWriter.appendDecision(missionPath, entry);
    return c.json({ ok: true, missionId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to append decision', { missionId: id, error: message });
    return c.json({ error: message }, 500);
  }
});

// ── POST /:id/progress — Append progress entry ────────────────────────────

folderMissionRoutes.post('/:id/progress', async (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const body = await c.req.json();

  if (!body.phase || !body.agent || !body.summary) {
    return c.json(
      { error: 'phase, agent, and summary are required' },
      400,
    );
  }

  const missionPath = resolve(config.missionsDir, id);

  try {
    const entry: ProgressEntry = {
      phase: body.phase,
      agent: body.agent,
      summary: body.summary,
    };
    MissionWriter.appendProgress(missionPath, entry);
    return c.json({ ok: true, missionId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to append progress', { missionId: id, error: message });
    return c.json({ error: message }, 500);
  }
});

// ── POST /:id/run — Execute mission through the operative loop ──────────────

folderMissionRoutes.post('/:id/run', async (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const missionsDir = resolve(config.missionsDir);
  const agentsDir = resolve(config.agentsDir);
  const missionPath = resolve(missionsDir, id);

  // Load the mission to get the assigned agent
  let brief;
  try {
    brief = MissionLoader.fromDirectory(missionPath);
  } catch {
    return c.json({ error: 'Mission not found' }, 404);
  }

  // Determine agent — body can override, otherwise use brief.assignedTo
  let agentId: string;
  try {
    const body = await c.req.json();
    agentId = body.agentId || brief.assignedTo;
  } catch {
    agentId = brief.assignedTo;
  }

  if (!agentId) {
    return c.json({ error: 'No agent assigned. Assign an agent first or provide agentId in body.' }, 400);
  }
  if (!isValidAgentId(agentId)) {
    return c.json({ error: 'Invalid agent id' }, 400);
  }

  logger.info('Mission run requested via API', { missionId: id, agentId });

  try {
    await executeFolderMission(id, agentId, { agentsDir, missionsDir });
    const updatedBrief = MissionLoader.fromDirectory(missionPath);
    return c.json({ ok: true, missionId: id, agentId, outcome: updatedBrief.state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Mission run failed', { missionId: id, agentId, error: message });
    return c.json({ error: message }, 500);
  }
});

// ── GET /:id/handoff — Read handoff document ───────────────────────────────

folderMissionRoutes.get('/:id/handoff', (c) => {
  const id = c.req.param('id');
  if (!isValidMissionId(id)) {
    return c.json({ error: 'Invalid mission id' }, 400);
  }
  const missionPath = resolve(config.missionsDir, id);

  try {
    const content = MissionLoader.readHandoff(missionPath);
    if (!content) {
      return c.json({ error: 'No handoff document found' }, 404);
    }
    return c.json({ missionId: id, content });
  } catch (err) {
    logger.debug('Failed to read handoff', { missionId: id, error: String(err) });
    return c.json({ error: 'Mission not found' }, 404);
  }
});
