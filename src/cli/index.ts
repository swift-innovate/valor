#!/usr/bin/env node
/**
 * VALOR CLI — Simple command-line interface for agent and mission management.
 *
 * Usage: node --import tsx src/cli/index.ts <command> [subcommand] [args]
 *
 * Commands:
 *   agent create <callsign> --role <role> --tier <N> --division <div>
 *   agent list
 *   mission create "<title>" --objective "<obj>" [--priority high]
 *   mission assign <mission_id> <callsign>
 *   mission run <mission_id> [agent_id]
 *   mission list
 *   roster rebuild
 *   status
 */

import { resolve } from 'node:path';
import { config } from '../config.js';
import { AgentLoader, AgentWriter, AgentDiscovery, RosterManager } from '../store/agent-store.js';
import { MissionLoader, MissionManager } from '../store/mission-store.js';
import { executeFolderMission } from '../execution/index.js';
import {
  registerProvider,
  createClaudeAdapter,
  createOllamaAdapter,
} from '../providers/index.js';
import { runMigrations } from '../db/index.js';

// ─── Arg parsing helpers ──────────────────────────────────────────────────

function getFlag(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function writeOut(text: string): void {
  process.stdout.write(text + '\n');
}

function writeErr(text: string): void {
  process.stderr.write(text + '\n');
}

// ─── Command handlers ─────────────────────────────────────────────────────

export function handleAgentCreate(args: readonly string[]): void {
  const callsign = args[0];
  if (!callsign) {
    writeErr('Usage: agent create <callsign> --role <role> --tier <N> --division <div>');
    process.exitCode = 1;
    return;
  }

  const role = getFlag(args, '--role');
  const tierStr = getFlag(args, '--tier');
  const division = getFlag(args, '--division');

  if (!role || !division) {
    writeErr('--role and --division are required');
    process.exitCode = 1;
    return;
  }

  const tier = tierStr ? Number(tierStr) : 2;
  if (![0, 1, 2, 3].includes(tier)) {
    writeErr('--tier must be 0, 1, 2, or 3');
    process.exitCode = 1;
    return;
  }

  const agentId = callsign.toLowerCase();
  const agentsDir = resolve(config.agentsDir);

  const voice = getFlag(args, '--voice');
  const status = getFlag(args, '--status');

  AgentWriter.createAgent(agentsDir, agentId, {
    callsign,
    role,
    tier: tier as 0 | 1 | 2 | 3,
    division,
    voice: voice ?? undefined,
    status: status ?? undefined,
  });

  RosterManager.rebuild(agentsDir);
  writeOut(`Agent created: ${agentId}`);
}

export function handleAgentList(): void {
  const agentsDir = resolve(config.agentsDir);
  const agentIds = AgentDiscovery.scan(agentsDir);

  if (agentIds.length === 0) {
    writeOut('No agents found.');
    return;
  }

  writeOut(`Agents (${agentIds.length}):`);
  for (const id of agentIds) {
    try {
      const agentPath = resolve(agentsDir, id);
      const cfg = AgentLoader.fromDirectory(agentPath);
      writeOut(`  ${cfg.name.padEnd(12)} tier=${cfg.tier}  division=${cfg.division ?? 'none'}  id=${cfg.id}`);
    } catch {
      writeOut(`  ${id.padEnd(12)} (failed to load)`);
    }
  }
}

export function handleMissionCreate(args: readonly string[]): void {
  const title = args[0];
  if (!title) {
    writeErr('Usage: mission create "<title>" --objective "<obj>" [--priority high]');
    process.exitCode = 1;
    return;
  }

  const objective = getFlag(args, '--objective');
  if (!objective) {
    writeErr('--objective is required');
    process.exitCode = 1;
    return;
  }

  const priority = getFlag(args, '--priority');
  const assignedTo = getFlag(args, '--assigned-to');

  const missionsDir = resolve(config.missionsDir);
  const missionId = MissionManager.create(missionsDir, title, objective, {
    priority: priority as 'low' | 'medium' | 'high' | 'critical' | undefined,
    assignedTo: assignedTo ?? undefined,
  });

  writeOut(`Mission created: ${missionId}`);
}

export function handleMissionAssign(args: readonly string[]): void {
  const missionId = args[0];
  const agentId = args[1];

  if (!missionId || !agentId) {
    writeErr('Usage: mission assign <mission_id> <agent_id>');
    process.exitCode = 1;
    return;
  }

  const missionsDir = resolve(config.missionsDir);
  MissionManager.assign(missionsDir, missionId, agentId);
  writeOut(`Mission ${missionId} assigned to ${agentId}`);
}

export function handleMissionList(): void {
  const missionsDir = resolve(config.missionsDir);
  const missions = MissionManager.list(missionsDir);

  if (missions.length === 0) {
    writeOut('No missions found.');
    return;
  }

  writeOut(`Missions (${missions.length}):`);
  for (const m of missions) {
    writeOut(`  ${m.missionId.padEnd(12)} [${m.status.padEnd(10)}] ${m.priority.padEnd(8)} assigned=${m.assignedTo}  "${m.title}"`);
  }
}

export async function handleMissionRun(args: readonly string[]): Promise<void> {
  const missionId = args[0];
  const agentId = args[1];

  if (!missionId) {
    writeErr('Usage: mission run <mission_id> [agent_id]');
    writeErr('If agent_id is omitted, uses the assigned agent from brief.md');
    process.exitCode = 1;
    return;
  }

  const missionsDir = resolve(config.missionsDir);
  const agentsDir = resolve(config.agentsDir);

  // Resolve agent — use arg or fall back to brief assignment
  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      const missionPath = resolve(missionsDir, missionId);
      const brief = MissionLoader.fromDirectory(missionPath);
      resolvedAgentId = brief.assignedTo;
    } catch {
      writeErr(`Mission "${missionId}" not found.`);
      process.exitCode = 1;
      return;
    }
  }

  if (!resolvedAgentId) {
    writeErr('No agent assigned to this mission. Provide agent_id or assign one first.');
    process.exitCode = 1;
    return;
  }

  // Initialize providers — the operative loop needs them
  runMigrations(); // event bus publish persists to DB
  if (config.anthropicApiKey) {
    registerProvider(createClaudeAdapter({ apiKey: config.anthropicApiKey }));
  }
  if (config.ollamaBaseUrl) {
    registerProvider(createOllamaAdapter({
      baseUrl: config.ollamaBaseUrl,
      statusUrl: config.ollamaStatusUrl,
    }));
  }

  writeOut(`Running mission ${missionId} with agent ${resolvedAgentId}...`);
  writeOut(`Agents dir: ${agentsDir}`);
  writeOut(`Missions dir: ${missionsDir}`);
  writeOut('');

  try {
    await executeFolderMission(missionId, resolvedAgentId, { agentsDir, missionsDir });

    // Read final state
    const missionPath = resolve(missionsDir, missionId);
    const brief = MissionLoader.fromDirectory(missionPath);
    writeOut(`Mission ${missionId} finished — state: ${brief.state}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    writeErr(`Mission execution failed: ${message}`);
    process.exitCode = 1;
  }
}

export function handleRosterRebuild(): void {
  const agentsDir = resolve(config.agentsDir);
  RosterManager.rebuild(agentsDir);
  writeOut('Roster rebuilt.');
}

export function handleStatus(): void {
  const agentsDir = resolve(config.agentsDir);
  const missionsDir = resolve(config.missionsDir);

  const agentIds = AgentDiscovery.scan(agentsDir);
  const missions = MissionManager.list(missionsDir);

  const active = missions.filter((m) => ['assigned', 'in_progress'].includes(m.status.toLowerCase()));
  const completed = missions.filter((m) => m.status.toLowerCase() === 'completed');
  const pending = missions.filter((m) => m.status.toLowerCase() === 'pending');

  writeOut('VALOR Engine Status');
  writeOut('-------------------');
  writeOut(`Agents:            ${agentIds.length}`);
  writeOut(`Missions (total):  ${missions.length}`);
  writeOut(`  Active:          ${active.length}`);
  writeOut(`  Completed:       ${completed.length}`);
  writeOut(`  Pending:         ${pending.length}`);
  writeOut(`Store backend:     ${config.storeBackend}`);
  writeOut(`Agents dir:        ${resolve(agentsDir)}`);
  writeOut(`Missions dir:      ${resolve(missionsDir)}`);
}

// ─── Main dispatch ────────────────────────────────────────────────────────

export async function dispatch(argv: readonly string[]): Promise<void> {
  const command = argv[0];
  const subcommand = argv[1];
  const rest = argv.slice(2);

  switch (command) {
    case 'agent':
      switch (subcommand) {
        case 'create':
          handleAgentCreate(rest);
          return;
        case 'list':
          handleAgentList();
          return;
        default:
          writeErr(`Unknown agent subcommand: ${subcommand ?? '(none)'}`);
          writeErr('Available: create, list');
          process.exitCode = 1;
          return;
      }

    case 'mission':
      switch (subcommand) {
        case 'create':
          handleMissionCreate(rest);
          return;
        case 'assign':
          handleMissionAssign(rest);
          return;
        case 'run':
          await handleMissionRun(rest);
          return;
        case 'list':
          handleMissionList();
          return;
        default:
          writeErr(`Unknown mission subcommand: ${subcommand ?? '(none)'}`);
          writeErr('Available: create, assign, run, list');
          process.exitCode = 1;
          return;
      }

    case 'roster':
      if (subcommand === 'rebuild') {
        handleRosterRebuild();
        return;
      }
      writeErr(`Unknown roster subcommand: ${subcommand ?? '(none)'}`);
      writeErr('Available: rebuild');
      process.exitCode = 1;
      return;

    case 'status':
      handleStatus();
      return;

    case undefined:
    case '--help':
    case '-h':
      writeOut('VALOR CLI');
      writeOut('');
      writeOut('Commands:');
      writeOut('  agent create <callsign> --role <role> --tier <N> --division <div>');
      writeOut('  agent list');
      writeOut('  mission create "<title>" --objective "<obj>" [--priority high]');
      writeOut('  mission assign <mission_id> <agent_id>');
      writeOut('  mission run <mission_id> [agent_id]');
      writeOut('  mission list');
      writeOut('  roster rebuild');
      writeOut('  status');
      return;

    default:
      writeErr(`Unknown command: ${command}`);
      process.exitCode = 1;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
dispatch(args).catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
