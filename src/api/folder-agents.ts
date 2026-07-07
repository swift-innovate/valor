/**
 * Folder-backed agent CRUD routes (Hono).
 *
 * Mounted at /api/folder/agents when config.storeBackend === 'folder'.
 * Delegates to AgentLoader, AgentWriter, AgentDiscovery, and RosterManager
 * from the folder-based agent store.
 */

import { Hono } from 'hono';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  AgentLoader,
  AgentWriter,
  AgentDiscovery,
  RosterManager,
} from '../store/agent-store.js';
import { isValidAgentId, agentIdFromCallsign } from '../store/ids.js';

export const folderAgentRoutes = new Hono();

// ── GET / — List agents from folder discovery ──────────────────────────────

folderAgentRoutes.get('/', (c) => {
  try {
    const agentsDir = resolve(config.agentsDir);
    const agentIds = AgentDiscovery.scan(agentsDir);

    const agents = agentIds.map((id) => {
      try {
        const agentPath = resolve(agentsDir, id);
        return AgentLoader.fromDirectory(agentPath);
      } catch (err) {
        logger.warn('Failed to load agent from folder', {
          agentId: id,
          error: String(err),
        });
        return null;
      }
    }).filter((a): a is NonNullable<typeof a> => a !== null);

    return c.json(agents);
  } catch (err) {
    logger.error('Failed to list agents', { error: String(err) });
    return c.json({ error: 'Failed to list agents' }, 500);
  }
});

// ── GET /:id — Get single agent config ─────────────────────────────────────

folderAgentRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  if (!isValidAgentId(id)) {
    return c.json({ error: 'Invalid agent id' }, 400);
  }
  const agentPath = resolve(config.agentsDir, id);

  try {
    const agentConfig = AgentLoader.fromDirectory(agentPath);
    return c.json(agentConfig);
  } catch (err) {
    logger.debug('Agent not found', { agentId: id, error: String(err) });
    return c.json({ error: 'Agent not found' }, 404);
  }
});

// ── POST / — Create a new agent folder + rebuild roster ────────────────────

folderAgentRoutes.post('/', async (c) => {
  const body = await c.req.json();

  if (!body.callsign || !body.role || !body.division) {
    return c.json(
      { error: 'callsign, role, and division are required' },
      400,
    );
  }

  const tier = Number(body.tier ?? 2);
  if (![0, 1, 2, 3].includes(tier)) {
    return c.json({ error: 'tier must be 0, 1, 2, or 3' }, 400);
  }

  const agentId = agentIdFromCallsign(String(body.callsign));
  if (!isValidAgentId(agentId)) {
    return c.json({ error: 'callsign produces an invalid agent id' }, 400);
  }
  const agentsDir = resolve(config.agentsDir);

  try {
    AgentWriter.createAgent(agentsDir, agentId, {
      callsign: body.callsign,
      role: body.role,
      tier: tier as 0 | 1 | 2 | 3,
      division: body.division,
      status: body.status,
      voice: body.voice,
      modelPreferences: body.modelPreferences,
    });

    RosterManager.rebuild(agentsDir);

    const agentPath = resolve(agentsDir, agentId);
    const agentConfig = AgentLoader.fromDirectory(agentPath);

    logger.info('Agent created via folder API', { agentId });
    return c.json(agentConfig, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create agent', { agentId, error: message });
    return c.json({ error: message }, 400);
  }
});

// ── GET /:id/memory/:file — Read agent memory file ─────────────────────────

folderAgentRoutes.get('/:id/memory/:file', (c) => {
  const id = c.req.param('id');
  const file = c.req.param('file');

  const validFiles = ['working', 'reflections', 'long-term'] as const;
  if (!validFiles.includes(file as typeof validFiles[number])) {
    return c.json(
      { error: `Invalid memory file. Must be one of: ${validFiles.join(', ')}` },
      400,
    );
  }

  if (!isValidAgentId(id)) {
    return c.json({ error: 'Invalid agent id' }, 400);
  }
  const agentPath = resolve(config.agentsDir, id);

  try {
    const content = AgentLoader.readMemory(
      agentPath,
      file as 'working' | 'reflections' | 'long-term',
    );
    return c.json({ agentId: id, file, content });
  } catch (err) {
    logger.debug('Failed to read agent memory', { agentId: id, file, error: String(err) });
    return c.json({ error: 'Agent or memory file not found' }, 404);
  }
});

// ── PUT /:id/memory/:file — Write agent memory file ────────────────────────

folderAgentRoutes.put('/:id/memory/:file', async (c) => {
  const id = c.req.param('id');
  const file = c.req.param('file');

  const validFiles = ['working', 'reflections', 'long-term'] as const;
  if (!validFiles.includes(file as typeof validFiles[number])) {
    return c.json(
      { error: `Invalid memory file. Must be one of: ${validFiles.join(', ')}` },
      400,
    );
  }

  const body = await c.req.json();
  if (typeof body.content !== 'string') {
    return c.json({ error: 'content (string) is required' }, 400);
  }

  if (!isValidAgentId(id)) {
    return c.json({ error: 'Invalid agent id' }, 400);
  }
  const agentPath = resolve(config.agentsDir, id);

  try {
    AgentWriter.writeMemory(
      agentPath,
      file as 'working' | 'reflections' | 'long-term',
      body.content,
    );
    return c.json({ ok: true, agentId: id, file });
  } catch (err) {
    logger.error('Failed to write agent memory', { agentId: id, file, error: String(err) });
    return c.json({ error: 'Failed to write memory file' }, 500);
  }
});

// ── POST /roster/rebuild — Force roster rebuild ────────────────────────────

folderAgentRoutes.post('/roster/rebuild', (c) => {
  try {
    const agentsDir = resolve(config.agentsDir);
    RosterManager.rebuild(agentsDir);
    logger.info('Roster rebuilt via API');
    return c.json({ ok: true });
  } catch (err) {
    logger.error('Failed to rebuild roster', { error: String(err) });
    return c.json({ error: 'Failed to rebuild roster' }, 500);
  }
});
