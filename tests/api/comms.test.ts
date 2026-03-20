import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import { commsRoutes } from "../../src/api/comms.js";
import { createAgent } from "../../src/db/repositories/agent-repo.js";
import { createDivision } from "../../src/db/repositories/division-repo.js";
import type { EventEnvelope } from "../../src/types/index.js";

const app = new Hono();
app.route("/comms", commsRoutes);

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeAgent(callsign: string, divisionId?: string) {
  return createAgent({
    callsign,
    runtime: "claude_api",
    division_id: divisionId ?? null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "registered",
    last_heartbeat: null,
  });
}

function makeDivision(name: string) {
  return createDivision({
    name,
    lead_agent_id: null,
    namespace: name.toLowerCase(),
    autonomy_policy: {
      max_cost_autonomous_usd: 1.0,
      approval_required_actions: [],
      auto_dispatch_enabled: false,
    },
    escalation_policy: {
      escalate_to: "director",
      escalate_after_failures: 3,
      escalate_on_budget_breach: true,
    },
  });
}

function baseMsg(overrides = {}) {
  return {
    subject: "Test subject",
    body: "Test body",
    priority: "routine",
    category: "advisory",
    conversation_id: "conv_test123",
    in_reply_to: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Comms API", () => {
  describe("POST /comms/messages", () => {
    it("sends a message between two agents", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: mira.id,
        })),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as EventEnvelope;
      expect(data.type).toBe("comms.message");
      expect(data.source.id).toBe(gage.id);
      expect(data.target?.id).toBe(mira.id);
      expect(data.payload.subject).toBe("Test subject");
      expect(data.payload.category).toBe("advisory");
    });

    it("returns 400 for non-existent to_agent", async () => {
      const gage = makeAgent("Gage");

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: "agt_nonexistent",
        })),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("not found");
    });

    it("returns 400 for non-existent from_agent", async () => {
      const mira = makeAgent("Mira");

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: "agt_nonexistent",
          to_agent_id: mira.id,
        })),
      });

      expect(res.status).toBe(400);
    });

    it("publishes comms.message event on bus", async () => {
      const events: EventEnvelope[] = [];
      subscribe("comms.message", (e) => events.push(e));

      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: mira.id,
        })),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("comms.message");
    });

    it("flash priority publishes both comms.message and comms.message.flash", async () => {
      const flashEvents: EventEnvelope[] = [];
      const msgEvents: EventEnvelope[] = [];
      subscribe("comms.message", (e) => msgEvents.push(e));
      subscribe("comms.message.flash", (e) => flashEvents.push(e));

      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: mira.id,
          priority: "flash",
        })),
      });

      expect(msgEvents).toHaveLength(1);
      expect(flashEvents).toHaveLength(1);
      expect(flashEvents[0].type).toBe("comms.message.flash");
    });

    it("director can send messages", async () => {
      const mira = makeAgent("Mira");

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: "director",
          to_agent_id: mira.id,
          priority: "flash",
          category: "advisory",
        })),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as EventEnvelope;
      expect(data.source.type).toBe("director");
      expect(data.source.id).toBe("director");
    });

    it("can send to a division (broadcast)", async () => {
      const div = makeDivision("Code");
      const gage = makeAgent("Gage", div.id);

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: "director",
          to_division_id: div.id,
          to_agent_id: null,
          category: "advisory",
        })),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as EventEnvelope;
      expect(data.payload.to_division_id).toBe(div.id);
    });

    it("returns 400 if neither to_agent_id nor to_division_id provided", async () => {
      const gage = makeAgent("Gage");

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_agent_id: gage.id,
          subject: "Test",
          body: "Test body",
          priority: "routine",
          category: "advisory",
          conversation_id: "conv_test",
          in_reply_to: null,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid priority", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      const res = await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: mira.id,
          priority: "urgent_invalid",
        })),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /comms/conversations", () => {
    it("lists conversations with participants and message count", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const convId = "conv_abc123";

      // Send two messages in the same conversation
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: convId })),
      });
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: mira.id,
          to_agent_id: gage.id,
          conversation_id: convId,
          subject: "Re: Test subject",
          in_reply_to: null,
        })),
      });

      const res = await app.request("/comms/conversations");
      expect(res.status).toBe(200);
      const data = await res.json() as Array<{ conversation_id: string; message_count: number; participants: string[] }>;

      expect(data).toHaveLength(1);
      expect(data[0].conversation_id).toBe(convId);
      expect(data[0].message_count).toBe(2);
      expect(data[0].participants).toContain(gage.id);
      expect(data[0].participants).toContain(mira.id);
    });

    it("filters conversations by agent", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const zeke = makeAgent("Zeke");

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: "conv_1" })),
      });
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: mira.id, to_agent_id: zeke.id, conversation_id: "conv_2" })),
      });

      const res = await app.request(`/comms/conversations?agent_id=${zeke.id}`);
      const data = await res.json() as Array<{ conversation_id: string }>;

      expect(data).toHaveLength(1);
      expect(data[0].conversation_id).toBe("conv_2");
    });
  });

  describe("GET /comms/conversations/:id", () => {
    it("returns messages in chronological order", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const convId = "conv_thread1";

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: mira.id,
          conversation_id: convId,
          subject: "First",
        })),
      });
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: mira.id,
          to_agent_id: gage.id,
          conversation_id: convId,
          subject: "Second",
        })),
      });

      const res = await app.request(`/comms/conversations/${convId}`);
      const data = await res.json() as EventEnvelope[];

      expect(data).toHaveLength(2);
      // Chronological order
      expect(data[0].payload.subject).toBe("First");
      expect(data[1].payload.subject).toBe("Second");
    });

    it("filters by category", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const convId = "conv_cat";

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: convId, category: "request" })),
      });
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: mira.id, to_agent_id: gage.id, conversation_id: convId, category: "response" })),
      });

      const res = await app.request(`/comms/conversations/${convId}?category=request`);
      const data = await res.json() as EventEnvelope[];
      expect(data).toHaveLength(1);
      expect(data[0].payload.category).toBe("request");
    });
  });

  describe("GET /comms/agents/:id/inbox", () => {
    it("returns only messages targeted at that agent", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const zeke = makeAgent("Zeke");

      // Message to Mira
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: "conv_1" })),
      });
      // Message to Zeke
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: zeke.id, conversation_id: "conv_2" })),
      });

      const res = await app.request(`/comms/agents/${mira.id}/inbox`);
      const data = await res.json() as EventEnvelope[];
      expect(data).toHaveLength(1);
      expect(data[0].payload.to_agent_id).toBe(mira.id);
    });
  });

  describe("GET /comms/agents/:id/sent", () => {
    it("returns only messages from that agent", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const zeke = makeAgent("Zeke");

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: "conv_1" })),
      });
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: mira.id, to_agent_id: zeke.id, conversation_id: "conv_2" })),
      });

      const res = await app.request(`/comms/agents/${gage.id}/sent`);
      const data = await res.json() as EventEnvelope[];
      expect(data).toHaveLength(1);
      expect(data[0].payload.from_agent_id).toBe(gage.id);
    });
  });

  describe("Conversation thread creation event", () => {
    it("publishes comms.conversation.created on first message in a new thread", async () => {
      const events: EventEnvelope[] = [];
      subscribe("comms.conversation.created", (e) => events.push(e));

      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: gage.id,
          to_agent_id: mira.id,
          conversation_id: "conv_new1",
        })),
      });

      // Second message in same thread should NOT emit conversation.created again
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({
          from_agent_id: mira.id,
          to_agent_id: gage.id,
          conversation_id: "conv_new1",
        })),
      });

      expect(events).toHaveLength(1);
      expect(events[0].payload.conversation_id).toBe("conv_new1");
    });
  });

  describe("Filter by priority", () => {
    it("filters conversation messages by priority", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const convId = "conv_pri";

      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: convId, priority: "routine" })),
      });
      await app.request("/comms/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: convId, priority: "flash" })),
      });

      const res = await app.request(`/comms/conversations/${convId}?priority=flash`);
      const data = await res.json() as EventEnvelope[];
      expect(data).toHaveLength(1);
      expect(data[0].payload.priority).toBe("flash");
    });
  });

  describe("POST /comms/chats", () => {
    it("sends opening message to all participants in a 3-way chat", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const eddie = makeAgent("Eddie");

      const res = await app.request("/comms/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiated_by: "director",
          participants: [gage.id, mira.id, eddie.id],
          subject: "Q2 planning",
          body: "Let's align on Q2 goals.",
          priority: "routine",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as {
        conversation_id: string;
        participants: string[];
        opening_event_id: string;
      };
      expect(data.participants).toHaveLength(3);
      expect(data.opening_event_id).toBeDefined();

      // All three participants should have the message in their inbox
      const gageInbox = await app.request(`/comms/agents/${gage.id}/inbox`);
      const miraInbox = await app.request(`/comms/agents/${mira.id}/inbox`);
      const eddieInbox = await app.request(`/comms/agents/${eddie.id}/inbox`);

      const gageData = await gageInbox.json() as unknown[];
      const miraData = await miraInbox.json() as unknown[];
      const eddieData = await eddieInbox.json() as unknown[];

      expect(gageData).toHaveLength(1);
      expect(miraData).toHaveLength(1);
      expect(eddieData).toHaveLength(1);
    });

    it("includes participant roster in the message body", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      const res = await app.request("/comms/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiated_by: "director",
          participants: [gage.id, mira.id],
          subject: "Quick sync",
          body: "Sync up on the deployment.",
          priority: "routine",
        }),
      });

      expect(res.status).toBe(201);

      const inboxRes = await app.request(`/comms/agents/${gage.id}/inbox`);
      const [msg] = await inboxRes.json() as Array<{ payload: { body: string } }>;

      expect(msg.payload.body).toContain("Participants:");
      expect(msg.payload.body).toContain(gage.id);
      expect(msg.payload.body).toContain(mira.id);
    });

    it("returns 400 if participants list has fewer than 2", async () => {
      const gage = makeAgent("Gage");

      const res = await app.request("/comms/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiated_by: "director",
          participants: [gage.id],
          subject: "Solo chat",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 if subject is missing", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");

      const res = await app.request("/comms/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiated_by: "director",
          participants: [gage.id, mira.id],
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("Filter by limit", () => {
    it("limits conversation results", async () => {
      const gage = makeAgent("Gage");
      const mira = makeAgent("Mira");
      const convId = "conv_limit";

      for (let i = 0; i < 5; i++) {
        await app.request("/comms/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(baseMsg({ from_agent_id: gage.id, to_agent_id: mira.id, conversation_id: convId })),
        });
      }

      const res = await app.request(`/comms/conversations/${convId}?limit=3`);
      const data = await res.json() as EventEnvelope[];
      expect(data).toHaveLength(3);
    });
  });
});
