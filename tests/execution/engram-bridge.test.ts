import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { freshDb, cleanupDb } from '../helpers/test-db.js';
import { clearSubscriptions } from '../../src/bus/event-bus.js';
import {
  createEngramAdapter,
  readOnlyAdapter,
  closeAllEngram,
  getEngramStatus,
  getInstanceCount,
  tickExtraction,
  tickReflection,
  setEngramDir,
  setEngramOptions,
  isEngramAvailable,
  _resetEngramLoader,
} from '../../src/execution/engram-bridge.js';
import { nullEngramAdapter } from '../../src/execution/types.js';

// ─── Mock providers (local types — no engram import required) ───────────────

interface EmbeddingProvider {
  dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

interface GenerationProvider {
  name: string;
  generate(prompt?: string): Promise<string>;
}

/** Deterministic mock embedder that hashes text into a fixed-dimension vector. */
function mockEmbedder(): EmbeddingProvider {
  return {
    dimensions: 64,
    async embed(text: string): Promise<Float32Array> {
      const vec = new Float32Array(64);
      for (let i = 0; i < text.length && i < 64; i++) {
        vec[i] = text.charCodeAt(i) / 256;
      }
      return vec;
    },
  };
}

/** Mock generator that returns minimal valid responses. */
function mockGenerator(): GenerationProvider {
  return {
    name: 'mock/generator',
    async generate() {
      return '{"entities":[],"relations":[]}';
    },
  };
}

// ─── Resolve engram availability once ──────────────────────────────────────

let engramAvailable: boolean;

beforeEach(async () => {
  // Reset loader so isEngramAvailable re-probes on each test run
  _resetEngramLoader();
  engramAvailable = await isEngramAvailable();
});

// ─── Tests that require real engram ────────────────────────────────────────

describe('createEngramAdapter (real engram)', () => {
  let testDir: string;

  beforeEach(() => {
    freshDb();
    clearSubscriptions();
    closeAllEngram();

    testDir = resolve(tmpdir(), `valor-engram-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
    setEngramDir(testDir);
    setEngramOptions({ embedder: mockEmbedder(), generator: mockGenerator() });
  });

  afterEach(() => {
    closeAllEngram();
    clearSubscriptions();
    cleanupDb();
    setEngramOptions({});
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it.skipIf(!engramAvailable)('creates an adapter with recall and retain methods', () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');
    expect(adapter.recall).toBeTypeOf('function');
    expect(adapter.retain).toBeTypeOf('function');
  });

  it.skipIf(!engramAvailable)('recall returns minimal content on first call (no memories yet)', async () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');
    const result = await adapter.recall({
      agentId: 'agent-1',
      domains: ['shared'],
      query: 'test query',
      budgetTokens: 2000,
    });
    expect(typeof result).toBe('string');
    expect(result).not.toContain('trust:');
  });

  it.skipIf(!engramAvailable)('retain stores content and returns chunk ID', async () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');
    const chunkId = await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'experience',
      content: 'The deployment succeeded with zero downtime.',
      tags: ['mission-123', 'reflect'],
    });

    expect(typeof chunkId).toBe('string');
    expect(chunkId.length).toBeGreaterThan(0);
  });

  it.skipIf(!engramAvailable)('creates .engram file in the configured directory', async () => {
    const { existsSync } = await import('fs');
    const adapter = createEngramAdapter('agent-1', 'test-agent');

    await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'Test fact for persistence check.',
    });

    const engramPath = resolve(testDir, 'test-agent.engram');
    expect(existsSync(engramPath)).toBe(true);
  });

  it.skipIf(!engramAvailable)('retained content can be recalled', async () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');

    await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'The capital of France is Paris and it has the Eiffel Tower.',
    });

    const result = await adapter.recall({
      agentId: 'agent-1',
      domains: ['shared'],
      query: 'Paris France capital',
      budgetTokens: 2000,
    });

    expect(result).toContain('Paris');
  });

  it.skipIf(!engramAvailable)('recall gracefully returns empty on error', async () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');

    await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'Seed fact.',
    });

    closeAllEngram();

    const result = await adapter.recall({
      agentId: 'agent-1',
      domains: ['shared'],
      query: 'anything',
      budgetTokens: 2000,
    });

    expect(typeof result).toBe('string');
  });
});

describe('Instance management', () => {
  let testDir: string;

  beforeEach(() => {
    freshDb();
    clearSubscriptions();
    closeAllEngram();

    testDir = resolve(tmpdir(), `valor-engram-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
    setEngramDir(testDir);
    setEngramOptions({ embedder: mockEmbedder(), generator: mockGenerator() });
  });

  afterEach(() => {
    closeAllEngram();
    clearSubscriptions();
    cleanupDb();
    setEngramOptions({});
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it.skipIf(!engramAvailable)('multiple agents get separate Engram instances', async () => {
    const { existsSync } = await import('fs');
    const adapterA = createEngramAdapter('alpha', 'agent-alpha');
    const adapterB = createEngramAdapter('beta', 'agent-beta');

    await adapterA.retain({
      agentId: 'alpha',
      domain: 'shared',
      type: 'world',
      content: 'Alpha agent fact.',
    });

    await adapterB.retain({
      agentId: 'beta',
      domain: 'shared',
      type: 'world',
      content: 'Beta agent fact.',
    });

    expect(getInstanceCount()).toBe(2);

    const status = getEngramStatus();
    expect(status).toHaveLength(2);
    expect(status.some(s => s.agentId === 'alpha')).toBe(true);
    expect(status.some(s => s.agentId === 'beta')).toBe(true);

    expect(existsSync(resolve(testDir, 'agent-alpha.engram'))).toBe(true);
    expect(existsSync(resolve(testDir, 'agent-beta.engram'))).toBe(true);
  });

  it.skipIf(!engramAvailable)('closeAllEngram closes all instances and clears the map', async () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');
    await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'Fact before close.',
    });

    expect(getInstanceCount()).toBe(1);

    closeAllEngram();

    expect(getInstanceCount()).toBe(0);
    expect(getEngramStatus()).toHaveLength(0);
  });

  it('getEngramStatus returns empty when no instances', () => {
    expect(getEngramStatus()).toEqual([]);
  });
});

describe('readOnlyAdapter', () => {
  let testDir: string;

  beforeEach(() => {
    freshDb();
    clearSubscriptions();
    closeAllEngram();

    testDir = resolve(tmpdir(), `valor-engram-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
    setEngramDir(testDir);
    setEngramOptions({ embedder: mockEmbedder(), generator: mockGenerator() });
  });

  afterEach(() => {
    closeAllEngram();
    clearSubscriptions();
    cleanupDb();
    setEngramOptions({});
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it.skipIf(!engramAvailable)('allows recall but retain is a no-op', async () => {
    const adapter = createEngramAdapter('agent-1', 'test-agent');

    await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'Important fact for read-only test about quantum computing.',
    });

    const roAdapter = readOnlyAdapter(adapter);

    const recallResult = await roAdapter.recall({
      agentId: 'agent-1',
      domains: ['shared'],
      query: 'quantum computing',
      budgetTokens: 2000,
    });
    expect(typeof recallResult).toBe('string');

    const retainResult = await roAdapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'experience',
      content: 'This should not be stored.',
    });
    expect(retainResult).toBe('');
  });
});

describe('nullEngramAdapter', () => {
  it('recall returns empty string', async () => {
    const result = await nullEngramAdapter.recall({
      agentId: 'test',
      domains: ['shared'],
      query: 'anything',
      budgetTokens: 2000,
    });
    expect(result).toBe('');
  });

  it('retain returns empty string', async () => {
    const result = await nullEngramAdapter.retain({
      agentId: 'test',
      domain: 'shared',
      type: 'world',
      content: 'anything',
    });
    expect(result).toBe('');
  });
});

describe('Graceful degradation (no engram)', () => {
  it('isEngramAvailable returns a boolean', async () => {
    const result = await isEngramAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('createEngramAdapter recall returns empty when engram unavailable', async () => {
    if (engramAvailable) return; // only relevant when engram is NOT installed
    const adapter = createEngramAdapter('agent-1', 'test-agent');
    const result = await adapter.recall({
      agentId: 'agent-1',
      domains: ['shared'],
      query: 'anything',
      budgetTokens: 2000,
    });
    expect(result).toBe('');
  });

  it('createEngramAdapter retain returns empty when engram unavailable', async () => {
    if (engramAvailable) return;
    const adapter = createEngramAdapter('agent-1', 'test-agent');
    const result = await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'anything',
    });
    expect(result).toBe('');
  });
});

describe('Background ticks', () => {
  it('tickExtraction runs without error on empty instances', async () => {
    await expect(tickExtraction()).resolves.not.toThrow();
  });

  it('tickReflection runs without error on empty instances', async () => {
    await expect(tickReflection()).resolves.not.toThrow();
  });

  it.skipIf(!engramAvailable)('tickExtraction runs on active instances', async () => {
    const testDir = resolve(tmpdir(), `valor-engram-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
    setEngramDir(testDir);
    setEngramOptions({ embedder: mockEmbedder(), generator: mockGenerator() });

    const adapter = createEngramAdapter('agent-1', 'test-agent');
    await adapter.retain({
      agentId: 'agent-1',
      domain: 'shared',
      type: 'world',
      content: 'Fact to trigger extraction queue.',
    });

    await expect(tickExtraction()).resolves.not.toThrow();

    closeAllEngram();
    setEngramOptions({});
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });
});
