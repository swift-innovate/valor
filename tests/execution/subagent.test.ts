import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, cleanupDb } from '../helpers/test-db.js';
import { clearSubscriptions, subscribe } from '../../src/bus/event-bus.js';
import type { EventEnvelope } from '../../src/types/index.js';
import type { ProviderAdapter, ProviderResponse } from '../../src/providers/types.js';
import {
  dispatchSubagents,
  formatSubagentResults,
  registerProfile,
  getProfile,
  listProfiles,
  clearProfiles,
} from '../../src/execution/subagent.js';
import type { SubagentTask, SubagentResult } from '../../src/execution/subagent.js';
import type { EngramAdapter } from '../../src/execution/types.js';
import { nullEngramAdapter } from '../../src/execution/types.js';

// ─── Mock provider ─────────────────────────────────────────────────────────

function createMockProvider(opts?: {
  delay?: number;
  failOnModel?: string;
  response?: Partial<ProviderResponse>;
}): ProviderAdapter {
  return {
    id: 'mock-provider',
    name: 'Mock Provider',
    type: 'ollama',
    capabilities: {
      streaming: true,
      models: ['mock/default'],
      maxTokens: 4096,
    },
    async complete(req) {
      if (opts?.delay) {
        await new Promise(resolve => setTimeout(resolve, opts.delay));
      }
      if (opts?.failOnModel && req.model === opts.failOnModel) {
        throw new Error(`Model ${req.model} unavailable`);
      }
      return {
        content: opts?.response?.content ?? `Response to: ${(req.messages[0] as { content: string }).content}`,
        model: opts?.response?.model ?? req.model,
        usage: opts?.response?.usage ?? { input_tokens: 10, output_tokens: 20 },
        stop_reason: 'end',
      };
    },
    async stream() {
      throw new Error('Not implemented');
    },
    async healthCheck() {
      return { healthy: true, latency_ms: 1 };
    },
  };
}

// ─── Test setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  freshDb();
  clearSubscriptions();
  clearProfiles();
});

afterEach(() => {
  clearProfiles();
  clearSubscriptions();
  cleanupDb();
});

// ─── Profile registry ──────────────────────────────────────────────────────

describe('Profile registry', () => {
  it('registers and retrieves profiles', () => {
    registerProfile({
      name: 'Researcher',
      description: 'Research sub-agent',
      systemPrompt: 'You are a researcher.',
      model: 'ollama/phi3',
      maxTokens: 1000,
    });

    const profile = getProfile('researcher');
    expect(profile).toBeDefined();
    expect(profile!.name).toBe('Researcher');
    expect(profile!.model).toBe('ollama/phi3');
  });

  it('profile lookup is case-insensitive', () => {
    registerProfile({
      name: 'Analyst',
      description: 'Analysis sub-agent',
      systemPrompt: 'You are an analyst.',
    });

    expect(getProfile('ANALYST')).toBeDefined();
    expect(getProfile('analyst')).toBeDefined();
  });

  it('listProfiles returns all registered', () => {
    registerProfile({ name: 'A', description: 'a', systemPrompt: 'a' });
    registerProfile({ name: 'B', description: 'b', systemPrompt: 'b' });
    expect(listProfiles()).toHaveLength(2);
  });

  it('clearProfiles removes all', () => {
    registerProfile({ name: 'A', description: 'a', systemPrompt: 'a' });
    clearProfiles();
    expect(listProfiles()).toHaveLength(0);
  });
});

// ─── dispatchSubagents ─────────────────────────────────────────────────────

