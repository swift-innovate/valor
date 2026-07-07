import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, cleanupDb } from '../helpers/test-db.js';
import { clearSubscriptions } from '../../src/bus/event-bus.js';
import {
  runObserve,
  runPlan,
  runAct,
  runValidate,
  runReflect,
  runEvolve,
  shouldRunEvolve,
} from '../../src/execution/phases.js';
import type { PhaseContext } from '../../src/execution/phases.js';
import type { OperativeConfig, MissionBrief, AgentState, ToolAdapter } from '../../src/execution/types.js';
import type { ProviderAdapter, ProviderHealth } from '../../src/providers/types.js';
import type { StreamEvent } from '../../src/types/index.js';

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
    id: 'mock',
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

function baseConfig(): OperativeConfig {
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
  };
}

function baseMission(): MissionBrief {
  return {
    missionId: 'mission-1',
    title: 'Test Mission',
    assignedTo: 'test-agent',
    assignedBy: 'director',
    priority: 'normal',
    objectives: ['Objective A', 'Objective B'],
    successCriteria: ['Criterion 1'],
    state: 'IN_PROGRESS',
  };
}

function baseState(): AgentState {
  return {
    agentId: 'test-agent',
    status: 'active',
    missionId: 'mission-1',
    iterationCount: 0,
    actCyclesUsed: 0,
    tokensBudgetUsed: 0,
    lastActivity: new Date(),
  };
}

function makeCtx(providerContent = 'test response', stateOverrides: Partial<AgentState> = {}): PhaseContext {
  return {
    config: baseConfig(),
    provider: mockProvider(providerContent),
    mission: baseMission(),
    state: { ...baseState(), ...stateOverrides },
    rollingHistory: [],
    systemPrompt: 'You are a test agent.',
  };
}

describe('runObserve', () => {
  it('returns an ObserveResult with summary', async () => {
    const result = await runObserve(makeCtx('Observation summary'));
    expect(result.phase).toBe('observe');
    expect(result.summary).toBe('Observation summary');
    expect(result.rawMessages).toHaveLength(2);
    expect(result.rawMessages[0]!.role).toBe('user');
    expect(result.rawMessages[1]!.role).toBe('assistant');
  });

  it('includes commander input when provided', async () => {
    const result = await runObserve(makeCtx(), 'Priority directive');
    expect(result.commanderInput).toBe('Priority directive');
  });

  it('works without engram adapter', async () => {
    const result = await runObserve(makeCtx());
    expect(result.engramContext).toBe('');
  });
});

describe('runPlan', () => {
  it('returns a PlanResult with reasoning', async () => {
    const ctx = makeCtx('Here is the plan. No escalation needed.');
    const observation = await runObserve(ctx);
    const result = await runPlan(ctx, observation);

    expect(result.phase).toBe('plan');
    expect(result.reasoning).toBeTruthy();
    expect(result.needsEscalation).toBe(false);
  });

  it('detects escalation in response', async () => {
    const ctx = makeCtx('Needs escalation: true. Escalation reason: blocked on API access');
    const observation = await runObserve(ctx);
    const result = await runPlan(ctx, observation);

    expect(result.needsEscalation).toBe(true);
    expect(result.escalationReason).toContain('blocked on API access');
  });

  it('extracts actions from response', async () => {
    const ctx = makeCtx('- Action: Do the first thing\n- Action: Do the second thing');
    const observation = await runObserve(ctx);
    const result = await runPlan(ctx, observation);

    expect(result.actions.length).toBe(2);
    expect(result.actions[0]!.id).toBe('action-1');
  });
});

describe('runAct', () => {
  it('executes freeform when no action at index', async () => {
    const ctx = makeCtx('Action executed successfully');
    const plan = { phase: 'plan' as const, reasoning: 'Do the thing', actions: [], needsEscalation: false };

    const result = await runAct(ctx, plan, 0);
    expect(result.phase).toBe('act');
    expect(result.actionId).toBe('act-freeform');
    expect(result.output).toBe('Action executed successfully');
    expect(result.success).toBe(true);
  });

  it('produces an LLM work product for a planned action when no tools are granted', async () => {
    const ctx = makeCtx('Report drafted: quarterly summary.');
    const plan = {
      phase: 'plan' as const,
      reasoning: 'Do the thing',
      actions: [{ id: 'action-1', description: 'Write the report', requiresCheckpoint: false }],
      needsEscalation: false,
    };

    const result = await runAct(ctx, plan, 0);
    expect(result.actionId).toBe('action-1');
    expect(result.output).toBe('Report drafted: quarterly summary.');
    expect(result.success).toBe(true);
    expect(result.toolCalls).toBeUndefined();
  });
});

