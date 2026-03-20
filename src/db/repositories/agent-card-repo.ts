import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type AgentCard, AgentCardSchema } from "../../types/index.js";
import { createAgent, updateAgent } from "./agent-repo.js";
import { publish } from "../../bus/event-bus.js";

function generateId(): string {
  return `acd_${nanoid(21)}`;
}

function rowToCard(row: Record<string, unknown>): AgentCard {
  return AgentCardSchema.parse({
    ...row,
    primary_skills: JSON.parse(row.primary_skills as string),
  });
}

export function submitCard(input: {
  callsign: string;
  name: string;
  operator: string;
  version?: string;
  primary_skills: string[];
  runtime: string;
  model?: string | null;
  endpoint_url?: string | null;
  description: string;
}): AgentCard {
  // Check for existing active card with this callsign
  const existing = getDb().queryOne<{ id: string; approval_status: string }>(
    "SELECT id, approval_status FROM agent_cards WHERE callsign = @callsign AND approval_status IN ('pending', 'approved') LIMIT 1",
    { callsign: input.callsign },
  );

  if (existing) {
    if (existing.approval_status === "approved") {
      throw new Error(`Callsign "${input.callsign}" is already registered and approved (card: ${existing.id})`);
    } else {
      throw new Error(`Callsign "${input.callsign}" already has a pending card (card: ${existing.id})`);
    }
  }

  const now = new Date().toISOString();
  const id = generateId();

  getDb().execute(
    `INSERT INTO agent_cards (id, callsign, name, operator, version, primary_skills, runtime, model, endpoint_url, description, approval_status, submitted_at, updated_at)
     VALUES (@id, @callsign, @name, @operator, @version, @primary_skills, @runtime, @model, @endpoint_url, @description, 'pending', @submitted_at, @updated_at)`,
    {
      id,
      callsign: input.callsign,
      name: input.name,
      operator: input.operator,
      version: input.version ?? "1.0.0",
      primary_skills: JSON.stringify(input.primary_skills),
      runtime: input.runtime,
      model: input.model ?? null,
      endpoint_url: input.endpoint_url ?? null,
      description: input.description,
      submitted_at: now,
      updated_at: now,
    },
  );

  const card = rowToCard(
    getDb().queryOne("SELECT * FROM agent_cards WHERE id = @id", { id }) as Record<string, unknown>,
  );

  publish({
    type: "agent.card.submitted",
    source: { id: "system", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { card_id: card.id, callsign: card.callsign, operator: card.operator },
    metadata: null,
  });

  return card;
}

export function getCard(id: string): AgentCard | null {
  const row = getDb().queryOne("SELECT * FROM agent_cards WHERE id = @id", { id });
  return row ? rowToCard(row as Record<string, unknown>) : null;
}

export function getCardByCallsign(callsign: string): AgentCard | null {
  const row = getDb().queryOne(
    "SELECT * FROM agent_cards WHERE callsign = @callsign ORDER BY submitted_at DESC LIMIT 1",
    { callsign },
  );
  return row ? rowToCard(row as Record<string, unknown>) : null;
}

export function listCards(filters?: {
  approval_status?: string;
  callsign?: string;
  operator?: string;
}): AgentCard[] {
  let sql = "SELECT * FROM agent_cards";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.approval_status) {
    conditions.push("approval_status = @approval_status");
    params.approval_status = filters.approval_status;
  }
  if (filters?.callsign) {
    conditions.push("callsign = @callsign");
    params.callsign = filters.callsign;
  }
  if (filters?.operator) {
    conditions.push("operator = @operator");
    params.operator = filters.operator;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY submitted_at DESC";

  const rows = getDb().queryAll(sql, params);
  return rows.map((r) => rowToCard(r as Record<string, unknown>));
}

export function updateCard(
  id: string,
  updates: Partial<Pick<AgentCard, "callsign" | "name" | "operator" | "version" | "primary_skills" | "runtime" | "model" | "endpoint_url" | "description">>,
): AgentCard | null {
  const existing = getCard(id);
  if (!existing) return null;
  if (existing.approval_status !== "pending") return null;

  // If callsign is changing, ensure the new callsign isn't already taken
  if (updates.callsign && updates.callsign !== existing.callsign) {
    const conflict = getDb().queryOne<{ id: string; approval_status: string }>(
      "SELECT id, approval_status FROM agent_cards WHERE callsign = @callsign AND approval_status IN ('pending', 'approved') AND id != @id LIMIT 1",
      { callsign: updates.callsign, id },
    );

    if (conflict) {
      if (conflict.approval_status === "approved") {
        throw new Error(`Callsign "${updates.callsign}" is already registered and approved (card: ${conflict.id})`);
      } else {
        throw new Error(`Callsign "${updates.callsign}" already has a pending card (card: ${conflict.id})`);
      }
    }
  }

  const now = new Date().toISOString();

  const merged = { ...existing, ...updates, updated_at: now };

  getDb().execute(
    `UPDATE agent_cards SET callsign = @callsign, name = @name, operator = @operator, version = @version,
     primary_skills = @primary_skills, runtime = @runtime, model = @model, endpoint_url = @endpoint_url,
     description = @description, updated_at = @updated_at WHERE id = @id`,
    {
      id,
      callsign: merged.callsign,
      name: merged.name,
      operator: merged.operator,
      version: merged.version,
      primary_skills: JSON.stringify(merged.primary_skills),
      runtime: merged.runtime,
      model: merged.model,
      endpoint_url: merged.endpoint_url,
      description: merged.description,
      updated_at: now,
    },
  );

  return getCard(id);
}

export function approveCard(id: string, approvedBy: string): AgentCard | null {
  const existing = getCard(id);
  if (!existing) return null;
  if (existing.approval_status !== "pending") return null;

  const now = new Date().toISOString();

  // Create the agent from card info
  const agent = createAgent({
    callsign: existing.callsign,
    runtime: existing.runtime,
    division_id: null,
    endpoint_url: existing.endpoint_url,
    model: existing.model,
    persona_id: null,
    capabilities: existing.primary_skills,
    health_status: "registered",
    last_heartbeat: null,
  });

  getDb().execute(
    `UPDATE agent_cards SET approval_status = 'approved', approved_by = @approved_by,
     approved_at = @approved_at, agent_id = @agent_id, updated_at = @updated_at WHERE id = @id`,
    {
      id,
      approved_by: approvedBy,
      approved_at: now,
      agent_id: agent.id,
      updated_at: now,
    },
  );

  const card = getCard(id)!;

  publish({
    type: "agent.card.approved",
    source: { id: approvedBy, type: "director" },
    target: { id: agent.id, type: "agent" },
    conversation_id: null,
    in_reply_to: null,
    payload: { card_id: card.id, agent_id: agent.id, callsign: card.callsign },
    metadata: null,
  });

  // Send a welcome message to the agent's comms inbox so they see
  // their approval alongside normal messages — no separate polling needed.
  publish({
    type: "comms.message",
    source: { id: approvedBy, type: "director" },
    target: { id: agent.id, type: "agent" },
    conversation_id: `card_${card.id}`,
    in_reply_to: null,
    payload: {
      from_agent_id: "director",
      to_agent_id: agent.id,
      subject: `Welcome to VALOR, ${card.callsign}`,
      body: `Your agent card has been approved. Your agent ID is \`${agent.id}\`. You are now cleared for heartbeats, comms, and mission assignment. Review the integration guide at /skill.md if needed.`,
      priority: "routine",
      category: "advisory",
    },
    metadata: null,
  });

  return card;
}

export function rejectCard(id: string, reason: string): AgentCard | null {
  const existing = getCard(id);
  if (!existing) return null;
  if (existing.approval_status !== "pending") return null;

  const now = new Date().toISOString();

  getDb().execute(
    `UPDATE agent_cards SET approval_status = 'rejected', rejection_reason = @reason,
     updated_at = @updated_at WHERE id = @id`,
    { id, reason, updated_at: now },
  );

  const card = getCard(id)!;

  publish({
    type: "agent.card.rejected",
    source: { id: "system", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { card_id: card.id, callsign: card.callsign, reason },
    metadata: null,
  });

  // Notify via comms so the rejection reason is visible if the agent
  // checks back later after resubmitting and getting approved.
  // Note: rejected agents don't have an agent_id yet, so we target
  // the card ID as a reference.
  publish({
    type: "comms.message",
    source: { id: "system", type: "system" },
    target: null,
    conversation_id: `card_${card.id}`,
    in_reply_to: null,
    payload: {
      from_agent_id: "director",
      to_agent_id: null,
      to_division_id: null,
      subject: `Agent card rejected: ${card.callsign}`,
      body: `Your agent card was not approved. Reason: ${reason}`,
      priority: "routine",
      category: "advisory",
    },
    metadata: null,
  });

  return card;
}

export function revokeCard(id: string): AgentCard | null {
  const existing = getCard(id);
  if (!existing) return null;
  if (existing.approval_status !== "approved") return null;

  const now = new Date().toISOString();

  // Deregister the linked agent
  if (existing.agent_id) {
    updateAgent(existing.agent_id, { health_status: "deregistered" });
  }

  getDb().execute(
    `UPDATE agent_cards SET approval_status = 'revoked', updated_at = @updated_at WHERE id = @id`,
    { id, updated_at: now },
  );

  const card = getCard(id)!;

  publish({
    type: "agent.card.revoked",
    source: { id: "system", type: "system" },
    target: existing.agent_id ? { id: existing.agent_id, type: "agent" } : null,
    conversation_id: null,
    in_reply_to: null,
    payload: { card_id: card.id, callsign: card.callsign, agent_id: existing.agent_id },
    metadata: null,
  });

  // Notify the agent their access has been revoked
  if (existing.agent_id) {
    publish({
      type: "comms.message",
      source: { id: "system", type: "system" },
      target: { id: existing.agent_id, type: "agent" },
      conversation_id: `card_${card.id}`,
      in_reply_to: null,
      payload: {
        from_agent_id: "director",
        to_agent_id: existing.agent_id,
        subject: `Access revoked: ${card.callsign}`,
        body: `Your agent card has been revoked. You are no longer authorized to participate in VALOR operations.`,
        priority: "flash",
        category: "advisory",
      },
      metadata: null,
    });
  }

  return card;
}
