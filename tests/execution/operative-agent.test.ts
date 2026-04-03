import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, cleanupDb } from '../helpers/test-db.js';
import { clearSubscriptions, subscribe } from '../../src/bus/event-bus.js';
import { OperativeAgent } from '../../src/execution/operative-agent.js';
import type { OperativeConfig, MissionBrief } from '../../src/execution/types.js';
import type { ProviderAdapter, ProviderHealth } from '../../src/providers/types.js';
import type { StreamEvent, EventEnvelope } from '../../src/types/index.js';

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

function mockProvider(responseContent = 'test response'): ProviderAdapter {
  return {
    id: 'mock_provider',
    name: 'Mock',
    type: 'claude_api',
    capabilities: {
      streaming: true,
      toolUse: false,
      vision: false,
      maxContextTokens: 200000,
      models: ['mock-model'],
    },
    async healthCheck(): Promise<ProviderHealth> {
      return { status: 'healthy', latency_ms: 1, last_check: new Date().toISOString() };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { session_id: 's1', sequence: 0, event_type: 'completion', data: {}, timestamp: new Date().toISOString() };
    },
    async complete() {
      return {
        content: responseContent,
        model: 'mock-model',
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn' as const,
      };
    },
  };
}

function testConfig(overrides: Partial<OperativeConfig> = {}): OperativeConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    tier: 2,
    loop: {
      persistence: 'mission-scoped',
      tickInterval: 1000,
      maxIterationsPerMission: 10,
      idleTimeout: 300_000,
    },
    autonomy: {
      budget: 5,
      escalationTarget: 'director',
      autoApprovePhases: ['observe', 'plan', 'reflect'],
      requiresCheckpoint: ['act'],
    },
    engram: {
      readDomains: ['shared'],
      writeDomains: ['shared'],
      recallBudget: 2000,
      retainOnPhases: ['reflect'],
    },
    modelAssignment: { default: 'mock-model' },
    tools: { enabled: [], disabled: [] },
    ...overrides,
  };
}

function testMission(agentId = 'test-agent'): MissionBrief {
  return {
    missionId: 'mission-1',
    title: 'Test Mission',
    assignedTo: agentId,
    assignedBy: 'director',
    priority: 'normal',
    objectives: ['Complete the test'],
    successCriteria: ['All tests pass'],
    state: 'ASSIGNED',
  };
}

describe('OperativeAgent', () => {
  it('starts in idle state', () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    expect(agent.getState().status).toBe('idle');
    expect(agent.getState().iterationCount).toBe(0);
  });

  it('transitions to active on mission assignment', () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());
    expect(agent.getState().status).toBe('active');
    expect(agent.getState().missionId).toBe('mission-1');
  });

  it('rejects mission assigned to a different agent', () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    expect(() => agent.assignMission(testMission('other-agent'))).toThrow(
      'assigned to "other-agent"'
    );
  });

  it('rejects mission when terminated', () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.terminate();
    expect(() => agent.assignMission(testMission())).toThrow('terminated');
  });

  it('runs a full iteration in correct phase order', async () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());

    const results = await agent.runIteration();
    const phases = results.map((r) => r.phase);

    expect(phases).toEqual(['observe', 'plan', 'act', 'validate', 'reflect']);
  });

  it('increments iteration count after each run', async () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());

    await agent.runIteration();
    expect(agent.getState().iterationCount).toBe(1);

    await agent.runIteration();
    expect(agent.getState().iterationCount).toBe(2);
  });

  it('increments actCyclesUsed per iteration', async () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());

    await agent.runIteration();
    expect(agent.getState().actCyclesUsed).toBe(1);
  });

  it('throws when running iteration without mission', async () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    await expect(agent.runIteration()).rejects.toThrow('no active mission');
  });

  it('throws when running iteration after termination', async () => {
    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());
    agent.terminate();
    await expect(agent.runIteration()).rejects.toThrow('terminated');
  });

  it('publishes sitrep events through event bus', async () => {
    const events: EventEnvelope[] = [];
    subscribe('sitrep.*', (e) => events.push(e));

    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());
    await agent.runIteration();

    expect(events.length).toBeGreaterThanOrEqual(5); // observe, plan, act, validate, reflect
    expect(events.every((e) => e.type === 'sitrep.published')).toBe(true);

    const phases = events.map((e) => (e.payload as Record<string, unknown>).phase);
    expect(phases).toContain('observe');
    expect(phases).toContain('plan');
    expect(phases).toContain('act');
    expect(phases).toContain('validate');
    expect(phases).toContain('reflect');
  });

  it('sitrep includes mission_id, operative, and iteration', async () => {
    const events: EventEnvelope[] = [];
    subscribe('sitrep.*', (e) => events.push(e));

    const agent = new OperativeAgent(testConfig(), mockProvider());
    agent.assignMission(testMission());
    await agent.runIteration();

    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload.mission_id).toBe('mission-1');
    expect(payload.operative).toBe('Test Agent');
    expect(payload.iteration).toBe(0);
  });
});

