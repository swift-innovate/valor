/**
 * VM-017: End-to-End Mission Lifecycle Integration Tests
 *
 * Validates the complete Phase 1 pipeline:
 * Mission text → safety gates → classifier → dispatcher → NATS → consumer → sitrep
 *
 * Requires: nats-server binary at infrastructure/bin/nats-server
 * Ollama is mocked at the module level via vi.mock.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { submitCard, approveCard } from "../../src/db/repositories/agent-card-repo.js";

// ---------------------------------------------------------------------------
// Mock the LLM adapter BEFORE any Director imports
// ---------------------------------------------------------------------------

let mockLlmCallCount = 0;
let mockLlmResponses: string[] = [];

vi.mock("../../src/director/llm-adapter.js", () => ({
  callOllama: vi.fn(async () => {
    mockLlmCallCount++;
    const content = mockLlmResponses[mockLlmCallCount - 1] ?? mockLlmResponses[0] ?? "{}";
    return {
      content,
      model: "mock-model",
      totalDurationMs: 100,
      evalCount: 50,
    };
  }),
  callGear1: vi.fn(async () => {
    mockLlmCallCount++;
    const content = mockLlmResponses[0] ?? "{}";
    return {
      content,
      model: "mock-gear1",
      totalDurationMs: 100,
      evalCount: 50,
    };
  }),
  callGear2: vi.fn(async () => {
    mockLlmCallCount++;
    const content = mockLlmResponses[1] ?? mockLlmResponses[0] ?? "{}";
    return {
      content,
      model: "mock-gear2",
      totalDurationMs: 200,
      evalCount: 100,
    };
  }),
}));

// NATS imports
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
  ensureMissionConsumer,
  ensureSitrepConsumer,
  ensureReviewConsumer,
  consumeMissions,
  consumeSitreps,
  consumeReviewVerdicts,
  publishMissionBrief,
  publishSitrep,
  publishMissionPickup,
  publishMissionComplete,
  publishReviewSubmission,
} from "../../src/nats/index.js";
import type {
  MissionBrief,
  NatsSitrep,
  ReviewSubmission,
} from "../../src/nats/index.js";

// Director imports
import { evaluateGates } from "../../src/director/safety-gates.js";
import { classifyMission } from "../../src/director/classifier.js";
import { dispatchMission, resetMissionCounter } from "../../src/director/dispatcher.js";
import { handleMission } from "../../src/director/index.js";

// JetStream imports for Test 5
import { jetstream, jetstreamManager, AckPolicy, DeliverPolicy } from "@nats-io/jetstream";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NATS_PORT = 24222;
const NATS_URL = `nats://localhost:${NATS_PORT}`;
const NATS_SERVER_BIN = resolve("infrastructure/bin/nats-server");

// ---------------------------------------------------------------------------
// Canned LLM responses
// ---------------------------------------------------------------------------

const RESPONSES = {
  simple_route: JSON.stringify({
    decision: "ROUTE",
    confidence: 9,
    reasoning: "Code debugging task, clear match for Forge.",
    routing: { operative: "forge", model_tier: "balanced", priority: "P2" },
  }),
  decompose: JSON.stringify({
    decision: "DECOMPOSE",
    confidence: 7,
    reasoning: "Multi-step campaign requiring research, content, and landing page.",
    decomposition: [
      {
        task_id: "VM-100-1", title: "Research target audience",
        description: "Identify audience segments", operative: "mira",
        model_tier: "balanced", depends_on: [], acceptance_criteria: "Research doc",
      },
      {
        task_id: "VM-100-2", title: "Draft email campaign",
        description: "Write email copy", operative: "eddie",
        model_tier: "balanced", depends_on: ["VM-100-1"], acceptance_criteria: "Email draft",
      },
      {
        task_id: "VM-100-3", title: "Build landing page",
        description: "Create landing page", operative: "forge",
        model_tier: "balanced", depends_on: ["VM-100-1"], acceptance_criteria: "Landing page",
      },
    ],
  }),
  low_confidence: JSON.stringify({
    decision: "ROUTE",
    confidence: 2,
    reasoning: "Ambiguous request.",
    routing: { operative: "mira", model_tier: "balanced", priority: "P2" },
  }),
  gear2_result: JSON.stringify({
    decision: "DECOMPOSE",
    confidence: 8,
    reasoning: "Complex cross-domain task after deeper analysis.",
    decomposition: [
      {
        task_id: "VM-200-1", title: "Audit system",
        description: "Review architecture", operative: "gage",
        model_tier: "frontier", depends_on: [], acceptance_criteria: "Audit doc",
      },
      {
        task_id: "VM-200-2", title: "Implement changes",
        description: "Apply improvements", operative: "forge",
        model_tier: "balanced", depends_on: ["VM-200-1"], acceptance_criteria: "PR",
      },
    ],
  }),
};

const SEEDED_AGENT_CARDS = [
  {
    callsign: "forge",
    name: "Forge — Code Operative",
    operator: "SIT",
    primary_skills: ["code_debugging", "typescript", "mission_dispatch"],
    runtime: "claude_api" as const,
    model: "claude-sonnet-4-20250514",
    endpoint_url: null,
    description: "Code operative for debugging, implementation, and mission execution.",
  },
  {
    callsign: "mira",
    name: "Mira — Research and Coordination",
    operator: "SIT",
    primary_skills: ["research", "coordination", "documentation"],
    runtime: "openclaw" as const,
    model: null,
    endpoint_url: null,
    description: "Chief of Staff responsible for research, coordination, and cross-domain planning.",
  },
  {
    callsign: "eddie",
    name: "Eddie — Content and Campaigns",
    operator: "SIT",
    primary_skills: ["content", "campaigns", "planning"],
    runtime: "openclaw" as const,
    model: null,
    endpoint_url: null,
    description: "SIT operative for content drafting, campaigns, and planning artifacts.",
  },
  {
    callsign: "gage",
    name: "Gage — Architecture and Review",
    operator: "SIT",
    primary_skills: ["architecture", "code_review", "system_design"],
    runtime: "claude_api" as const,
    model: "claude-sonnet-4-20250514",
    endpoint_url: null,
    description: "Code division lead for architecture, review, and strategic technical decisions.",
  },
] as const;

function seedApprovedOperatives(): void {
  for (const card of SEEDED_AGENT_CARDS) {
    const submitted = submitCard(card);
    const approved = approveCard(submitted.id, "director");
    expect(approved?.approval_status).toBe("approved");
  }
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let natsProcess: ChildProcess | null = null;

async function startNatsServer(): Promise<void> {
  if (!existsSync(NATS_SERVER_BIN)) {
    throw new Error(`nats-server not found at ${NATS_SERVER_BIN}`);
  }

  const dataDir = `/tmp/valor-e2e-test-${Date.now()}`;

  natsProcess = spawn(NATS_SERVER_BIN, [
    "-p", String(NATS_PORT), "-js", "-sd", dataDir,
  ], { stdio: "pipe" });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("NATS server startup timeout")), 10000);
    natsProcess!.stderr!.on("data", (data: Buffer) => {
      if (data.toString().includes("Server is ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    natsProcess!.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("E2E Mission Lifecycle (VM-017)", () => {
  beforeAll(async () => {
    await startNatsServer();
    freshDb();
    seedApprovedOperatives();
    const nc = await getNatsConnection({ servers: [NATS_URL], name: "e2e-test" });
    await ensureStreams(nc);
  }, 30000);

  afterAll(async () => {
    await closeNatsConnection();
    cleanupDb();
    if (natsProcess) { natsProcess.kill("SIGTERM"); natsProcess = null; }
  }, 15000);

  beforeEach(() => {
    mockLlmCallCount = 0;
    mockLlmResponses = [];
    resetMissionCounter();
  });

  // =========================================================================
  // Test 1: Simple Route (Happy Path)
  // =========================================================================
  describe("Test 1: Simple Route (Happy Path)", () => {
    it("routes a debug task to Forge, consumer picks up and completes", async () => {
      const nc = await getNatsConnection({ servers: [NATS_URL] });
      mockLlmResponses = [RESPONSES.simple_route];

      await ensureMissionConsumer(nc, "forge");

      let missionReceived: MissionBrief | null = null;
      let pickupPublished = false;
      let sitrepReceived = false;
      let reviewReceived = false;

      // Forge consumer — simulates operative
      const forgeConsumer = await consumeMissions<MissionBrief>(nc, "forge", async (payload, _env, raw) => {
        missionReceived = payload;
        raw.ack();
        pickupPublished = true;

        await publishMissionPickup(nc, "forge", {
          mission_id: payload.mission_id, operative: "forge",
          acknowledged_at: new Date().toISOString(), estimated_completion: null, notes: null,
        });

        await publishSitrep(nc, "forge", {
          mission_id: payload.mission_id, operative: "forge", status: "IN_PROGRESS",
          progress_pct: 50, summary: "Debugging", artifacts: [], blockers: [],
          next_steps: ["Fix"], tokens_used: null, timestamp: new Date().toISOString(),
        });

        await publishMissionComplete(nc, "forge", "forge", {
          mission_id: payload.mission_id, operative: "forge", status: "COMPLETE",
          progress_pct: 100, summary: "Fixed", artifacts: [{ type: "branch", label: "fix", ref: "fix/login-timeout" }],
          blockers: [], next_steps: [], tokens_used: null, timestamp: new Date().toISOString(),
        });

        await publishReviewSubmission(nc, "forge", {
          mission_id: payload.mission_id, operative: "forge",
          completed_at: new Date().toISOString(), summary: "Fixed",
          artifacts: [{ type: "branch", label: "fix", ref: "fix/login-timeout" }],
          self_assessment: "Clean fix",
        });
      });

      // Sitrep consumer
      await ensureSitrepConsumer(nc, "e2e-sitrep-t1");
      const sitrepConsumer = await consumeSitreps<NatsSitrep>(nc, "e2e-sitrep-t1", async (payload, _env, raw) => {
        if (payload.status === "IN_PROGRESS" || payload.status === "COMPLETE") sitrepReceived = true;
        raw.ack();
      });

      // Review consumer
      await ensureReviewConsumer(nc, "e2e-review-t1");
      const reviewConsumer = await consumeReviewVerdicts<ReviewSubmission>(nc, "e2e-review-t1", async (_p, _e, raw) => {
        reviewReceived = true;
        raw.ack();
      });

      // Verify safety gates pass
      const gateResult = evaluateGates("Debug the login timeout issue in the Telegram gateway");
      expect(gateResult.passed).toBe(true);

      // Run Director pipeline
      const result = await handleMission(nc, "Debug the login timeout issue in the Telegram gateway", "VM-E2E-001");

      expect(result.classifier.gateIntercepted).toBe(false);
      expect(result.classifier.directorOutput!.decision).toBe("ROUTE");
      expect(result.classifier.directorOutput!.routing?.operative).toBe("forge");
      expect(result.dispatch.dispatched).toBe(true);
      expect(result.dispatch.missionIds.length).toBe(1);
      expect(mockLlmCallCount).toBe(1); // Only Gear 1

      await sleep(2000);

      expect(missionReceived).not.toBeNull();
      expect(missionReceived!.assigned_to).toBe("forge");
      expect(pickupPublished).toBe(true);
      expect(sitrepReceived).toBe(true);
      expect(reviewReceived).toBe(true);

      forgeConsumer.stop();
      sitrepConsumer.stop();
      reviewConsumer.stop();
    }, 15000);
  });

  // =========================================================================
  // Test 2: Safety Gate Intercept
  // =========================================================================
  describe("Test 2: Safety Gate Intercept", () => {
    it("intercepts financial transactions without calling LLM", async () => {
      const nc = await getNatsConnection({ servers: [NATS_URL] });
      const missionText = "Transfer $200 from checking to cover the feed bill";

      // Gate fires
      const gateResult = evaluateGates(missionText);
      expect(gateResult.passed).toBe(false);
      expect(gateResult.intercept!.matched_gate).toBe("P0");

      // Track dispatches
      let missionPublished = false;
      await ensureMissionConsumer(nc, "herbie");
      const herbieConsumer = await consumeMissions<MissionBrief>(nc, "herbie", async (_p, _e, raw) => {
        missionPublished = true;
        raw.ack();
      });

      // Run pipeline
      const result = await handleMission(nc, missionText, "VM-E2E-002");

      expect(result.classifier.gateIntercepted).toBe(true);
      expect(result.classifier.intercept!.matched_gate).toBe("P0");
      expect(result.classifier.directorOutput).toBeNull();
      expect(mockLlmCallCount).toBe(0); // LLM never called
      expect(result.dispatch.escalated).toBe(true);
      expect(result.dispatch.dispatched).toBe(false);
      expect(result.dispatch.escalationMessage).toContain("SAFETY GATE");

      await sleep(1000);
      expect(missionPublished).toBe(false);

      herbieConsumer.stop();
    }, 10000);
  });

  // =========================================================================
  // Test 3: Complex Decomposition
  // =========================================================================
  describe("Test 3: Complex Decomposition", () => {
    it("decomposes a multi-step mission with correct dependency ordering", async () => {
      const nc = await getNatsConnection({ servers: [NATS_URL] });
      mockLlmResponses = [RESPONSES.decompose];

      const missionText = "Launch the Fracture Code marketing campaign — email, ads, and landing page";
      expect(evaluateGates(missionText).passed).toBe(true);

      await ensureMissionConsumer(nc, "mira");
      await ensureMissionConsumer(nc, "eddie");
      await ensureMissionConsumer(nc, "forge");

      const received: MissionBrief[] = [];

      const miraC = await consumeMissions<MissionBrief>(nc, "mira", async (p, _e, raw) => { received.push(p); raw.ack(); });
      const eddieC = await consumeMissions<MissionBrief>(nc, "eddie", async (p, _e, raw) => { received.push(p); raw.ack(); });
      const forgeC = await consumeMissions<MissionBrief>(nc, "forge", async (p, _e, raw) => { received.push(p); raw.ack(); });

      const result = await handleMission(nc, missionText, "VM-E2E-003");

      expect(result.classifier.directorOutput!.decision).toBe("DECOMPOSE");
      expect(result.dispatch.dispatched).toBe(true);
      expect(result.dispatch.missionIds.length).toBe(3);

      await sleep(2000);

      expect(received.length).toBe(3);

      const miraTask = received.find((m) => m.assigned_to === "mira");
      const eddieTask = received.find((m) => m.assigned_to === "eddie");
      const forgeTask = received.find((m) => m.assigned_to === "forge");

      expect(miraTask).toBeDefined();
      expect(eddieTask).toBeDefined();
      expect(forgeTask).toBeDefined();

      // Mira has no deps, Eddie and Forge depend on Mira
      expect(miraTask!.depends_on).toEqual([]);
      expect(eddieTask!.depends_on).toContain(miraTask!.mission_id);
      expect(forgeTask!.depends_on).toContain(miraTask!.mission_id);
      expect(eddieTask!.parent_mission).toBe("VM-E2E-003");

      miraC.stop(); eddieC.stop(); forgeC.stop();
    }, 15000);
  });

  // =========================================================================
  // Test 4: Gear Escalation (Gear 1 → Gear 2)
  // =========================================================================
  describe("Test 4: Gear Escalation", () => {
    it("escalates to Gear 2 when Gear 1 confidence is below threshold", async () => {
      const nc = await getNatsConnection({ servers: [NATS_URL] });
      // Gear 1 returns low confidence, Gear 2 returns high confidence
      mockLlmResponses = [RESPONSES.low_confidence, RESPONSES.gear2_result];

      const missionText = "Redesign the entire monitoring pipeline with new alerting and cross-division dashboards";

      const classResult = await classifyMission(missionText);

      // Both gears called
      expect(mockLlmCallCount).toBe(2);

      // Final result from Gear 2
      expect(classResult.gear).toBe(2);
      expect(classResult.directorOutput!.decision).toBe("DECOMPOSE");
      expect(classResult.directorOutput!.confidence).toBe(8);
      expect(classResult.directorOutput!.decomposition!.length).toBe(2);

      // Dispatch and verify
      resetMissionCounter();
      const dispResult = await dispatchMission(nc, classResult, "VM-E2E-004", missionText);
      expect(dispResult.dispatched).toBe(true);
      expect(dispResult.missionIds.length).toBe(2);
    }, 15000);
  });

  // =========================================================================
  // Test 5: Consumer Failure Recovery (JetStream Redelivery)
  // =========================================================================
  describe("Test 5: Consumer Failure Recovery", () => {
    it("redelivers unacknowledged messages up to max_deliver", async () => {
      const nc = await getNatsConnection({ servers: [NATS_URL] });
      const jsm = await jetstreamManager(nc);
      const js = jetstream(nc);

      const consumerName = "mission-consumer-zeke-redelivery";
      try { await jsm.consumers.delete("MISSIONS", consumerName); } catch { /* ok */ }

      await jsm.consumers.add("MISSIONS", {
        durable_name: consumerName,
        filter_subject: "valor.missions.zeke.pending",
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        max_deliver: 3,
        ack_wait: 2_000_000_000 as unknown as import("@nats-io/nats-core").Nanos, // 2s
      });

      // Publish mission for Zeke
      await publishMissionBrief(nc, "director", {
        mission_id: "VM-REDELIVER", title: "Check barn sensors",
        description: "Redelivery test", priority: "P2", assigned_to: "zeke",
        depends_on: [], parent_mission: null, model_tier: "local",
        acceptance_criteria: ["Sensors checked"], context_refs: [],
        deadline: null, created_at: new Date().toISOString(),
      });

      let deliveryCount = 0;
      const consumer = await js.consumers.get("MISSIONS", consumerName);
      const messages = await consumer.consume();

      await Promise.race([
        (async () => {
          for await (const msg of messages) {
            deliveryCount++;
            if (deliveryCount < 3) {
              msg.nak();
            } else {
              msg.ack();
              messages.stop();
              break;
            }
          }
        })(),
        sleep(15000),
      ]);

      expect(deliveryCount).toBeGreaterThanOrEqual(2);
      expect(deliveryCount).toBeLessThanOrEqual(3);

      try { await jsm.consumers.delete("MISSIONS", consumerName); } catch { /* ok */ }
    }, 20000);
  });
});