describe('runAct — tool loop (text protocol)', () => {
  function mockToolAdapter(executed: Array<{ tool: string; params: Record<string, unknown> }>): ToolAdapter {
    return {
      isEnabled: (tool) => tool === 'write_file',
      definitions: () => [
        {
          name: 'write_file',
          description: 'Write a file',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ],
      async execute(tool, params) {
        executed.push({ tool, params });
        return { success: true, output: `wrote ${String(params['path'])}` };
      },
    };
  }

  function sequenceProvider(responses: string[]): ProviderAdapter {
    let call = 0;
    const base = mockProvider();
    return {
      ...base,
      async complete() {
        const content = responses[Math.min(call, responses.length - 1)]!;
        call++;
        return {
          content,
          model: 'mock-model',
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn' as const,
        };
      },
    };
  }

  const plan = {
    phase: 'plan' as const,
    reasoning: 'Write the file',
    actions: [{ id: 'action-1', description: 'Write hello.txt', requiresCheckpoint: false }],
    needsEscalation: false,
  };

  it('executes a JSON tool call then finishes with a done report', async () => {
    const executed: Array<{ tool: string; params: Record<string, unknown> }> = [];
    const ctx = makeCtx();
    ctx.tools = mockToolAdapter(executed);
    ctx.provider = sequenceProvider([
      '```json\n{"tool": "write_file", "params": {"path": "hello.txt", "content": "hi"}}\n```',
      '```json\n{"done": true, "success": true, "report": "File written."}\n```',
    ]);

    const result = await runAct(ctx, plan, 0);
    expect(executed).toEqual([{ tool: 'write_file', params: { path: 'hello.txt', content: 'hi' } }]);
    expect(result.output).toBe('File written.');
    expect(result.success).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]!.tool).toBe('write_file');
    expect(result.toolCalls![0]!.success).toBe(true);
  });

  it('treats an unparseable response as a freeform report', async () => {
    const executed: Array<{ tool: string; params: Record<string, unknown> }> = [];
    const ctx = makeCtx();
    ctx.tools = mockToolAdapter(executed);
    ctx.provider = sequenceProvider(['I did the thing without needing tools.']);

    const result = await runAct(ctx, plan, 0);
    expect(executed).toHaveLength(0);
    expect(result.output).toBe('I did the thing without needing tools.');
    expect(result.success).toBe(true);
  });

  it('reports failure when the done report says success false', async () => {
    const ctx = makeCtx();
    ctx.tools = mockToolAdapter([]);
    ctx.provider = sequenceProvider([
      '```json\n{"done": true, "success": false, "report": "Could not write the file."}\n```',
    ]);

    const result = await runAct(ctx, plan, 0);
    expect(result.success).toBe(false);
    expect(result.output).toBe('Could not write the file.');
  });

  it('stops with tool_budget_exhausted when the model never finishes', async () => {
    const executed: Array<{ tool: string; params: Record<string, unknown> }> = [];
    const ctx = makeCtx();
    ctx.tools = mockToolAdapter(executed);
    ctx.provider = sequenceProvider([
      '```json\n{"tool": "write_file", "params": {"path": "a.txt", "content": "x"}}\n```',
    ]);

    const result = await runAct(ctx, plan, 0);
    expect(result.success).toBe(false);
    expect(result.error).toBe('tool_budget_exhausted');
    expect(executed.length).toBe(5);
  });

  it('uses native tool_calls when the provider supports tool use', async () => {
    const executed: Array<{ tool: string; params: Record<string, unknown> }> = [];
    const ctx = makeCtx();
    ctx.tools = mockToolAdapter(executed);

    let call = 0;
    const base = mockProvider();
    ctx.provider = {
      ...base,
      capabilities: { ...base.capabilities, toolUse: true },
      async complete(req) {
        call++;
        if (call === 1) {
          expect(req.tools).toHaveLength(1);
          return {
            content: '',
            model: 'mock-model',
            usage: { input_tokens: 10, output_tokens: 5 },
            tool_calls: [{ id: 't1', name: 'write_file', input: { path: 'n.txt', content: 'y' } }],
            stop_reason: 'tool_use' as const,
          };
        }
        return {
          content: 'Wrote the file natively.',
          model: 'mock-model',
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn' as const,
        };
      },
    };

    const result = await runAct(ctx, plan, 0);
    expect(executed).toEqual([{ tool: 'write_file', params: { path: 'n.txt', content: 'y' } }]);
    expect(result.output).toBe('Wrote the file natively.');
    expect(result.success).toBe(true);
  });
});

