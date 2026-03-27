import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, publish } from "../../src/bus/index.js";
import { createMission } from "../../src/db/repositories/index.js";
import {
  startNotifications,
  stopNotifications,
  _getQueueLength,
  _flushForTest,
} from "../../src/telegram/notifications.js";
import type { Bot } from "grammy";

function makeMockBot(): Bot & { sentMessages: Array<{ chatId: string; text: string; opts?: unknown }> } {
  const sentMessages: Array<{ chatId: string; text: string; opts?: unknown }> = [];
  return {
    api: {
      sendMessage: vi.fn(async (chatId: string, text: string, opts?: unknown) => {
        sentMessages.push({ chatId, text, opts });
      }),
    },
    sentMessages,
  } as unknown as Bot & { sentMessages: Array<{ chatId: string; text: string; opts?: unknown }> };
}

const TEST_CHAT_ID = "12345";

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  stopNotifications();
  clearSubscriptions();
  cleanupDb();
});

describe("notification subscriptions", () => {
  it("sends urgent notification immediately on mission failure", async () => {
    const bot = makeMockBot();
    startNotifications(bot, TEST_CHAT_ID);

    const mission = createMission({
      division_id: null,
      title: "Will fail",
      objective: "This will fail",
      status: "streaming",
      phase: "V",
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      initiative_id: null,
      dispatched_at: new Date().toISOString(),
      completed_at: null,
    });

    publish({
      type: "mission.status.changed",
      source: { id: "system", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: mission.id, new_status: "failed", reason: "Timeout" },
      metadata: null,
    });

    // Wait a tick for async send
    await vi.waitFor(() => {
      expect(bot.sentMessages.length).toBe(1);
    });

    expect(bot.sentMessages[0].text).toContain("Mission Failed");
    expect(bot.sentMessages[0].text).toContain("Will fail");
    expect(bot.sentMessages[0].chatId).toBe(TEST_CHAT_ID);
  });

  it("queues non-urgent notifications (complete)", () => {
    const bot = makeMockBot();
    startNotifications(bot, TEST_CHAT_ID);

    const mission = createMission({
      division_id: null,
      title: "Will complete",
      objective: "This will complete",
      status: "streaming",
      phase: "V",
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      initiative_id: null,
      dispatched_at: new Date().toISOString(),
      completed_at: null,
    });

    publish({
      type: "mission.status.changed",
      source: { id: "system", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: mission.id, new_status: "complete" },
      metadata: null,
    });

    // Should be queued, not sent immediately
    expect(bot.sentMessages.length).toBe(0);
    expect(_getQueueLength()).toBe(1);
  });

  it("flushes queued notifications on flush", async () => {
    const bot = makeMockBot();
    startNotifications(bot, TEST_CHAT_ID);

    const mission = createMission({
      division_id: null,
      title: "Queued notification",
      objective: "Test batch",
      status: "streaming",
      phase: "V",
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      initiative_id: null,
      dispatched_at: new Date().toISOString(),
      completed_at: null,
    });

    publish({
      type: "mission.status.changed",
      source: { id: "system", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: mission.id, new_status: "complete" },
      metadata: null,
    });

    expect(_getQueueLength()).toBe(1);

    _flushForTest(bot, TEST_CHAT_ID);

    await vi.waitFor(() => {
      expect(bot.sentMessages.length).toBe(1);
    });

    expect(_getQueueLength()).toBe(0);
    expect(bot.sentMessages[0].text).toContain("Mission Complete");
  });

  it("skips events with via=telegram metadata to prevent echo", () => {
    const bot = makeMockBot();
    startNotifications(bot, TEST_CHAT_ID);

    const mission = createMission({
      division_id: null,
      title: "Echo test",
      objective: "Should not echo",
      status: "streaming",
      phase: "V",
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      initiative_id: null,
      dispatched_at: new Date().toISOString(),
      completed_at: null,
    });

    publish({
      type: "mission.status.changed",
      source: { id: "director", type: "director" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: { mission_id: mission.id, new_status: "failed" },
      metadata: { via: "telegram" },
    });

    // Should not send — came from telegram
    expect(bot.sentMessages.length).toBe(0);
    expect(_getQueueLength()).toBe(0);
  });

  it("handles approval request events", async () => {
    const bot = makeMockBot();
    startNotifications(bot, TEST_CHAT_ID);

    const mission = createMission({
      division_id: null,
      title: "Needs approval",
      objective: "Gate check",
      status: "gated",
      phase: "V",
      assigned_agent_id: null,
      priority: "normal",
      constraints: [],
      deliverables: [],
      success_criteria: [],
      token_usage: null,
      cost_usd: 0,
      revision_count: 0,
      max_revisions: 3,
      parent_mission_id: null,
      initiative_id: null,
      dispatched_at: null,
      completed_at: null,
    });

    publish({
      type: "gate.approval_requested",
      source: { id: "system", type: "system" },
      target: null,
      conversation_id: null,
      in_reply_to: null,
      payload: {
        mission_id: mission.id,
        approval: {
          id: "apr_test",
          mission_id: mission.id,
          gate: "director_review",
          requested_by: "agt_test",
          status: "pending",
          resolved_by: null,
          reason: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
          expires_at: null,
        },
      },
      metadata: null,
    });

    await vi.waitFor(() => {
      expect(bot.sentMessages.length).toBe(1);
    });

    expect(bot.sentMessages[0].text).toContain("Approval Required");
    expect(bot.sentMessages[0].text).toContain("director\\_review");
  });
});
