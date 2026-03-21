/**
 * VM-020: End-to-End Smoke Test
 *
 * Publishes a test mission to valor.missions.inbound and monitors
 * the pipeline: Director classify → dispatch → consumer pickup → sitrep.
 */

import {
  getNatsConnection,
  closeNatsConnection,
  subscribeComms,
} from "../src/nats/index.js";
import type { VALORMessage, NatsSitrep } from "../src/nats/index.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";

async function main(): Promise<void> {
  console.log("\n=== VM-020: Smoke Test ===\n");
  console.log(`NATS: ${NATS_URL}`);

  const nc = await getNatsConnection({ servers: [NATS_URL], name: "smoke-test" });

  // Subscribe to sitreps to watch the pipeline
  const sitreps: { subject: string; source: string; status: string; summary: string }[] = [];
  const sitrepSub = nc.subscribe("valor.sitreps.>", {
    callback: (_err, msg) => {
      try {
        const envelope = JSON.parse(new TextDecoder().decode(msg.data)) as VALORMessage<NatsSitrep>;
        const p = envelope.payload;
        const entry = {
          subject: msg.subject,
          source: envelope.source,
          status: p.status,
          summary: p.summary?.slice(0, 80) ?? "",
        };
        sitreps.push(entry);
        console.log(`  [sitrep] ${entry.source} → ${entry.status}: ${entry.summary}`);
      } catch { /* ignore non-sitrep */ }
    },
  });

  // Subscribe to mission subjects to watch dispatch
  const missionEvents: string[] = [];
  const missionSub = nc.subscribe("valor.missions.>", {
    callback: (_err, msg) => {
      missionEvents.push(msg.subject);
      console.log(`  [mission] ${msg.subject}`);
    },
  });

  // Publish inbound mission
  const missionText = "Debug the login timeout issue in the Telegram gateway";
  console.log(`\nPublishing: "${missionText}"\n`);

  const envelope: VALORMessage<{ text: string; source_channel: string; principal_id: string; context: null }> = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: "smoke-test",
    type: "mission.inbound" as any,
    payload: {
      text: missionText,
      source_channel: "cli",
      principal_id: "smoke-test",
      context: null,
    },
  };

  nc.publish("valor.missions.inbound", new TextEncoder().encode(JSON.stringify(envelope)));
  console.log("Mission published to valor.missions.inbound\n");
  const waitSec = parseInt(process.env.SMOKE_WAIT ?? "60", 10);
  console.log(`Waiting ${waitSec}s for pipeline to process...\n`);

  // Wait for the pipeline (LLM call can take 30-40s on cold start)
  await new Promise((r) => setTimeout(r, waitSec * 1000));

  // Report
  console.log("\n=== Results ===\n");
  console.log(`Mission events: ${missionEvents.length}`);
  for (const e of missionEvents) {
    console.log(`  ${e}`);
  }
  console.log(`\nSitreps: ${sitreps.length}`);
  for (const s of sitreps) {
    console.log(`  [${s.source}] ${s.status}: ${s.summary}`);
  }

  const hasDispatch = missionEvents.some((e) => e.includes(".pending"));
  const hasPickup = missionEvents.some((e) => e.includes(".active"));
  const hasComplete = missionEvents.some((e) => e.includes(".complete"));
  const hasSitrep = sitreps.length > 0;

  console.log("\n=== Checks ===\n");
  console.log(`  ${hasDispatch ? "✓" : "✗"} Mission dispatched to operative`);
  console.log(`  ${hasPickup ? "✓" : "✗"} Operative picked up mission`);
  console.log(`  ${hasSitrep ? "✓" : "✗"} Sitrep(s) published`);
  console.log(`  ${hasComplete ? "✓" : "✗"} Mission completed`);

  const passed = hasDispatch && hasPickup && hasSitrep && hasComplete;
  console.log(`\n=== ${passed ? "SMOKE TEST PASSED" : "SMOKE TEST INCOMPLETE"} ===\n`);

  sitrepSub.unsubscribe();
  missionSub.unsubscribe();
  await closeNatsConnection();

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
