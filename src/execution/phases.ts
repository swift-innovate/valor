import type { ProviderAdapter } from '../providers/types.js';
import type {
  ActResult,
  AgentState,
  ChatMessage,
  EngramAdapter,
  MissionBrief,
  ObserveResult,
  PlanResult,
  PlannedAction,
  ReflectResult,
  ValidateResult,
  EvolveResult,
  OperativeConfig,
} from './types.js';
import { nullEngramAdapter } from './types.js';

export interface PhaseContext {
  config: OperativeConfig;
  provider: ProviderAdapter;
  engram?: EngramAdapter;
  mission: MissionBrief;
  state: AgentState;
  rollingHistory: ChatMessage[];
  systemPrompt: string;
}

const EVOLVE_INTERVAL = 10; // run Evolve every N iterations

// ─── Provider bridge ────────────────────────────────────────────────────────
// ProviderAdapter.complete() uses { role, content } messages and returns
// { content, model, usage: { input_tokens, output_tokens } }.
// Phase functions use the same shape — just map the message format.

function toProviderMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function resolveModel(config: OperativeConfig, taskType: string): string {
  return (
    config.modelAssignment[taskType] ??
    config.modelAssignment['default'] ??
    'ollama/gemma3:12b'
  );
}

function getEngram(ctx: PhaseContext): EngramAdapter {
  return ctx.engram ?? nullEngramAdapter;
}

// ─── Observe ────────────────────────────────────────────────────────────────

export async function runObserve(
  ctx: PhaseContext,
  commanderInput?: string
): Promise<ObserveResult> {
  const engram = getEngram(ctx);
  const engramContext = await engram.recall({
    agentId: ctx.config.id,
    domains: ctx.config.engram.readDomains,
    query: ctx.mission.title,
    budgetTokens: ctx.config.engram.recallBudget,
  });

  const prompt = buildObservePrompt(ctx.mission, engramContext, commanderInput);

  const response = await ctx.provider.complete({
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 500,
  });

  return {
    phase: 'observe',
    summary: response.content,
    ...(commanderInput !== undefined ? { commanderInput } : {}),
    engramContext,
    rawMessages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: response.content },
    ],
  };
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export async function runPlan(
  ctx: PhaseContext,
  observation: ObserveResult
): Promise<PlanResult> {
  const prompt = buildPlanPrompt(ctx.mission, observation.summary);

  const response = await ctx.provider.complete({
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 1500,
  });

  return parsePlanResponse(response.content);
}

// ─── Act ────────────────────────────────────────────────────────────────────

export async function runAct(
  ctx: PhaseContext,
  plan: PlanResult,
  actionIndex: number
): Promise<ActResult> {
  const action = plan.actions[actionIndex];

  if (!action) {
    const prompt = buildActPrompt(ctx.mission, plan.reasoning);
    const response = await ctx.provider.complete({
      model: resolveModel(ctx.config, 'default'),
      messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
      system: ctx.systemPrompt,
      max_tokens: 2000,
    });
    return {
      phase: 'act',
      actionId: 'act-freeform',
      output: response.content,
      success: true,
    };
  }

  return {
    phase: 'act',
    actionId: action.id,
    output: `Executed: ${action.description}`,
    success: true,
  };
}

// ─── Validate ───────────────────────────────────────────────────────────────

export async function runValidate(
  ctx: PhaseContext,
  actResult: ActResult
): Promise<ValidateResult> {
  const prompt = buildValidatePrompt(ctx.mission, actResult);

  const response = await ctx.provider.complete({
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 500,
  });

  const passed = !response.content.toLowerCase().includes('fail');
  return {
    phase: 'validate',
    passed,
    reasoning: response.content,
    retry: !passed,
  };
}

// ─── Reflect ────────────────────────────────────────────────────────────────

export async function runReflect(
  ctx: PhaseContext,
  actResult: ActResult,
  validation: ValidateResult
): Promise<ReflectResult> {
  const prompt = buildReflectPrompt(ctx.mission, actResult, validation);

  const response = await ctx.provider.complete({
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 800,
  });

  const content = response.content.toLowerCase();
  const missionComplete =
    content.includes('mission complete: true') || content.includes('mission complete');
  const missionFailed = content.includes('mission failed');

  const engram = getEngram(ctx);
  const engramEntries: string[] = [];
  if (ctx.config.engram.retainOnPhases.includes('reflect')) {
    const memId = await engram.retain({
      agentId: ctx.config.id,
      domain: ctx.config.engram.writeDomains[0] ?? 'shared',
      type: 'experience',
      content: response.content,
      tags: [ctx.mission.missionId, 'reflect'],
    });
    if (memId) engramEntries.push(memId);
  }

  return {
    phase: 'reflect',
    summary: response.content,
    engramEntries,
    missionComplete,
    missionFailed,
  };
}

// ─── Evolve ─────────────────────────────────────────────────────────────────

