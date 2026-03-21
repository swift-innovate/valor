import { logger } from "../utils/logger.js";
import { getAgent, getMission, appendAuditEntry } from "../db/index.js";
import { publish } from "../bus/index.js";
import type { Mission, Agent } from "../types/index.js";

export interface WebhookPayload {
  type: "mission.dispatch" | "mission.abort" | "mission.update";
  mission_id: string;
  mission: {
    id: string;
    title: string;
    objective: string;
    priority: string;
    constraints: string[];
    deliverables: string[];
    success_criteria: string[];
    max_revisions: number;
  };
  callback_url: string;
  timestamp: string;
}

export interface WebhookResult {
  delivered: boolean;
  agent_id: string;
  endpoint_url: string;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
}

/**
 * Dispatch a mission brief to an agent via their registered endpoint_url.
 * Returns the delivery result. Does not throw — always returns a result object.
 */
export async function dispatchWebhook(
  missionId: string,
  agentId: string,
  callbackBaseUrl: string,
): Promise<WebhookResult> {
  const start = Date.now();
  const agent = getAgent(agentId);
  if (!agent) {
    return {
      delivered: false,
      agent_id: agentId,
      endpoint_url: "",
      status_code: null,
      error: "Agent not found",
      duration_ms: Date.now() - start,
    };
  }

  if (!agent.endpoint_url) {
    return {
      delivered: false,
      agent_id: agentId,
      endpoint_url: "",
      status_code: null,
      error: "Agent has no endpoint_url — agent must poll for missions",
      duration_ms: Date.now() - start,
    };
  }

  const mission = getMission(missionId);
  if (!mission) {
    return {
      delivered: false,
      agent_id: agentId,
      endpoint_url: agent.endpoint_url,
      status_code: null,
      error: "Mission not found",
      duration_ms: Date.now() - start,
    };
  }

  const payload: WebhookPayload = {
    type: "mission.dispatch",
    mission_id: mission.id,
    mission: {
      id: mission.id,
      title: mission.title,
      objective: mission.objective,
      priority: mission.priority,
      constraints: mission.constraints,
      deliverables: mission.deliverables,
      success_criteria: mission.success_criteria,
      max_revisions: mission.max_revisions,
    },
    callback_url: `${callbackBaseUrl}/agents/${agentId}/sitrep`,
    timestamp: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(agent.endpoint_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VALOR-Source": "engine",
        "X-VALOR-Mission-ID": mission.id,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const duration_ms = Date.now() - start;
    const delivered = response.ok;

    logger.info("Webhook dispatched", {
      agent_id: agentId,
      mission_id: missionId,
      endpoint: agent.endpoint_url,
      status: response.status,
      delivered,
      duration_ms,
    });

    appendAuditEntry({
      entity_type: "webhook",
      entity_id: missionId,
      operation: "create",
      before_state: null,
      after_state: JSON.stringify({
        agent_id: agentId,
        endpoint: agent.endpoint_url,
        status: response.status,
        delivered,
      }),
      actor_id: "dispatcher",
    });

    publish({
      type: delivered ? "dispatch.webhook.delivered" : "dispatch.webhook.failed",
      source: { id: "dispatcher", type: "system" },
      target: { id: agentId, type: "agent" },
      conversation_id: null,
      in_reply_to: null,
      payload: {
        mission_id: missionId,
        agent_id: agentId,
        status_code: response.status,
        delivered,
        duration_ms,
      },
      metadata: null,
    });

    return {
      delivered,
      agent_id: agentId,
      endpoint_url: agent.endpoint_url,
      status_code: response.status,
      error: delivered ? null : `HTTP ${response.status}`,
      duration_ms,
    };
  } catch (err) {
    const duration_ms = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);

    logger.warn("Webhook dispatch failed", {
      agent_id: agentId,
      mission_id: missionId,
      endpoint: agent.endpoint_url,
      error,
      duration_ms,
    });

    publish({
      type: "dispatch.webhook.failed",
      source: { id: "dispatcher", type: "system" },
      target: { id: agentId, type: "agent" },
      conversation_id: null,
      in_reply_to: null,
      payload: {
        mission_id: missionId,
        agent_id: agentId,
        error,
        duration_ms,
      },
      metadata: null,
    });

    return {
      delivered: false,
      agent_id: agentId,
      endpoint_url: agent.endpoint_url,
      status_code: null,
      error,
      duration_ms,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send an abort signal to an agent via webhook.
 */
export async function dispatchAbortWebhook(
  missionId: string,
  agentId: string,
  reason: string,
): Promise<WebhookResult> {
  const start = Date.now();
  const agent = getAgent(agentId);
  if (!agent?.endpoint_url) {
    return {
      delivered: false,
      agent_id: agentId,
      endpoint_url: agent?.endpoint_url ?? "",
      status_code: null,
      error: agent ? "No endpoint_url" : "Agent not found",
      duration_ms: Date.now() - start,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(agent.endpoint_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VALOR-Source": "engine",
        "X-VALOR-Mission-ID": missionId,
      },
      body: JSON.stringify({
        type: "mission.abort",
        mission_id: missionId,
        reason,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    return {
      delivered: response.ok,
      agent_id: agentId,
      endpoint_url: agent.endpoint_url,
      status_code: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      delivered: false,
      agent_id: agentId,
      endpoint_url: agent.endpoint_url,
      status_code: null,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}
