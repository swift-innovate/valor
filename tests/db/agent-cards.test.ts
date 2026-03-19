import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import {
  submitCard,
  getCard,
  getCardByCallsign,
  listCards,
  updateCard,
  approveCard,
  rejectCard,
  revokeCard,
} from "../../src/db/repositories/agent-card-repo.js";
import { getAgent } from "../../src/db/repositories/agent-repo.js";
import {
  subscribe,
  clearSubscriptions,
} from "../../src/bus/event-bus.js";
import type { EventEnvelope } from "../../src/types/index.js";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

const baseCard = {
  callsign: "Gage",
  name: "Gage — Code Division Lead",
  operator: "SIT",
  primary_skills: ["code_review", "architecture", "typescript"],
  runtime: "claude_api" as const,
  model: "claude-sonnet-4-20250514",
  endpoint_url: null,
  description: "Code Division Lead — architecture, dev, technical strategy",
};

describe("Agent Card Repository", () => {
  it("submits a card with pending status", () => {
    const card = submitCard(baseCard);
    expect(card.id).toMatch(/^acd_/);
    expect(card.approval_status).toBe("pending");
    expect(card.callsign).toBe("Gage");
    expect(card.primary_skills).toEqual(["code_review", "architecture", "typescript"]);
    expect(card.agent_id).toBeNull();
    expect(card.approved_by).toBeNull();
  });

  it("publishes agent.card.submitted event on submit", () => {
    const events: EventEnvelope[] = [];
    subscribe("agent.card.*", (e) => events.push(e));

    submitCard(baseCard);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("agent.card.submitted");
    expect(events[0].payload.callsign).toBe("Gage");
  });

  it("retrieves card by id", () => {
    const card = submitCard(baseCard);
    const retrieved = getCard(card.id);
    expect(retrieved).toEqual(card);
  });

  it("retrieves card by callsign", () => {
    submitCard(baseCard);
    const card = getCardByCallsign("Gage");
    expect(card).not.toBeNull();
    expect(card!.callsign).toBe("Gage");
  });

  it("lists cards with filters", () => {
    submitCard(baseCard);
    submitCard({ ...baseCard, callsign: "Mira", name: "Mira — Executive Assistant" });

    expect(listCards()).toHaveLength(2);
    expect(listCards({ callsign: "Gage" })).toHaveLength(1);
    expect(listCards({ approval_status: "pending" })).toHaveLength(2);
    expect(listCards({ approval_status: "approved" })).toHaveLength(0);
  });

  it("updates a pending card", () => {
    const card = submitCard(baseCard);
    const updated = updateCard(card.id, { description: "Updated description" });
    expect(updated).not.toBeNull();
    expect(updated!.description).toBe("Updated description");
    expect(updated!.callsign).toBe("Gage");
  });

  it("cannot update a non-pending card", () => {
    const card = submitCard(baseCard);
    approveCard(card.id, "director");

    const result = updateCard(card.id, { description: "Should fail" });
    expect(result).toBeNull();
  });

  it("approves a card and creates an agent", () => {
    const card = submitCard(baseCard);
    const approved = approveCard(card.id, "director");

    expect(approved).not.toBeNull();
    expect(approved!.approval_status).toBe("approved");
    expect(approved!.approved_by).toBe("director");
    expect(approved!.approved_at).toBeTruthy();
    expect(approved!.agent_id).toMatch(/^agt_/);

    // Verify agent was created
    const agent = getAgent(approved!.agent_id!);
    expect(agent).not.toBeNull();
    expect(agent!.callsign).toBe("Gage");
    expect(agent!.runtime).toBe("claude_api");
    expect(agent!.capabilities).toEqual(["code_review", "architecture", "typescript"]);
    expect(agent!.health_status).toBe("registered");
  });

  it("publishes agent.card.approved event", () => {
    const events: EventEnvelope[] = [];
    subscribe("agent.card.approved", (e) => events.push(e));

    const card = submitCard(baseCard);
    approveCard(card.id, "director");

    expect(events).toHaveLength(1);
    expect(events[0].payload.callsign).toBe("Gage");
    expect(events[0].payload.agent_id).toMatch(/^agt_/);
    expect(events[0].source.id).toBe("director");
  });

  it("cannot approve an already-rejected card", () => {
    const card = submitCard(baseCard);
    rejectCard(card.id, "Not ready");

    const result = approveCard(card.id, "director");
    expect(result).toBeNull();
  });

  it("cannot approve an already-approved card", () => {
    const card = submitCard(baseCard);
    approveCard(card.id, "director");

    const result = approveCard(card.id, "director");
    expect(result).toBeNull();
  });

  it("rejects a card with reason", () => {
    const card = submitCard(baseCard);
    const rejected = rejectCard(card.id, "Insufficient skills");

    expect(rejected).not.toBeNull();
    expect(rejected!.approval_status).toBe("rejected");
    expect(rejected!.rejection_reason).toBe("Insufficient skills");
  });

  it("publishes agent.card.rejected event", () => {
    const events: EventEnvelope[] = [];
    subscribe("agent.card.rejected", (e) => events.push(e));

    const card = submitCard(baseCard);
    rejectCard(card.id, "Not aligned");

    expect(events).toHaveLength(1);
    expect(events[0].payload.reason).toBe("Not aligned");
  });

  it("cannot reject a non-pending card", () => {
    const card = submitCard(baseCard);
    approveCard(card.id, "director");

    const result = rejectCard(card.id, "Too late");
    expect(result).toBeNull();
  });

  it("revokes an approved card and deregisters agent", () => {
    const card = submitCard(baseCard);
    const approved = approveCard(card.id, "director")!;
    const agentId = approved.agent_id!;

    const revoked = revokeCard(card.id);
    expect(revoked).not.toBeNull();
    expect(revoked!.approval_status).toBe("revoked");

    // Agent should be deregistered
    const agent = getAgent(agentId);
    expect(agent).not.toBeNull();
    expect(agent!.health_status).toBe("deregistered");
  });

  it("publishes agent.card.revoked event", () => {
    const events: EventEnvelope[] = [];
    subscribe("agent.card.revoked", (e) => events.push(e));

    const card = submitCard(baseCard);
    approveCard(card.id, "director");
    revokeCard(card.id);

    expect(events).toHaveLength(1);
    expect(events[0].payload.callsign).toBe("Gage");
  });

  it("cannot revoke a pending card", () => {
    const card = submitCard(baseCard);
    const result = revokeCard(card.id);
    expect(result).toBeNull();
  });

  it("handles duplicate callsigns as separate cards", () => {
    const card1 = submitCard(baseCard);
    const card2 = submitCard(baseCard);

    expect(card1.id).not.toBe(card2.id);
    expect(listCards({ callsign: "Gage" })).toHaveLength(2);

    // getCardByCallsign returns the most recent
    const latest = getCardByCallsign("Gage");
    expect(latest!.id).toBe(card2.id);
  });

  it("returns null for non-existent card", () => {
    expect(getCard("acd_nonexistent")).toBeNull();
    expect(getCardByCallsign("NoOne")).toBeNull();
  });

  it("filters by operator", () => {
    submitCard(baseCard);
    submitCard({ ...baseCard, callsign: "External", name: "External Agent", operator: "other-org" });

    expect(listCards({ operator: "SIT" })).toHaveLength(1);
    expect(listCards({ operator: "other-org" })).toHaveLength(1);
  });
});
