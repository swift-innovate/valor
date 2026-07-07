import type { Agent, Division } from '../types/index.js';
import { config as engineConfig } from '../config.js';
import type { OperativeConfig } from './types.js';

/**
 * Build an OperativeConfig from an agent record and optional division.
 * For Phase 1, uses sensible defaults. Future phases will load from
 * agent metadata or a config file.
 */
export function defaultOperativeConfig(
  agent: Agent,
  division: Division | null
): OperativeConfig {
  return {
    id: agent.id,
    name: agent.callsign,
    tier: 2,
    division: division?.name,
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
    modelAssignment: {
      default: agent.model ?? engineConfig.defaultModel,
    },
    tools: { enabled: [], disabled: [] },
  };
}
