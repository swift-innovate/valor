import { z } from 'zod';
import { config as engineConfig } from '../config.js';
import { stripProviderPrefix } from '../utils/model.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ToolDefinition } from '../providers/types.js';
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
  ToolAdapter,
  ToolCallRecord,
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
  /** Tool adapter for the Act phase. Absent → Act produces LLM work products only. */
  tools?: ToolAdapter;
  /** Called with token usage after every provider call, for budget accounting. */
  onUsage?: (usage: { input_tokens: number; output_tokens: number }) => void;
}

const EVOLVE_INTERVAL = 10; // run Evolve every N iterations
const MAX_TOOL_CALLS_PER_ACT = 5;
const TOOL_RESULT_PROMPT_CAP = 4000;

// ─── Provider bridge ────────────────────────────────────────────────────────
// ProviderAdapter.complete() uses { role, content } messages and returns
// { content, model, usage: { input_tokens, output_tokens } }.
// Phase functions use the same shape — just map the message format.

function toProviderMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function resolveModel(config: OperativeConfig, taskType: string): string {
  const raw =
    config.modelAssignment[taskType] ??
    config.modelAssignment['default'] ??
    engineConfig.defaultModel;
  return stripProviderPrefix(raw);
}

function getEngram(ctx: PhaseContext): EngramAdapter {
  return ctx.engram ?? nullEngramAdapter;
}

