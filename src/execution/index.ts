export { OperativeAgent } from './operative-agent.js';
export type { OperativeOptions } from './operative-agent.js';
export { defaultOperativeConfig } from './config-loader.js';
export {
  createEngramAdapter,
  readOnlyAdapter,
  tickExtraction,
  tickReflection,
  closeAllEngram,
  getEngramStatus,
} from './engram-bridge.js';
export {
  runObserve,
  runPlan,
  runAct,
  runValidate,
  runReflect,
  runEvolve,
  shouldRunEvolve,
} from './phases.js';
export type { PhaseContext } from './phases.js';
export * from './types.js';
export {
  dispatchSubagents,
  formatSubagentResults,
  registerProfile,
  getProfile,
  listProfiles,
  clearProfiles,
} from './subagent.js';
export type { SubagentProfile, SubagentTask, SubagentResult } from './subagent.js';
export { createBuiltinTools, normalizeGrant } from './tools.js';
export type { BuiltinToolsOptions } from './tools.js';

import fs from 'node:fs';
import path from 'node:path';
import { getAgent, getMission, getDivision, transitionMission } from '../db/index.js';
import { publish } from '../bus/event-bus.js';
import { getBestProvider } from '../providers/registry.js';
import { logger } from '../utils/logger.js';
import { OperativeAgent } from './operative-agent.js';
import { defaultOperativeConfig } from './config-loader.js';
import { createEngramAdapter } from './engram-bridge.js';
import { createBuiltinTools } from './tools.js';
import { AgentLoader, AgentWriter } from '../store/agent-store.js';
import { MissionLoader, MissionWriter } from '../store/mission-store.js';
import { isValidAgentId, isValidMissionId } from '../store/ids.js';
import { stripProviderPrefix } from '../utils/model.js';
import type { MissionBrief, PhaseResult } from './types.js';
import type { Mission } from '../types/index.js';

/**
 * Convert a valor-engine Mission to the internal MissionBrief format
 * used by the operative phase loop.
 */
function toMissionBrief(mission: Mission): MissionBrief {
  return {
    missionId: mission.id,
    title: mission.title,
    assignedTo: mission.assigned_agent_id ?? '',
    assignedBy: 'director',
    priority: mission.priority === 'critical' ? 'critical'
      : mission.priority === 'high' ? 'high'
      : mission.priority === 'low' ? 'low'
      : 'medium',
    objectives: mission.objective ? [mission.objective] : [],
    successCriteria: mission.success_criteria.length > 0 ? mission.success_criteria : undefined,
    state: 'IN_PROGRESS',
  };
}

/**
 * Execute a mission using an internal OperativeAgent.
 * Called by the orchestrator for agents with runtime: 'internal'.
 *
 * This is the Phase 1 entry point — it:
 * 1. Loads the agent and mission from the DB
 * 2. Resolves a provider
 * 3. Creates an OperativeAgent with default config
 * 4. Runs the mission loop
 * 5. Transitions the mission to its terminal state
 */
export async function executeInternalMission(
  missionId: string,
  agentId: string
): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found`);

  const mission = getMission(missionId);
  if (!mission) throw new Error(`Mission "${missionId}" not found`);

  const division = agent.division_id ? getDivision(agent.division_id) : null;
  const provider = getBestProvider({ model: agent.model ?? undefined });
  if (!provider) throw new Error(`No provider available for model "${agent.model}"`);

  const config = defaultOperativeConfig(agent, division);
  const engram = createEngramAdapter(agentId, agent.callsign);
  const operative = new OperativeAgent(config, provider, engram);
  const brief = toMissionBrief(mission);

  operative.assignMission(brief);

  // Transition to streaming (the operative is actively working)
  transitionMission(missionId, 'streaming');

  publish({
    type: 'mission.internal_execution.started',
    source: { id: 'orchestrator', type: 'system' },
    target: { id: agentId, type: 'agent' },
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, agent_id: agentId },
    metadata: null,
  });

  logger.info('Internal mission execution started', {
    mission_id: missionId,
    agent_id: agentId,
    agent_callsign: agent.callsign,
  });

  const outcome = await operative.runMission();

  switch (outcome) {
    case 'completed':
      transitionMission(missionId, 'complete');
      break;
    case 'failed':
    case 'iteration_limit':
      transitionMission(missionId, 'failed');
      break;
    case 'escalated':
      // Escalated missions stay in streaming — Director must intervene
      logger.warn('Mission escalated', { mission_id: missionId, agent_id: agentId });
      break;
  }

  publish({
    type: `mission.internal_execution.${outcome}`,
    source: { id: agentId, type: 'agent' },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      mission_id: missionId,
      agent_id: agentId,
      outcome,
      final_state: operative.getState(),
    },
    metadata: null,
  });

  logger.info('Internal mission execution finished', {
    mission_id: missionId,
    agent_id: agentId,
    outcome,
  });
}

// ─── Folder-based mission execution ────────────────────────────────────────

/**
 * Build additional system prompt context from folder-based working memory
 * and mission progress. Injected via OperativeOptions.systemPromptExtra
 * so the operative loop has full context without needing SQLite.
 */
export function buildFolderContext(workingMemory: string, missionProgress: string): string {
  const parts: string[] = [];
  if (workingMemory) parts.push(`## Working Memory\n${workingMemory}`);
  if (missionProgress) parts.push(`## Mission Progress\n${missionProgress}`);
  return parts.join('\n\n');
}

