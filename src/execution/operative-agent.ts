import type { ProviderAdapter } from '../providers/types.js';
import type { EventEnvelope } from '../types/index.js';
import { publish } from '../bus/event-bus.js';
import { logger } from '../utils/logger.js';
import {
  runObserve,
  runPlan,
  runAct,
  runValidate,
  runReflect,
  runEvolve,
  shouldRunEvolve,
} from './phases.js';
import { dispatchSubagents, formatSubagentResults } from './subagent.js';
import type { SubagentTask, SubagentResult } from './subagent.js';
import { readOnlyAdapter } from './engram-bridge.js';
import type {
  AgentState,
  AgentStatus,
  ChatMessage,
  EngramAdapter,
  LoopPhase,
  MissionBrief,
  OperativeConfig,
  PhaseResult,
  ToolAdapter,
} from './types.js';
import { nullEngramAdapter } from './types.js';

export interface OperativeOptions {
  persona?: string;
  systemPromptExtra?: string;
  /** Tool adapter for the Act phase. Absent → Act produces LLM work products only. */
  tools?: ToolAdapter;
  /**
   * Called after each phase completes with its result and the current
   * iteration index. Used by callers to persist per-phase outcomes
   * (e.g., folder memory writes) without coupling the loop to a store.
   * Errors are logged and do not interrupt the loop.
   */
  onPhaseResult?: (result: PhaseResult, iteration: number) => void | Promise<void>;
}

const ROLLING_HISTORY_LIMIT = 8;

/**
 * OperativeAgent — runs a multi-phase mission loop inside valor-engine.
 * Each iteration: Observe→Plan→Act→Validate→Reflect (Evolve periodic).
 * Publishes sitreps through the event bus after each phase.
 */
export class OperativeAgent {
  private readonly config: OperativeConfig;
  private readonly provider: ProviderAdapter;
  private readonly engram: EngramAdapter;
  private readonly options: OperativeOptions;

  private state: AgentState;
  private mission: MissionBrief | null = null;
  private rollingHistory: ChatMessage[] = [];
  private tokensIn = 0;
  private tokensOut = 0;