async function completeTracked(ctx: PhaseContext, request: ProviderRequest): Promise<ProviderResponse> {
  const response = await ctx.provider.complete(request);
  ctx.onUsage?.(response.usage);
  return response;
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

  const response = await completeTracked(ctx, {
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

  const response = await completeTracked(ctx, {
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
  const actionId = action ? action.id : 'act-freeform';
  const objective = action ? action.description : plan.reasoning;

  const availableTools = ctx.tools?.definitions?.() ?? [];

  if (availableTools.length === 0) {
    // No tools granted — the act output is an LLM work product (analysis,
    // drafting, decision content), not an execution in the world.
    const prompt = buildActPrompt(ctx.mission, objective);
    const response = await completeTracked(ctx, {
      model: resolveModel(ctx.config, 'default'),
      messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
      system: ctx.systemPrompt,
      max_tokens: 2000,
    });
    return {
      phase: 'act',
      actionId,
      output: response.content,
      success: true,
    };
  }

  return runToolLoop(ctx, actionId, objective, availableTools);
}

interface ToolInvocation {
  tool: string;
  params: Record<string, unknown>;
}

/**
 * ReAct-style act loop: the model calls tools (natively when the provider
 * supports tool use, otherwise via a JSON text protocol) until it reports
 * completion or the per-act tool budget is exhausted.
 */
async function runToolLoop(
  ctx: PhaseContext,
  actionId: string,
  objective: string,
  toolDefs: ToolDefinition[]
): Promise<ActResult> {
  const native = ctx.provider.capabilities.toolUse;
  const transcript: ChatMessage[] = [
    { role: 'user', content: buildToolActPrompt(ctx.mission, objective, toolDefs, native) },
  ];
  const toolCalls: ToolCallRecord[] = [];

  for (let turn = 0; turn < MAX_TOOL_CALLS_PER_ACT; turn++) {
    const response = await completeTracked(ctx, {
      model: resolveModel(ctx.config, 'default'),
      messages: [...toProviderMessages(ctx.rollingHistory), ...transcript],
      system: ctx.systemPrompt,
      max_tokens: 2000,
      ...(native ? { tools: toolDefs } : {}),
    });

    const invocation = extractInvocation(response, native);

    if (!invocation) {
      const done = native ? undefined : parseTextDone(response.content);
      return {
        phase: 'act',
        actionId,
        output: done?.report || response.content,
        success: done?.success ?? true,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }

    const result = await ctx.tools!.execute(invocation.tool, invocation.params);
    toolCalls.push({
      tool: invocation.tool,
      params: invocation.params,
      success: result.success,
      output: result.success ? result.output : (result.error ?? 'unknown error'),
    });

    transcript.push({
      role: 'assistant',
      content: response.content || `[tool call] ${invocation.tool}(${JSON.stringify(invocation.params)})`,
    });
    transcript.push({
      role: 'user',
      content:
        `Tool "${invocation.tool}" ${result.success ? 'succeeded' : 'FAILED'}:\n` +
        truncateText(result.success ? result.output : (result.error ?? 'unknown error'), TOOL_RESULT_PROMPT_CAP) +
        `\n\nContinue: call another tool if needed, or finish with your report.`,
    });
  }

  return {
    phase: 'act',
    actionId,
    output:
      `Tool budget (${MAX_TOOL_CALLS_PER_ACT}) exhausted without a final report. ` +
      `Calls made: ${toolCalls.map((c) => `${c.tool}(${c.success ? 'ok' : 'failed'})`).join(', ')}`,
    success: false,
    error: 'tool_budget_exhausted',
    toolCalls,
  };
}

function extractInvocation(response: ProviderResponse, native: boolean): ToolInvocation | undefined {
  if (native) {
    const call = response.tool_calls?.[0];
    return call ? { tool: call.name, params: call.input } : undefined;
  }
  return parseTextToolCall(response.content);
}

// ─── Validate ───────────────────────────────────────────────────────────────

const ValidateVerdict = z.object({
  passed: z.boolean(),
  reasoning: z.string().default(''),
});

export async function runValidate(
  ctx: PhaseContext,
  actResult: ActResult
): Promise<ValidateResult> {
  const prompt = buildValidatePrompt(ctx.mission, actResult);

  const response = await completeTracked(ctx, {
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 500,
  });

  const verdict = ValidateVerdict.safeParse(extractJson(response.content));
  // Fallback heuristic for models that ignore the JSON instruction.
  const passed = verdict.success ? verdict.data.passed : !response.content.toLowerCase().includes('fail');
  const reasoning = verdict.success && verdict.data.reasoning ? verdict.data.reasoning : response.content;

  return {
    phase: 'validate',
    passed,
    reasoning,
    retry: !passed,
  };
}

// ─── Reflect ────────────────────────────────────────────────────────────────

const ReflectVerdict = z.object({
  mission_complete: z.boolean().default(false),
  mission_failed: z.boolean().default(false),
  summary: z.string().default(''),
});

export async function runReflect(
  ctx: PhaseContext,
  actResult: ActResult,
  validation: ValidateResult
): Promise<ReflectResult> {
  const prompt = buildReflectPrompt(ctx.mission, actResult, validation);

  const response = await completeTracked(ctx, {
    model: resolveModel(ctx.config, 'default'),
    messages: [...toProviderMessages(ctx.rollingHistory), { role: 'user', content: prompt }],
    system: ctx.systemPrompt,
    max_tokens: 800,
  });

  const verdict = ReflectVerdict.safeParse(extractJson(response.content));
  let missionComplete: boolean;
  let missionFailed: boolean;
  let summary: string;
  if (verdict.success) {
    missionComplete = verdict.data.mission_complete;
    missionFailed = verdict.data.mission_failed && !verdict.data.mission_complete;
    summary = verdict.data.summary || response.content;
  } else {
    // Fallback heuristic for models that ignore the JSON instruction.
    const content = response.content.toLowerCase();
    missionComplete =
      content.includes('mission complete: true') || content.includes('mission complete');
    missionFailed = content.includes('mission failed');
    summary = response.content;
  }

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
    summary,
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

  const response = await completeTracked(ctx, {
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

function buildActPrompt(mission: MissionBrief, objective: string): string {
  return [
    `## Task\n${objective}`,
    `## Mission\n${mission.title}`,
    `## Instructions\nYou have no execution tools for this action. Produce the work product directly (analysis, draft, decision, or content) and report the outcome.`,
  ].join('\n\n');
}

function buildToolActPrompt(
  mission: MissionBrief,
  objective: string,
  toolDefs: ToolDefinition[],
  native: boolean
): string {
  const parts = [
    `## Task\n${objective}`,
    `## Mission\n${mission.title}`,
  ];

  if (native) {
    parts.push(
      `## Instructions\nExecute this task using the available tools. When the task is done (or cannot proceed), reply with a plain-text report of what you did and the outcome.`
    );
  } else {
    const catalog = toolDefs
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
    parts.push(
      `## Available Tools\n${catalog}`,
      [
        `## Instructions`,
        `Execute this task using the tools. Respond with EXACTLY ONE of:`,
        `1. A tool call — a single fenced JSON block: \`\`\`json\n{"tool": "<name>", "params": { ... }}\n\`\`\``,
        `2. A completion report — a single fenced JSON block: \`\`\`json\n{"done": true, "success": true, "report": "<what you did and the outcome>"}\n\`\`\``,
        `Set "success": false in the report if the task could not be accomplished. No other text outside the JSON block.`,
      ].join('\n')
    );
  }

  return parts.join('\n\n');
}

function buildValidatePrompt(mission: MissionBrief, actResult: ActResult): string {
  const toolSummary = actResult.toolCalls?.length
    ? `\nTool calls made: ${actResult.toolCalls
        .map((c) => `${c.tool} (${c.success ? 'ok' : 'FAILED'})`)
        .join(', ')}`
    : '';
  return [
    `## Action Result\n${actResult.output}${toolSummary}`,
    `## Mission Success Criteria\n${mission.successCriteria?.join('; ') ?? 'Complete the objectives successfully.'}`,
    `## Instructions\nDid the action succeed? Does it progress the mission? Respond with a single fenced JSON block:\n\`\`\`json\n{"passed": true, "reasoning": "<your assessment>"}\n\`\`\``,
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
    `## Instructions\nSynthesize what was learned and judge mission state. Respond with a single fenced JSON block:\n\`\`\`json\n{"mission_complete": false, "mission_failed": false, "summary": "<what was learned and what should be remembered>"}\n\`\`\`\nSet "mission_complete": true only when ALL objectives are met. Set "mission_failed": true only when the mission cannot succeed.`,
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

/**
 * Extract a JSON value from a model response: the first fenced code block,
 * or the whole content if it looks like a bare JSON object.
 */
function extractJson(content: string): unknown {
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(content);
  const candidate = fence ? fence[1] : content.trim().startsWith('{') ? content.trim() : undefined;
  if (!candidate) return undefined;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

const TextToolCall = z.object({
  tool: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

const TextDone = z.object({
  done: z.literal(true),
  success: z.boolean().default(true),
  report: z.string().default(''),
});

function parseTextToolCall(content: string): ToolInvocation | undefined {
  const parsed = TextToolCall.safeParse(extractJson(content));
  return parsed.success ? { tool: parsed.data.tool, params: parsed.data.params } : undefined;
}

function parseTextDone(content: string): { success: boolean; report: string } | undefined {
  const parsed = TextDone.safeParse(extractJson(content));
  return parsed.success ? { success: parsed.data.success, report: parsed.data.report } : undefined;
}

function truncateText(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text;
}

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
