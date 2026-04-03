import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { logger } from '../utils/logger.js';
import type { EngramAdapter } from './types.js';
import { nullEngramAdapter } from './types.js';

// Local type to avoid compile-time dependency on engram package
type EngramOptions = Record<string, unknown>;

// ─── Lazy Engram loader ─────────────────────────────────────────────────────
// Engram is an optional dependency. If not installed, all memory operations
// gracefully degrade to no-ops via nullEngramAdapter.

let engramModule: {
  Engram: any;
  formatForPrompt: any;
} | null | undefined = undefined; // undefined = not yet attempted, null = failed

async function loadEngram(): Promise<typeof engramModule> {
  if (engramModule !== undefined) return engramModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await (Function('return import("engram")')() as Promise<any>);
    engramModule = {
      Engram: mod.Engram,
      formatForPrompt: mod.formatForPrompt,
    };
    logger.info('Engram module loaded — agent memory enabled');
    return engramModule;
  } catch {
    engramModule = null;
    logger.info('Engram not installed — agent memory disabled (using nullEngramAdapter)');
    return null;
  }
}

/**
 * Check whether the engram package is available at runtime.
 */
export async function isEngramAvailable(): Promise<boolean> {
  const mod = await loadEngram();
  return mod !== null;
}

// ─── Instance management ────────────────────────────────────────────────────

let engramDir = resolve(process.cwd(), 'data', 'engram');
const instances = new Map<string, any>();

/** Override used for testing — inject custom Engram options (e.g., mock embedder). */
let engramOptionOverrides: Partial<EngramOptions> = {};

/**
 * Set the directory where .engram files are stored.
 * Primarily for testing — allows using a temp directory.
 */
export function setEngramDir(dir: string): void {
  engramDir = dir;
}

/**
 * Set option overrides for all new Engram instances.
 * Primarily for testing — inject a mock embedder or generator.
 */
export function setEngramOptions(opts: Partial<EngramOptions>): void {
  engramOptionOverrides = opts;
}

/**
 * Get or create an Engram instance for an agent.
 * Each agent gets its own .engram SQLite file — fully isolated memory.
 */
async function getOrCreate(agentId: string, callsign: string): Promise<any> {
  const existing = instances.get(agentId);
  if (existing) return existing;

  const mod = await loadEngram();
  if (!mod) throw new Error('Engram not available');

  mkdirSync(engramDir, { recursive: true });

  const dbPath = resolve(engramDir, `${callsign}.engram`);
  const engram = await mod.Engram.create(dbPath, {
    ollamaUrl: process.env.OLLAMA_BASE_URL ?? process.env.ENGRAM_OLLAMA_URL ?? 'http://starbase:40114',
    ...engramOptionOverrides,
  });

  instances.set(agentId, engram);
  logger.info('Engram instance created', { agent_id: agentId, callsign, db: dbPath });
  return engram;
}

/**
 * Create a real EngramAdapter for an internal agent.
 * If Engram fails to initialize (e.g., Ollama unreachable), falls back to nullEngramAdapter.
 */
export function createEngramAdapter(agentId: string, callsign: string): EngramAdapter {
  return {
    async recall(opts) {
      try {
        const mod = await loadEngram();
        if (!mod) return '';
        const engram = await getOrCreate(agentId, callsign);
        const response = await engram.recall(opts.query, {
          topK: Math.min(Math.floor(opts.budgetTokens / 200), 10),
        });

        return mod.formatForPrompt(response, { maxChars: opts.budgetTokens * 4 });
      } catch (err) {
        logger.warn('Engram recall failed, returning empty context', {
          agent_id: agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      }
    },

    async retain(opts) {
      try {
        const mod = await loadEngram();
        if (!mod) return '';
        const engram = await getOrCreate(agentId, callsign);
        const result = await engram.retain(opts.content, {
          memoryType: opts.type,
          sourceType: 'agent_generated',
          trustScore: opts.type === 'experience' ? 0.7 : 0.5,
          source: `mission:${opts.tags?.[0] ?? 'unknown'}`,
          context: opts.domain,
        });
        return result?.chunkId ?? '';
      } catch (err) {
        logger.warn('Engram retain failed', {
          agent_id: agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      }
    },
  };
}

/**
 * Create a read-only EngramAdapter wrapper for sub-agent use.
 * Sub-agents can recall from the parent's memory but cannot retain.
 */
export function readOnlyAdapter(adapter: EngramAdapter): EngramAdapter {
  return {
    recall: adapter.recall,
    async retain() { return ''; },
  };
}

/**
 * Run extraction tick for all active Engram instances.
 * Call periodically (e.g., every 60s) from the engine's tick loop.
 */
export async function tickExtraction(): Promise<void> {
  for (const [agentId, engram] of instances) {
    try {
      await engram.processExtractions(5);
    } catch (err) {
      logger.debug('Engram extraction tick failed', {
        agent_id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Run reflection for all active Engram instances.
 * Call less frequently (e.g., every 5 min).
 */
export async function tickReflection(): Promise<void> {
  for (const [agentId, engram] of instances) {
    try {
      await engram.reflect();
    } catch (err) {
      logger.debug('Engram reflection tick failed', {
        agent_id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Close all Engram instances. Called on engine shutdown.
 */
export function closeAllEngram(): void {
  for (const [agentId, engram] of instances) {
    try {
      engram.close();
      logger.debug('Engram closed', { agent_id: agentId });
    } catch {
      // Non-fatal on shutdown
    }
  }
  instances.clear();
}

/**
 * Get status of all active Engram instances.
 */
export function getEngramStatus(): { agentId: string; active: boolean }[] {
  return [...instances.keys()].map(id => ({ agentId: id, active: true }));
}

/**
 * Get the number of active Engram instances (for testing).
 */
export function getInstanceCount(): number {
  return instances.size;
}

/**
 * Reset the lazy loader state (for testing).
 */
export function _resetEngramLoader(): void {
  engramModule = undefined;
}