/**
 * Execute a mission using folder-based stores instead of SQLite.
 *
 * This is the folder-store counterpart of executeInternalMission().
 * It reads agent config and mission briefs from the filesystem,
 * runs the operative loop, then writes results back to the folders.
 *
 * @param missionId - The mission directory name under opts.missionsDir
 * @param agentId   - The agent directory name under opts.agentsDir
 * @param opts      - Paths to agents/ and missions/ root directories
 */
export async function executeFolderMission(
  missionId: string,
  agentId: string,
  opts: { agentsDir: string; missionsDir: string }
): Promise<void> {
  // 0. Defense in depth: ids become directory names — reject anything that
  // could traverse out of the store roots, even if a caller forgot to validate.
  if (!isValidAgentId(agentId)) {
    throw new Error(`Invalid agent id "${agentId}"`);
  }
  if (!isValidMissionId(missionId)) {
    throw new Error(`Invalid mission id "${missionId}"`);
  }

  // 1. Resolve paths
  const agentPath = path.join(opts.agentsDir, agentId);
  const missionPath = path.join(opts.missionsDir, missionId);

  // 2. Load agent config from folder (throws if folder missing or invalid)
  const config = AgentLoader.fromDirectory(agentPath);

  // 3. Load mission brief from folder (throws if folder missing or invalid)
  const brief = MissionLoader.fromDirectory(missionPath);

  // 4. Read agent persona (soul/identity), working memory, and mission progress
  const personaContent = AgentLoader.readPersona(agentPath);
  const workingMemory = AgentLoader.readMemory(agentPath, 'working');
  const missionProgress = MissionLoader.readProgress(missionPath);

  // 5. Resolve provider from the agent's model assignment
  // Model strings may include a provider prefix (e.g., "anthropic/claude-sonnet-4-20250514"
  // or "ollama/gemma3:12b"). Strip the prefix for provider matching since the registry
  // stores bare model names.
  const rawModel = config.modelAssignment['default'];
  const model = rawModel ? stripProviderPrefix(rawModel) : rawModel;
  const provider = getBestProvider({ model });
  if (!provider) {
    throw new Error(`No provider available for model "${model ?? 'unspecified'}"`);
  }

  // 6. Create engram adapter (gracefully degrades to null adapter if unavailable)
  const engram = createEngramAdapter(agentId, config.name);

  // 7. Built-in tools, jailed to a per-agent workspace directory.
  //    Grants come from tools.md (config.tools) — no grants means no tools.
  const workspaceRoot = path.join(opts.agentsDir, 'workspaces', agentId);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const tools = createBuiltinTools({
    workspaceRoot,
    enabled: config.tools.enabled,
    disabled: config.tools.disabled,
  });

  // 8. Create OperativeAgent with persona as identity and folder context as extra.
  //    The phase hook persists per-phase outcomes into the agent/mission folders:
  //    reflect → memory/reflections.md, evolve → memory/long-term.md,
  //    plan escalations → decisions.md, act outcomes → progress.md.
  const operative = new OperativeAgent(config, provider, engram, {
    persona: personaContent || undefined,
    systemPromptExtra: buildFolderContext(workingMemory, missionProgress),
    tools,
    onPhaseResult: (result: PhaseResult, iteration: number) => {
      writePhaseToFolders(result, iteration, {
        agentPath,
        missionPath,
        agentId,
        missionId,
      });
    },
  });

  // 9. Assign mission to the operative
  operative.assignMission(brief);

  // 10. Mark mission as in_progress in the folder
  MissionWriter.updateBriefStatus(missionPath, 'in_progress');

  // 11. Publish start event
  publish({
    type: 'mission.folder_execution.started',
    source: { id: 'orchestrator', type: 'system' },
    target: { id: agentId, type: 'agent' },
    conversation_id: null,
    in_reply_to: null,
    payload: { mission_id: missionId, agent_id: agentId },
    metadata: null,
  });

  logger.info('Folder mission execution started', {
    mission_id: missionId,
    agent_id: agentId,
    agent_callsign: config.name,
    agent_path: agentPath,
    mission_path: missionPath,
  });

  // 12. Run the operative loop — catch transient errors and revert status
  let outcome: 'completed' | 'failed' | 'escalated' | 'iteration_limit';
  try {
    outcome = await operative.runMission();
  } catch (err: unknown) {
    // Transient error (provider down, network issue, etc.) — revert to assigned so it can be retried
    const message = err instanceof Error ? err.message : String(err);
    MissionWriter.updateBriefStatus(missionPath, 'assigned');
    MissionWriter.appendProgress(missionPath, {
      phase: 'error',
      agent: agentId,
      summary: `Operative loop threw: ${message}`,
    });
    logger.error('Folder mission execution error — reverted to assigned', {
      mission_id: missionId,
      agent_id: agentId,
      error: message,
    });
    throw err; // re-throw so the caller (API/CLI) sees the error
  }

  const finalState = operative.getState();

  // 13. Write results back to folders based on outcome
  MissionWriter.appendProgress(missionPath, {
    phase: outcome,
    agent: agentId,
    summary: `Mission ${outcome} after ${finalState.iterationCount} iteration(s). `
      + `Act cycles used: ${finalState.actCyclesUsed}.`,
  });

  AgentWriter.appendMemory(
    agentPath,
    'working',
    `\n### Mission ${missionId} — ${outcome}\n`
      + `Completed at ${new Date().toISOString()} after ${finalState.iterationCount} iteration(s).\n`
  );

  switch (outcome) {
    case 'completed':
      MissionWriter.writeHandoff(missionPath, {
        summary: `Mission ${missionId} completed successfully by ${agentId}.`,
        keyFiles: [],
      });
      MissionWriter.updateBriefStatus(missionPath, 'completed');
      break;

    case 'failed':
    case 'iteration_limit':
      // Loop decided the mission failed — but don't make it permanently terminal.
      // Set to 'failed' so the dashboard can show what happened, but allow reset.
      MissionWriter.updateBriefStatus(missionPath, 'failed');
      break;

    case 'escalated':
      MissionWriter.updateBriefStatus(missionPath, 'escalated');
      logger.warn('Folder mission escalated', {
        mission_id: missionId,
        agent_id: agentId,
      });
      break;
  }

  // 14. Publish completion event
  publish({
    type: `mission.folder_execution.${outcome}`,
    source: { id: agentId, type: 'agent' },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      mission_id: missionId,
      agent_id: agentId,
      outcome,
      final_state: finalState,
    },
    metadata: null,
  });

  logger.info('Folder mission execution finished', {
    mission_id: missionId,
    agent_id: agentId,
    outcome,
    iterations: finalState.iterationCount,
  });
}

