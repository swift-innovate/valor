/**
 * VM-008: NATS Validation Script
 *
 * Tests the full mission lifecycle against a live NATS server:
 * 1. Connect to NATS
 * 2. Create JetStream streams
 * 3. Create consumers
 * 4. Publish a test mission brief
 * 5. Consume the mission
 * 6. Publish a sitrep
 * 7. Consume the sitrep
 * 8. Publish a review submission and verdict
 * 9. Test ephemeral subjects (heartbeat, comms)
 * 10. Graceful shutdown
 */

import {
  getNatsConnection,
  closeNatsConnection,
  healthCheck,
  ensureStreams,
  ensureMissionConsumer,
  ensureSitrepConsumer,
  ensureReviewConsumer,
  publishMissionBrief,
  publishMissionPickup,
  publishSitrep,
  publishReviewSubmission,
  publishReviewVerdict,
  publishHeartbeat,
  publishCommsChannel,
  consumeMissions,
  consumeSitreps,
  consumeReviewVerdicts,
  subscribeHeartbeats,
  subscribeComms,
} from "../src/nats/index.js";

import type {
  MissionBrief,
  MissionPickup,
  NatsSitrep,
  ReviewSubmission,
  ReviewVerdict,
  Heartbeat,
  CommsPayload,
} from "../src/nats/index.js";

