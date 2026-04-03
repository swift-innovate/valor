import type { ProviderAdapter, ProviderResponse } from '../providers/types.js';
import { getBestProvider } from '../providers/registry.js';
import { publish } from '../bus/event-bus.js';
import { logger } from '../utils/logger.js';
import type { EngramAdapter } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubagentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  maxTokens?: number;
}

export interface SubagentTask {
  id: string;
  instruction: string;
  profile?: string;
  systemPrompt?: string;
  model?: string;
}

export interface SubagentResult {
  id: string;
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 5;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_SYSTEM_PROMPT =
  'You are a focused sub-agent. Complete the given task concisely. Return only what was requested.';
const SUBAGENT_TIMEOUT_MS = 60_000;

// ─── Profile Registry ───────────────────────────────────────────────────────

const profiles = new Map<string, SubagentProfile>();

export function registerProfile(profile: SubagentProfile): void {
  profiles.set(profile.name.toLowerCase(), profile);
}

export function getProfile(name: string): SubagentProfile | undefined {
  return profiles.get(name.toLowerCase());
}

export function listProfiles(): SubagentProfile[] {
  return [...profiles.values()];
}

export function clearProfiles(): void {
  profiles.clear();
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

/**
 * Dispatch sub-agent tasks concurrently (max 5 at a time).
 * Each task is a single provider.complete() call — no phase loop, no recursion.
 *
 * @param tasks - Tasks to execute
 * @param parentProvider - Fallback provider if task model isn't available
 * @param engram - Optional read-only Engram adapter for context injection
 * @param parentContext - Optional context for sitrep publishing
 */
export async function dispatchSubagents(
  tasks: SubagentTask[],
  parentProvider: ProviderAdapter,
  engram?: EngramAdapter,
  parentContext?: { agentId: string; missionId: string },
): Promise<SubagentResult[]> {
  if (tasks.length === 0) return [];

  logger.info('Dispatching sub-agents', { count: tasks.length });

  const results: SubagentResult[] = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < tasks.length; i += MAX_CONCURRENT) {
    const batch = tasks.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.allSettled(
      batch.map(task => runSubagent(task, parentProvider, engram))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const settled = batchResults[j]!;
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        results.push({
          id: batch[j]!.id,
          content: '',
          model: 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
        });
      }
    }
  }

  // Publish sitrep if parent context provided
  if (parentContext) {
    try {
      publish({
        type: 'sitrep.subagent',
        source: { id: parentContext.agentId, type: 'agent' },
        target: null,
        conversation_id: null,
        in_reply_to: null,
        payload: {
          mission_id: parentContext.missionId,
          subagent_count: tasks.length,
          completed: results.filter(r => !r.error).length,
          failed: results.filter(r => r.error).length,
          models_used: [...new Set(results.map(r => r.model))],
          timestamp: new Date().toISOString(),
        },
        metadata: null,
      });
    } catch (err) {
      logger.error('Failed to publish subagent sitrep', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failed = results.filter(r => r.error).length;
  logger.info('Sub-agents completed', {
    total: tasks.length,
    succeeded: results.length - failed,
    failed,
  });

  return results;
}

/**
 * Format sub-agent results into a string for the parent's context.
 */
export function formatSubagentResults(results: SubagentResult[]): string {
  if (results.length === 0) return '(no sub-agent results)';

  return results
    .map(r => {
      const header = `=== Sub-agent: ${r.id} ===`;
      if (r.error) return `${header}\nError: ${r.error}`;
      return `${header}\n${r.content}`;
    })
    .join('\n\n');
}

// ─── Execution (private) ────────────────────────────────────────────────────

async function runSubagent(
  task: SubagentTask,
  parentProvider: ProviderAdapter,
  engram?: EngramAdapter,
): Promise<SubagentResult> {
  // Resolve profile
  const profile = task.profile ? getProfile(task.profile) : undefined;

  if (task.profile && !profile) {
    return {
      id: task.id,
      content: '',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      error: `Profile not found: ${task.profile}`,
    };
  }

  const systemPrompt = task.systemPrompt ?? profile?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const maxTokens = profile?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const requestedModel = task.model ?? profile?.model;

  // Resolve provider — try task/profile model first, fall back to parent
  let provider = parentProvider;
  let modelName = parentProvider.capabilities.models[0] ?? 'default';

  if (requestedModel) {
    const specific = getBestProvider({ model: requestedModel });
    if (specific) {
      provider = specific;
      modelName = requestedModel;
    } else {
      logger.debug('Sub-agent model not available, using parent provider', {
        requested: requestedModel,
        fallback: parentProvider.id,
      });
    }
  }

  // Inject parent memory context if Engram is available
  let memoryContext = '';
  if (engram) {
    try {
      memoryContext = await engram.recall({
        agentId: task.id,
        domains: ['shared'],
        query: task.instruction,
        budgetTokens: 1000,
      });
    } catch {
      // Non-fatal — sub-agent proceeds without memory
    }
  }

  const fullSystemPrompt = memoryContext
    ? `${systemPrompt}\n\n${memoryContext}`
    : systemPrompt;

  try {
    const response = await withTimeout(
      provider.complete({
        model: modelName,
        messages: [{ role: 'user', content: task.instruction }],
        system: fullSystemPrompt,
        max_tokens: maxTokens,
      }),
      SUBAGENT_TIMEOUT_MS,
    );

    return {
      id: task.id,
      content: response.content,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    return {
      id: task.id,
      content: '',
      model: modelName,
      inputTokens: 0,
      outputTokens: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Sub-agent timed out after ${ms}ms`)), ms)
    ),
  ]);
}