describe('dispatchSubagents', () => {
  it('dispatches 3 tasks and returns all results', async () => {
    const provider = createMockProvider();
    const tasks: SubagentTask[] = [
      { id: 'task-1', instruction: 'Summarize topic A' },
      { id: 'task-2', instruction: 'Summarize topic B' },
      { id: 'task-3', instruction: 'Summarize topic C' },
    ];

    const results = await dispatchSubagents(tasks, provider);

    expect(results).toHaveLength(3);
    expect(results[0]!.id).toBe('task-1');
    expect(results[1]!.id).toBe('task-2');
    expect(results[2]!.id).toBe('task-3');
    expect(results.every(r => r.content.length > 0)).toBe(true);
    expect(results.every(r => !r.error)).toBe(true);
  });

  it('returns empty array for empty tasks', async () => {
    const provider = createMockProvider();
    const results = await dispatchSubagents([], provider);
    expect(results).toEqual([]);
  });

  it('batches tasks in groups of 5 (concurrency limit)', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const provider: ProviderAdapter = {
      ...createMockProvider(),
      async complete(req) {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
        await new Promise(resolve => setTimeout(resolve, 10));
        currentConcurrent--;
        return {
          content: 'done',
          model: req.model,
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: 'end',
        };
      },
    };

    const tasks: SubagentTask[] = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      instruction: `Task ${i}`,
    }));

    const results = await dispatchSubagents(tasks, provider);

    expect(results).toHaveLength(10);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('isolates errors — failed task does not affect others', async () => {
    const provider: ProviderAdapter = {
      ...createMockProvider(),
      async complete(req) {
        const content = (req.messages[0] as { content: string }).content;
        if (content.includes('FAIL')) {
          throw new Error('Deliberate failure');
        }
        return {
          content: 'success',
          model: req.model,
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: 'end',
        };
      },
    };

    const tasks: SubagentTask[] = [
      { id: 'ok-1', instruction: 'Do something' },
      { id: 'bad', instruction: 'FAIL this task' },
      { id: 'ok-2', instruction: 'Do another thing' },
    ];

    const results = await dispatchSubagents(tasks, provider);

    expect(results).toHaveLength(3);

    const ok1 = results.find(r => r.id === 'ok-1')!;
    const bad = results.find(r => r.id === 'bad')!;
    const ok2 = results.find(r => r.id === 'ok-2')!;

    expect(ok1.error).toBeUndefined();
    expect(ok1.content).toBe('success');
    expect(bad.error).toBe('Deliberate failure');
    expect(bad.content).toBe('');
    expect(ok2.error).toBeUndefined();
    expect(ok2.content).toBe('success');
  });

  it('uses profile system prompt and maxTokens', async () => {
    let capturedSystem = '';
    let capturedMaxTokens = 0;

    const provider: ProviderAdapter = {
      ...createMockProvider(),
      async complete(req) {
        capturedSystem = req.system ?? '';
        capturedMaxTokens = req.max_tokens;
        return {
          content: 'done',
          model: req.model,
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: 'end',
        };
      },
    };

    registerProfile({
      name: 'Coder',
      description: 'Code review sub-agent',
      systemPrompt: 'You review code for bugs.',
      maxTokens: 500,
    });

    const tasks: SubagentTask[] = [
      { id: 'review-1', instruction: 'Review this function', profile: 'coder' },
    ];

    await dispatchSubagents(tasks, provider);

    expect(capturedSystem).toContain('You review code for bugs.');
    expect(capturedMaxTokens).toBe(500);
  });

  it('returns error for unknown profile', async () => {
    const provider = createMockProvider();
    const tasks: SubagentTask[] = [
      { id: 'task-1', instruction: 'Do something', profile: 'nonexistent' },
    ];

    const results = await dispatchSubagents(tasks, provider);

    expect(results).toHaveLength(1);
    expect(results[0]!.error).toContain('Profile not found: nonexistent');
  });

  it('task systemPrompt overrides profile systemPrompt', async () => {
    let capturedSystem = '';

    const provider: ProviderAdapter = {
      ...createMockProvider(),
      async complete(req) {
        capturedSystem = req.system ?? '';
        return {
          content: 'done',
          model: req.model,
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: 'end',
        };
      },
    };

    registerProfile({
      name: 'Generic',
      description: 'Generic sub-agent',
      systemPrompt: 'Profile prompt.',
    });

    const tasks: SubagentTask[] = [
      { id: 'task-1', instruction: 'Do it', profile: 'generic', systemPrompt: 'Custom override prompt.' },
    ];

    await dispatchSubagents(tasks, provider);

    expect(capturedSystem).toContain('Custom override prompt.');
    expect(capturedSystem).not.toContain('Profile prompt.');
  });

  it('injects read-only Engram recall context into system prompt', async () => {
    let capturedSystem = '';

    const provider: ProviderAdapter = {
      ...createMockProvider(),
      async complete(req) {
        capturedSystem = req.system ?? '';
        return {
          content: 'done',
          model: req.model,
          usage: { input_tokens: 5, output_tokens: 10 },
          stop_reason: 'end',
        };
      },
    };

    const mockEngram: EngramAdapter = {
      async recall() {
        return '## Memory Context\nThe capital of France is Paris.';
      },
      async retain() {
        return 'should-not-be-called';
      },
    };

    const tasks: SubagentTask[] = [
      { id: 'task-1', instruction: 'What is the capital of France?' },
    ];

    await dispatchSubagents(tasks, provider, mockEngram);

    expect(capturedSystem).toContain('Paris');
  });

  it('publishes sitrep.subagent event when parentContext provided', async () => {
    const provider = createMockProvider();
    const events: EventEnvelope[] = [];

    subscribe('sitrep.subagent', (evt) => {
      events.push(evt);
    });

    const tasks: SubagentTask[] = [
      { id: 'task-1', instruction: 'Do A' },
      { id: 'task-2', instruction: 'Do B' },
    ];

    await dispatchSubagents(tasks, provider, undefined, {
      agentId: 'agent-alpha',
      missionId: 'mission-123',
    });

    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload.mission_id).toBe('mission-123');
    expect(payload.subagent_count).toBe(2);
    expect(payload.completed).toBe(2);
    expect(payload.failed).toBe(0);
  });

  it('does not publish sitrep when no parentContext', async () => {
    const provider = createMockProvider();
    const events: EventEnvelope[] = [];

    subscribe('sitrep.*', (evt) => {
      events.push(evt);
    });

    await dispatchSubagents(
      [{ id: 'task-1', instruction: 'Do it' }],
      provider,
    );

    // No sitrep.subagent should be published
    const subagentEvents = events.filter(e => e.type === 'sitrep.subagent');
    expect(subagentEvents).toHaveLength(0);
  });

  it('reports token usage from provider response', async () => {
    const provider = createMockProvider({
      response: {
        content: 'result',
        model: 'mock/default',
        usage: { input_tokens: 150, output_tokens: 300 },
      },
    });

    const results = await dispatchSubagents(
      [{ id: 'task-1', instruction: 'Count tokens' }],
      provider,
    );

    expect(results[0]!.inputTokens).toBe(150);
    expect(results[0]!.outputTokens).toBe(300);
  });
});

// ─── formatSubagentResults ─────────────────────────────────────────────────

describe('formatSubagentResults', () => {
  it('formats successful results', () => {
    const results: SubagentResult[] = [
      { id: 'task-1', content: 'Answer A', model: 'mock', inputTokens: 10, outputTokens: 20 },
      { id: 'task-2', content: 'Answer B', model: 'mock', inputTokens: 10, outputTokens: 20 },
    ];

    const formatted = formatSubagentResults(results);

    expect(formatted).toContain('task-1');
    expect(formatted).toContain('Answer A');
    expect(formatted).toContain('task-2');
    expect(formatted).toContain('Answer B');
  });

  it('formats error results', () => {
    const results: SubagentResult[] = [
      { id: 'task-1', content: '', model: 'unknown', inputTokens: 0, outputTokens: 0, error: 'Timeout' },
    ];

    const formatted = formatSubagentResults(results);

    expect(formatted).toContain('task-1');
    expect(formatted).toContain('Error: Timeout');
  });

  it('returns placeholder for empty results', () => {
    expect(formatSubagentResults([])).toBe('(no sub-agent results)');
  });
});