// ─── Per-phase folder persistence ────────────────────────────────────────────

function clip(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Persist a phase result into the agent/mission folders. Called from the
 * OperativeAgent phase hook — errors here are caught by the hook wrapper
 * and never interrupt the loop.
 */
function writePhaseToFolders(
  result: PhaseResult,
  iteration: number,
  paths: { agentPath: string; missionPath: string; agentId: string; missionId: string }
): void {
  switch (result.phase) {
    case 'act': {
      const toolSummary = result.toolCalls?.length
        ? ` Tools: ${result.toolCalls.map((c) => `${c.tool}(${c.success ? 'ok' : 'failed'})`).join(', ')}.`
        : '';
      MissionWriter.appendProgress(paths.missionPath, {
        phase: 'act',
        agent: paths.agentId,
        summary: `[iter ${iteration + 1}] ${clip(result.output, 500)}${toolSummary}`,
      });
      break;
    }

    case 'plan': {
      if (result.needsEscalation) {
        MissionWriter.appendDecision(paths.missionPath, {
          title: `Escalation requested (iteration ${iteration + 1})`,
          decision: 'Escalate to Director',
          rationale: result.escalationReason ?? 'Cannot proceed — escalation required',
          decidedBy: paths.agentId,
        });
      }
      break;
    }

    case 'reflect': {
      AgentWriter.appendMemory(
        paths.agentPath,
        'reflections',
        `### ${paths.missionId} — iteration ${iteration + 1} (${new Date().toISOString()})\n${clip(result.summary, 1500)}\n`
      );
      break;
    }

    case 'evolve': {
      if (result.assessed && result.proposals.length > 0) {
        AgentWriter.appendMemory(
          paths.agentPath,
          'long-term',
          `### Evolution proposals — ${paths.missionId} (${new Date().toISOString()})\n${result.proposals.map((p) => `- ${p}`).join('\n')}\n`
        );
      }
      break;
    }

    default:
      break;
  }
}
