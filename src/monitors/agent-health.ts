/**
 * Agent Health Sweep Monitor
 *
 * Periodically checks last_heartbeat on all agents and transitions stale
 * agents to degraded or offline. Follows MissionTimeoutMonitor pattern.
 */

import { listAgents, updateAgent } from "../db/index.js";
import { publish } from "../bus/event-bus.js";
import { logger } from "../utils/logger.js";
import type { AgentStatus } from "../types/index.js";

const DEFAULT_DEGRADED_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_OFFLINE_MS = 15 * 60 * 1000; // 15 minutes
const CHECK_INTERVAL_MS = 60_000; // sweep every minute

export interface AgentHealthConfig {
  degradedAfterMs: number;
  offlineAfterMs: number;
}

export class AgentHealthMonitor {
  private timer: NodeJS.Timeout | null = null;
  private config: AgentHealthConfig;

  constructor(config?: Partial<AgentHealthConfig>) {
    this.config = {
      degradedAfterMs: config?.degradedAfterMs
        ?? parseInt(process.env.AGENT_DEGRADED_AFTER_MS ?? String(DEFAULT_DEGRADED_MS), 10),
      offlineAfterMs: config?.offlineAfterMs
        ?? parseInt(process.env.AGENT_OFFLINE_AFTER_MS ?? String(DEFAULT_OFFLINE_MS), 10),
    };
  }

  start(): void {
    if (this.timer !== null) {
      logger.warn("[AgentHealthMonitor] Already running — ignoring duplicate start()");
      return;
    }
    this.timer = setInterval(() => {
      this.sweep();
    }, CHECK_INTERVAL_MS);

    logger.info("[AgentHealthMonitor] Started", {
      degraded_after_ms: this.config.degradedAfterMs,
      offline_after_ms: this.config.offlineAfterMs,
      check_interval_ms: CHECK_INTERVAL_MS,
    });
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[AgentHealthMonitor] Stopped");
    }
  }

  private sweep(): void {
    const now = Date.now();
    const agents = listAgents({});

    for (const agent of agents) {
      // Skip deregistered agents and agents with no heartbeat yet
      if (agent.health_status === "deregistered") continue;
      if (!agent.last_heartbeat) {
        // Agent registered but never heartbeated — leave as "registered"
        continue;
      }

      const lastBeat = new Date(agent.last_heartbeat).getTime();
      if (isNaN(lastBeat)) continue;

      const elapsed = now - lastBeat;
      let newStatus: AgentStatus | null = null;

      if (elapsed > this.config.offlineAfterMs && agent.health_status !== "offline") {
        newStatus = "offline";
      } else if (
        elapsed > this.config.degradedAfterMs &&
        elapsed <= this.config.offlineAfterMs &&
        agent.health_status === "healthy"
      ) {
        newStatus = "degraded";
      }

      if (newStatus) {
        const oldStatus = agent.health_status;
        updateAgent(agent.id, { health_status: newStatus });

        publish({
          type: "agent.health.changed",
          source: { id: "system", type: "system" },
          target: { id: agent.id, type: "agent" },
          conversation_id: null,
          in_reply_to: null,
          payload: {
            agent_id: agent.id,
            callsign: agent.callsign,
            old_status: oldStatus,
            new_status: newStatus,
            last_heartbeat: agent.last_heartbeat,
            elapsed_ms: elapsed,
          },
          metadata: null,
        });

        logger.info("[AgentHealthMonitor] Agent status changed", {
          agent_id: agent.id,
          callsign: agent.callsign,
          old_status: oldStatus,
          new_status: newStatus,
          elapsed_ms: elapsed,
        });
      }
    }
  }
}

export const agentHealthMonitor = new AgentHealthMonitor();
