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

import { getAgent, getMission, getDivision, transitionMission } from '../db/index.js';
import { publish } from '../bus/event-bus.js';
import { getBestProvider } from '../providers/registry.js';
import { logger } from '../utils/logger.js';
import { OperativeAgent } from './operative-agent.js';
import { defaultOperativeConfig } from './config-loader.js';
import { createEngramAdapter } from './engram-bridge.js';
import type { MissionBrief } from './types.js';
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