const OPERATIVE = "gage";
const MISSION_ID = "VM-TEST-001";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function main(): Promise<void> {
  console.log("\n=== VM-008: NATS Validation ===\n");

  // 1. Connect
  console.log("Step 1: Connect to NATS");
  const natsUrl = process.env.NATS_URL ?? "nats://localhost:4222";
  console.log(`  Server: ${natsUrl}`);
  const nc = await getNatsConnection({ servers: [natsUrl], name: "vm-008-validator" });
  assert(nc !== null, "Connected to NATS");

  const healthy = await healthCheck();
  assert(healthy, "Health check passed");

  // 2. Create streams
  console.log("\nStep 2: Create JetStream streams");
  await ensureStreams(nc);
  assert(true, "Streams created (MISSIONS, SITREPS, REVIEW, SYSTEM_EVENTS)");

  // 3. Create consumers
  console.log("\nStep 3: Create durable consumers");
  await ensureMissionConsumer(nc, OPERATIVE);
  assert(true, `Mission consumer created for ${OPERATIVE}`);
  await ensureSitrepConsumer(nc, "validator");
  assert(true, "Sitrep consumer created");
  await ensureReviewConsumer(nc, "validator");
  assert(true, "Review consumer created");

  // 4. Set up consumers BEFORE publishing (so messages are received)
  console.log("\nStep 4: Subscribe consumers");

  let missionReceived = false;
  let sitrepReceived = false;
  let verdictReceived = false;
  let heartbeatReceived = false;
  let commsReceived = false;

  // Mission consumer
  const missionMessages = await consumeMissions<MissionBrief>(nc, OPERATIVE, async (payload, _env, raw) => {
    assert(payload.mission_id === MISSION_ID, `Mission received: ${payload.mission_id}`);
    assert(payload.title === "NATS Validation Test Mission", `Title correct: ${payload.title}`);
    assert(payload.model_tier === "balanced", `model_tier aligned: ${payload.model_tier}`);
    missionReceived = true;
    raw.ack();
  });

  // Sitrep consumer
  const sitrepMessages = await consumeSitreps<NatsSitrep>(nc, "validator", async (payload, _env, raw) => {
    if (payload.mission_id === MISSION_ID) {
      assert(payload.status === "IN_PROGRESS", `Sitrep status: ${payload.status}`);
      assert(payload.progress_pct === 50, `Progress: ${payload.progress_pct}%`);
      sitrepReceived = true;
      raw.ack();
    }
  });

  // Review verdict consumer — REVIEW stream contains both submissions and verdicts.
  // Filter to only assert on verdict messages (which have a `decision` field).
  const verdictMessages = await consumeReviewVerdicts<ReviewVerdict>(nc, "validator", async (payload, env, raw) => {
    if (payload.mission_id === MISSION_ID && env.type === "review.verdict") {
      assert(payload.decision === "APPROVE", `Verdict: ${payload.decision}`);
      verdictReceived = true;
    }
    raw.ack();
  });

  // Ephemeral subscriptions
  const heartbeatSub = subscribeHeartbeats<Heartbeat>(nc, (payload) => {
    if (payload.operative === OPERATIVE) {
      assert(payload.status === "BUSY", `Heartbeat status: ${payload.status}`);
      heartbeatReceived = true;
    }
  });

  const commsSub = subscribeComms<CommsPayload>(nc, (payload) => {
    assert(payload.body.includes("Validation test"), `Comms received: ${payload.body.substring(0, 40)}`);
    commsReceived = true;
  }, "general");

  // Small delay for subscriptions to be active
  await sleep(500);

  // 5. Publish test mission
  console.log("\nStep 5: Publish mission brief");
  const brief: MissionBrief = {
    mission_id: MISSION_ID,
    title: "NATS Validation Test Mission",
    description: "End-to-end validation of VALOR NATS client module",
    priority: "P2",
    assigned_to: OPERATIVE,
    depends_on: [],
    parent_mission: null,
    model_tier: "balanced",
    acceptance_criteria: ["All message types publish and consume correctly"],
    context_refs: ["docs/nats-subjects.md"],
    deadline: null,
    created_at: new Date().toISOString(),
  };
  await publishMissionBrief(nc, "director", brief);
  assert(true, "Mission brief published");

  // 6. Publish mission pickup
  console.log("\nStep 6: Publish mission pickup");
  const pickup: MissionPickup = {
    mission_id: MISSION_ID,
    operative: OPERATIVE,
    acknowledged_at: new Date().toISOString(),
    estimated_completion: null,
    notes: "Validation in progress",
  };
  await publishMissionPickup(nc, OPERATIVE, pickup);
  assert(true, "Mission pickup published");

  // 7. Publish sitrep
  console.log("\nStep 7: Publish sitrep");
  const sitrep: NatsSitrep = {
    mission_id: MISSION_ID,
    operative: OPERATIVE,
    status: "IN_PROGRESS",
    progress_pct: 50,
    summary: "Validation halfway done",
    artifacts: [],
    blockers: [],
    next_steps: ["Complete remaining message types"],
    tokens_used: null,
    timestamp: new Date().toISOString(),
  };
  await publishSitrep(nc, OPERATIVE, sitrep);
  assert(true, "Sitrep published");

  // 8. Publish review submission + verdict
  console.log("\nStep 8: Publish review submission and verdict");
  const submission: ReviewSubmission = {
    mission_id: MISSION_ID,
    operative: OPERATIVE,
    completed_at: new Date().toISOString(),
    summary: "All NATS message types validated",
    artifacts: [{ type: "note", label: "Validation passed", ref: "All 4 streams + ephemeral subjects working" }],
    self_assessment: "Clean run, no issues",
  };
  await publishReviewSubmission(nc, OPERATIVE, submission);
  assert(true, "Review submission published");

  const verdict: ReviewVerdict = {
    mission_id: MISSION_ID,
    reviewer: "director",
    decision: "APPROVE",
    reasoning: "Validation script passed all checks",
    issues: [],
    instructions: null,
    escalation_target: null,
    reviewed_at: new Date().toISOString(),
  };
  await publishReviewVerdict(nc, "director", verdict);
  assert(true, "Review verdict published");

  // 9. Ephemeral: heartbeat + comms
  console.log("\nStep 9: Publish heartbeat and comms");
  const heartbeat: Heartbeat = {
    operative: OPERATIVE,
    status: "BUSY",
    current_mission: MISSION_ID,
    tick_interval_ms: 30000,
    uptime_ms: 120000,
    last_activity: new Date().toISOString(),
    metadata: null,
  };
  publishHeartbeat(nc, OPERATIVE, heartbeat);
  assert(true, "Heartbeat published");

  const comms: CommsPayload = {
    subject: "Validation Complete",
    body: "Validation test message on general channel",
    to: null,
    channel: "general",
    priority: "routine",
    category: "status_update",
    thread_id: null,
    in_reply_to: null,
  };
  await publishCommsChannel(nc, OPERATIVE, "general", comms);
  assert(true, "Comms message published");

  // Wait for consumers to process
  console.log("\nWaiting for consumers to process...");
  await sleep(3000);

  // 10. Check results
  console.log("\nStep 10: Verify consumption");
  assert(missionReceived, "Mission was consumed by pull consumer");
  assert(sitrepReceived, "Sitrep was consumed by pull consumer");
  assert(verdictReceived, "Review verdict was consumed by pull consumer");
  assert(heartbeatReceived, "Heartbeat was received on ephemeral subscription");
  assert(commsReceived, "Comms message was received on ephemeral subscription");

  // Cleanup subscriptions
  missionMessages.stop();
  sitrepMessages.stop();
  verdictMessages.stop();
  heartbeatSub.unsubscribe();
  commsSub.unsubscribe();

  // 11. Graceful shutdown
  console.log("\nStep 11: Graceful shutdown");
  await closeNatsConnection();
  assert(true, "NATS connection closed gracefully");

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