export async function runEvolve(ctx: PhaseContext): Promise<EvolveResult> {
  if (ctx.state.iterationCount % EVOLVE_INTERVAL !== 0) {
    return { phase: 'evolve', assessed: false, proposals: [] };
  }

  const prompt = buildEvolvePrompt(ctx.config, ctx.state);

  const response = await ctx.provider.complete({
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 1000,
  });

  return {
    phase: 'evolve',
    assessed: true,
    proposals: extractProposals(response.content),
  };
}

export function shouldRunEvolve(iterationCount: number): boolean {
  return iterationCount > 0 && iterationCount % EVOLVE_INTERVAL === 0;
}

// ─── Prompt builders ────────────────────────────────────────────────────────

function buildObservePrompt(
  mission: MissionBrief,
  engramContext: string,
  commanderInput?: string
): string {
  const parts: string[] = [];
  if (commanderInput) {
    parts.push(`## Commander Input (highest priority)\n${commanderInput}`);
  }
  parts.push(`## Mission\n**${mission.title}**\nObjectives: ${mission.objectives.join('; ')}`);
  if (engramContext && engramContext !== 'No relevant memories.') {
    parts.push(`## Relevant Memory\n${engramContext}`);
  }
  parts.push(
    '## Instructions\nProvide a structured observation summary. What do you know? What is the current situation? What needs to happen next?'
  );
  return parts.join('\n\n');
}

function buildPlanPrompt(mission: MissionBrief, observation: string): string {
  return [
    `## Observation\n${observation}`,
    `## Mission\n${mission.title}\nObjectives: ${mission.objectives.join('; ')}`,
    `## Instructions\nBased on the observation, determine the next action(s) to take. State your reasoning, list concrete actions, and indicate if escalation is needed.\nFormat: include "Needs escalation: true" if you cannot proceed.`,
  ].join('\n\n');
}

function buildActPrompt(mission: MissionBrief, reasoning: string): string {
  return [
    `## Plan\n${reasoning}`,
    `## Mission\n${mission.title}`,
    `## Instructions\nExecute the planned action. Report what you did and the outcome.`,
  ].join('\n\n');
}

function buildValidatePrompt(mission: MissionBrief, actResult: ActResult): string {
  return [
    `## Action Result\n${actResult.output}`,
    `## Mission Success Criteria\n${mission.successCriteria?.join('; ') ?? 'Complete the objectives successfully.'}`,
    `## Instructions\nDid the action succeed? Does it progress the mission? Reply with "passed" or "failed" and your reasoning.`,
  ].join('\n\n');
}

function buildReflectPrompt(
  mission: MissionBrief,
  actResult: ActResult,
  validation: ValidateResult
): string {
  return [
    `## What happened\nAction: ${actResult.output}\nValidation: ${validation.reasoning}`,
    `## Mission\n${mission.title}\nObjectives: ${mission.objectives.join('; ')}`,
    `## Instructions\nSynthesize what was learned. Is the mission complete? Use "Mission complete: true" or "Mission failed" if appropriate. What should be remembered for next time?`,
  ].join('\n\n');
}

function buildEvolvePrompt(config: OperativeConfig, state: AgentState): string {
  return [
    `## Self-Assessment`,
    `Agent: ${config.name} (Tier ${config.tier})`,
    `Iterations: ${state.iterationCount}`,
    `Act cycles used: ${state.actCyclesUsed}`,
    `## Instructions\nAssess your performance. Are there improvements to your approach? Rate any proposals using the VECTOR Method (score 0-10). Only surface proposals scoring >= 6.5.`,
  ].join('\n');
}

// ─── Response parsers ───────────────────────────────────────────────────────

function parsePlanResponse(content: string): PlanResult {
  const needsEscalation =
    content.toLowerCase().includes('needs escalation: true') ||
    content.toLowerCase().includes('escalation required');

  const actions = extractActions(content);

  return {
    phase: 'plan',
    reasoning: content,
    actions,
    needsEscalation,
    ...(needsEscalation ? { escalationReason: extractEscalationReason(content) } : {}),
  };
}

function extractActions(content: string): PlannedAction[] {
  const actionLines = content
    .split('\n')
    .filter((l) => /^\s*[-*\d+\.]\s+Action:/.test(l) || /^\s*[-*]\s+\[action\]/i.test(l));

  return actionLines.map((line, i) => ({
    id: `action-${i + 1}`,
    description: line.replace(/^\s*[-*\d+\.]\s+/, '').trim(),
    requiresCheckpoint: false,
  }));
}

function extractEscalationReason(content: string): string {
  const match = /escalation reason:\s*(.+)/i.exec(content);
  return match?.[1]?.trim() ?? 'Cannot proceed — escalation required';
}

function extractProposals(content: string): string[] {
  return content
    .split('\n')
    .filter((l) => /proposal:|improvement:/i.test(l))
    .map((l) => l.replace(/^.*?(?:proposal|improvement):\s*/i, '').trim());
}