describe('runValidate', () => {
  it('parses a JSON verdict', async () => {
    const ctx = makeCtx('```json\n{"passed": true, "reasoning": "Criteria met."}\n```');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };

    const result = await runValidate(ctx, actResult);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe('Criteria met.');
    expect(result.retry).toBe(false);
  });

  it('parses a JSON failure verdict even when prose sounds positive', async () => {
    const ctx = makeCtx('```json\n{"passed": false, "reasoning": "Output looks great but does not satisfy criterion 1."}\n```');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };

    const result = await runValidate(ctx, actResult);
    expect(result.passed).toBe(false);
    expect(result.retry).toBe(true);
  });

  it('falls back to heuristic: passes when prose does not contain fail', async () => {
    const ctx = makeCtx('The action passed validation successfully.');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };

    const result = await runValidate(ctx, actResult);
    expect(result.phase).toBe('validate');
    expect(result.passed).toBe(true);
    expect(result.retry).toBe(false);
  });

  it('falls back to heuristic: fails when prose contains fail', async () => {
    const ctx = makeCtx('The action failed validation.');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };

    const result = await runValidate(ctx, actResult);
    expect(result.passed).toBe(false);
    expect(result.retry).toBe(true);
  });
});

describe('runReflect', () => {
  it('parses a JSON verdict for mission complete', async () => {
    const ctx = makeCtx('```json\n{"mission_complete": true, "mission_failed": false, "summary": "All objectives met."}\n```');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };
    const validation = { phase: 'validate' as const, passed: true, reasoning: 'Good' };

    const result = await runReflect(ctx, actResult, validation);
    expect(result.missionComplete).toBe(true);
    expect(result.missionFailed).toBe(false);
    expect(result.summary).toBe('All objectives met.');
  });

  it('does not flag completion when JSON verdict says in progress despite the phrase appearing', async () => {
    const ctx = makeCtx('```json\n{"mission_complete": false, "mission_failed": false, "summary": "Mission complete criteria not yet met — one objective remains."}\n```');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };
    const validation = { phase: 'validate' as const, passed: true, reasoning: 'Good' };

    const result = await runReflect(ctx, actResult, validation);
    expect(result.missionComplete).toBe(false);
    expect(result.missionFailed).toBe(false);
  });

  it('detects mission complete', async () => {
    const ctx = makeCtx('All objectives met. Mission complete: true');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Done', success: true };
    const validation = { phase: 'validate' as const, passed: true, reasoning: 'Good' };

    const result = await runReflect(ctx, actResult, validation);
    expect(result.phase).toBe('reflect');
    expect(result.missionComplete).toBe(true);
    expect(result.missionFailed).toBe(false);
  });

  it('detects mission failed', async () => {
    const ctx = makeCtx('Unable to proceed. Mission failed.');
    const actResult = { phase: 'act' as const, actionId: 'a1', output: 'Error', success: false };
    const validation = { phase: 'validate' as const, passed: false, reasoning: 'Bad' };

    const result = await runReflect(ctx, actResult, validation);
    expect(result.missionComplete).toBe(false);
    expect(result.missionFailed).toBe(true);
  });
});

describe('runEvolve', () => {
  it('skips when not at interval', async () => {
    const ctx = makeCtx('', { iterationCount: 3 });
    const result = await runEvolve(ctx);
    expect(result.phase).toBe('evolve');
    expect(result.assessed).toBe(false);
    expect(result.proposals).toEqual([]);
  });

  it('runs at EVOLVE_INTERVAL', async () => {
    const ctx = makeCtx('Proposal: improve caching', { iterationCount: 10 });
    const result = await runEvolve(ctx);
    expect(result.assessed).toBe(true);
    expect(result.proposals).toContain('improve caching');
  });
});

describe('shouldRunEvolve', () => {
  it('returns false for iteration 0', () => {
    expect(shouldRunEvolve(0)).toBe(false);
  });

  it('returns true for iteration 10', () => {
    expect(shouldRunEvolve(10)).toBe(true);
  });

  it('returns true for iteration 20', () => {
    expect(shouldRunEvolve(20)).toBe(true);
  });

  it('returns false for iteration 5', () => {
    expect(shouldRunEvolve(5)).toBe(false);
  });
});