  constructor(
    config: OperativeConfig,
    provider: ProviderAdapter,
    engram?: EngramAdapter,
    options: OperativeOptions = {}
  ) {
    this.config = config;
    this.provider = provider;
    this.engram = engram ?? nullEngramAdapter;
    this.options = options;

    this.state = {
      agentId: config.id,
      status: 'idle',
      iterationCount: 0,
      actCyclesUsed: 0,
      tokensBudgetUsed: 0,
      lastActivity: new Date(),
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  getState(): Readonly<AgentState> {
    return { ...this.state };
  }

  getTier(): 0 | 1 | 2 | 3 {
    return this.config.tier;
  }

  assignMission(mission: MissionBrief): void {
    if (this.state.status === 'terminated') {
      throw new Error(`Agent "${this.config.id}" is terminated and cannot accept new missions.`);
    }
    if (mission.assignedTo !== this.config.id) {
      throw new Error(
        `Mission "${mission.missionId}" is assigned to "${mission.assignedTo}", not "${this.config.id}".`
      );
    }

    this.mission = { ...mission, state: 'IN_PROGRESS' };
    this.setStatus('active');
    this.state = { ...this.state, missionId: mission.missionId };
  }

  terminate(): void {
    this.setStatus('terminated');
  }

  /**
   * Delegate tasks to lightweight sub-agents for parallel execution.
   * Sub-agents get read-only Engram access and cannot spawn further sub-agents.
   * Results are returned to the parent for incorporation into its context.
   */
  async delegateToSubagents(tasks: SubagentTask[]): Promise<SubagentResult[]> {
    const roEngram = readOnlyAdapter(this.engram);
    const parentContext = this.mission
      ? { agentId: this.config.id, missionId: this.mission.missionId }
      : undefined;
    return dispatchSubagents(tasks, this.provider, roEngram, parentContext);
  }

  /**
   * Delegate tasks and return formatted results as a string for context injection.
   */
  async delegateAndFormat(tasks: SubagentTask[]): Promise<string> {
    const results = await this.delegateToSubagents(tasks);
    return formatSubagentResults(results);
  }

  /**
   * Run a single iteration of the Observe→Plan→Act→Validate→Reflect loop.
   * Evolve runs periodically based on iteration count.
   * Publishes sitrep events after each phase.
   */
  async runIteration(commanderInput?: string): Promise<PhaseResult[]> {
    if (!this.mission) {
      throw new Error(`Agent "${this.config.id}" has no active mission. Call assignMission() first.`);
    }
    if (this.state.status === 'terminated') {
      throw new Error(`Agent "${this.config.id}" is terminated.`);
    }

    const budgetExhausted = this.state.actCyclesUsed >= this.config.autonomy.budget;

    const ctx = {
      config: this.config,
      provider: this.provider,
      engram: this.engram,
      mission: this.mission,
      state: this.state,
      rollingHistory: this.rollingHistory,
      systemPrompt: this.buildSystemPrompt(),
      tools: this.options.tools,
      onUsage: (usage: { input_tokens: number; output_tokens: number }) => {
        this.tokensIn += usage.input_tokens;
        this.tokensOut += usage.output_tokens;
        this.state = {
          ...this.state,
          tokensBudgetUsed: this.tokensIn + this.tokensOut,
        };
      },
    };

    const results: PhaseResult[] = [];

    // ── Observe ─────────────────────────────────────────────────────────────
    const observation = await runObserve(ctx, commanderInput);
    results.push(observation);
    this.appendHistory(observation.rawMessages);
    this.publishSitrep('observe', observation.summary, 'IN_PROGRESS');
    await this.emitPhaseResult(observation);

    // ── Plan ────────────────────────────────────────────────────────────────
    const plan = await runPlan(ctx, observation);
    results.push(plan);
    this.publishSitrep('plan', plan.reasoning, 'IN_PROGRESS');

    if (plan.needsEscalation) {
      this.publishSitrep('plan', plan.escalationReason ?? 'Escalation required', 'ESCALATED');
    }
    await this.emitPhaseResult(plan);

    // ── Act ─────────────────────────────────────────────────────────────────
    let actResult;
    if (budgetExhausted) {
      actResult = {
        phase: 'act' as const,
        actionId: 'budget-exhausted',
        output: 'Autonomy budget exhausted — escalated to ' + this.config.autonomy.escalationTarget,
        success: false,
      };
      this.publishSitrep('act', actResult.output, 'ESCALATED');
    } else {
      actResult = await runAct(ctx, plan, 0);
      this.state = {
        ...this.state,
        actCyclesUsed: this.state.actCyclesUsed + 1,
      };
      this.publishSitrep('act', actResult.output, 'IN_PROGRESS');
    }
    results.push(actResult);
    await this.emitPhaseResult(actResult);

    // ── Validate ────────────────────────────────────────────────────────────
    const validation = await runValidate(ctx, actResult);
    results.push(validation);
    this.publishSitrep('validate', validation.reasoning, 'IN_PROGRESS');
    await this.emitPhaseResult(validation);

    // ── Reflect ─────────────────────────────────────────────────────────────
    const reflection = await runReflect(ctx, actResult, validation);
    results.push(reflection);

    if (reflection.missionComplete) {
      this.publishSitrep('reflect', reflection.summary, 'COMPLETED');
    } else if (reflection.missionFailed) {
      this.publishSitrep('reflect', reflection.summary, 'FAILED');
    } else {
      this.publishSitrep('reflect', reflection.summary, 'IN_PROGRESS');
    }
    await this.emitPhaseResult(reflection);

    // ── Evolve (periodic) ───────────────────────────────────────────────────
    if (shouldRunEvolve(this.state.iterationCount + 1)) {
      const evolveResult = await runEvolve(ctx);
      results.push(evolveResult);
      if (evolveResult.assessed) {
        this.publishSitrep('evolve', evolveResult.proposals.join('; ') || 'No proposals', 'IN_PROGRESS');
      }
      await this.emitPhaseResult(evolveResult);
    }

    // ── Update state ────────────────────────────────────────────────────────
    this.state = {
      ...this.state,
      iterationCount: this.state.iterationCount + 1,
      lastPhase: 'reflect',
      lastActivity: new Date(),
    };

    this.trimRollingHistory();

    return results;
  }

  /**
   * Run the full mission loop: iterate until completion, failure, escalation, or limit.
   * Returns the terminal status.
   */
  async runMission(): Promise<'completed' | 'failed' | 'escalated' | 'iteration_limit'> {
    if (!this.mission) {
      throw new Error(`Agent "${this.config.id}" has no active mission.`);
    }

    const maxIterations = this.config.loop.maxIterationsPerMission;

    for (let i = 0; i < maxIterations; i++) {
      const results = await this.runIteration();

      // Check for terminal conditions
      const reflect = results.find((r) => r.phase === 'reflect');
      if (reflect && 'missionComplete' in reflect && reflect.missionComplete) {
        return 'completed';
      }
      if (reflect && 'missionFailed' in reflect && reflect.missionFailed) {
        return 'failed';
      }

      // Check if budget exhausted (escalation)
      if (this.state.actCyclesUsed >= this.config.autonomy.budget) {
        return 'escalated';
      }
    }

    // Iteration limit reached
    this.publishSitrep('reflect', `Iteration limit (${maxIterations}) reached`, 'FAILED');
    return 'iteration_limit';
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    if (this.options.persona) {
      parts.push(this.options.persona);
    } else {
      parts.push(
        `You are ${this.config.name}, a Tier ${this.config.tier} VALOR operative.`
      );
    }

    parts.push(
      `Your operative ID is "${this.config.id}".`,
      `You operate within the Observe→Plan→Act→Validate→Reflect→Evolve loop.`,
      `Be precise, focused, and efficient. Escalate when in doubt rather than taking risky actions.`
    );

    if (this.options.systemPromptExtra) {
      parts.push(this.options.systemPromptExtra);
    }

    return parts.join('\n');
  }

  private async emitPhaseResult(result: PhaseResult): Promise<void> {
    if (!this.options.onPhaseResult) return;
    try {
      await this.options.onPhaseResult(result, this.state.iterationCount);
    } catch (err) {
      logger.error('onPhaseResult hook failed', {
        agent_id: this.config.id,
        phase: result.phase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private setStatus(status: AgentStatus): void {
    const prev = this.state.status;
    this.state = { ...this.state, status, lastActivity: new Date() };
    if (prev !== status) {
      logger.info('Agent status change', {
        agent_id: this.config.id,
        from: prev,
        to: status,
      });
    }
  }

  private appendHistory(messages: ChatMessage[]): void {
    this.rollingHistory.push(...messages);
  }

  private trimRollingHistory(): void {
    const maxMessages = ROLLING_HISTORY_LIMIT * 2;
    if (this.rollingHistory.length > maxMessages) {
      this.rollingHistory = this.rollingHistory.slice(-maxMessages);
    }
  }

  private calculateProgress(phase: LoopPhase): number {
    const phaseWeights: Record<LoopPhase, number> = {
      observe: 10,
      plan: 25,
      act: 50,
      validate: 70,
      reflect: 85,
      evolve: 90,
    };
    const iterationProgress = phaseWeights[phase] ?? 0;
    const maxIter = this.config.loop.maxIterationsPerMission;
    const iterFraction = maxIter > 0 ? this.state.iterationCount / maxIter : 0;
    return Math.min(Math.round(iterFraction * 100 * 0.5 + iterationProgress * 0.5), 99);
  }

  private publishSitrep(
    phase: LoopPhase,
    summary: string,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ESCALATED'
  ): void {
    if (!this.mission) return;

    try {
      publish({
        type: 'sitrep.published',
        source: { id: this.config.id, type: 'agent' },
        target: null,
        conversation_id: null,
        in_reply_to: null,
        payload: {
          mission_id: this.mission.missionId,
          operative: this.config.name,
          status,
          progress_pct: this.calculateProgress(phase),
          summary,
          phase,
          iteration: this.state.iterationCount,
          tokens_used: { input: this.tokensIn, output: this.tokensOut },
          timestamp: new Date().toISOString(),
        },
        metadata: null,
      });
    } catch (err) {
      logger.error('Failed to publish sitrep', {
        agent_id: this.config.id,
        phase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