describe('Budget Enforcement', () => {
  it('stops acting when budget exhausted', async () => {
    const config = testConfig({ autonomy: { ...testConfig().autonomy, budget: 1 } });
    const agent = new OperativeAgent(config, mockProvider());
    agent.assignMission(testMission());

    // First iteration uses the budget
    await agent.runIteration();
    expect(agent.getState().actCyclesUsed).toBe(1);

    // Second iteration — budget exhausted, act should be skipped
    const results = await agent.runIteration();
    const actResult = results.find((r) => r.phase === 'act');
    expect(actResult).toBeDefined();
    expect((actResult as { actionId: string }).actionId).toBe('budget-exhausted');
    expect((actResult as { success: boolean }).success).toBe(false);

    // actCyclesUsed should NOT have incremented
    expect(agent.getState().actCyclesUsed).toBe(1);
  });

  it('publishes escalation sitrep when budget exhausted', async () => {
    const events: EventEnvelope[] = [];
    subscribe('sitrep.*', (e) => events.push(e));

    const config = testConfig({ autonomy: { ...testConfig().autonomy, budget: 1 } });
    const agent = new OperativeAgent(config, mockProvider());
    agent.assignMission(testMission());

    await agent.runIteration(); // uses budget
    await agent.runIteration(); // budget exhausted

    const escalationEvents = events.filter(
      (e) => (e.payload as Record<string, unknown>).status === 'ESCALATED'
    );
    expect(escalationEvents.length).toBeGreaterThan(0);
  });
});

describe('Mission Loop (runMission)', () => {
  it('completes when reflect says mission complete', async () => {
    const provider = mockProvider('Mission complete: true');
    const agent = new OperativeAgent(testConfig(), provider);
    agent.assignMission(testMission());

    const outcome = await agent.runMission();
    expect(outcome).toBe('completed');
  });

  it('fails when reflect says mission failed', async () => {
    const provider = mockProvider('Mission failed');
    const agent = new OperativeAgent(testConfig(), provider);
    agent.assignMission(testMission());

    const outcome = await agent.runMission();
    expect(outcome).toBe('failed');
  });

  it('returns iteration_limit when max iterations reached', async () => {
    const config = testConfig({
      loop: { ...testConfig().loop, maxIterationsPerMission: 2 },
    });
    // Response that never triggers completion or failure
    const provider = mockProvider('Continuing work...');
    const agent = new OperativeAgent(config, provider);
    agent.assignMission(testMission());

    const outcome = await agent.runMission();
    expect(outcome).toBe('iteration_limit');
    expect(agent.getState().iterationCount).toBe(2);
  });

  it('returns escalated when budget exhausted during loop', async () => {
    const config = testConfig({
      autonomy: { ...testConfig().autonomy, budget: 1 },
      loop: { ...testConfig().loop, maxIterationsPerMission: 5 },
    });
    const provider = mockProvider('Continuing work...');
    const agent = new OperativeAgent(config, provider);
    agent.assignMission(testMission());

    const outcome = await agent.runMission();
    expect(outcome).toBe('escalated');
  });
});
