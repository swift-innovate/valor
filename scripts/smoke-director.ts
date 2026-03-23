/**
 * Smoke test: Inject a safe mission, wait for a sitrep, verify Director is alive.
 *
 * Usage:
 *   node --import tsx scripts/smoke-director.ts
 *
 * Requires: Director service + NATS running.
 * Exits 0 on success (sitrep received within 90s), 1 on timeout.
 *
 * Mission: VM-030
 */
import {
  getNatsConnection,
  closeNatsConnection,
  ensureStreams,
} from "../src/nats/index.js";
import { logger } from "../src/utils/logger.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const TIMEOUT_MS = 90_000;

logger.info("Smoke test starting", { nats: NATS_URL, timeout_ms: TIMEOUT_MS });

const nc = await getNatsConnection({ servers: [NATS_URL], name: "smoke" });
await ensureStreams(nc);

let sitrepReceived = false;

// Subscribe to Director sitreps
const sub = nc.subscribe("valor.sitreps.director", {
  callback: (_err, msg) => {
    const text = new TextDecoder().decode(msg.data);
    console.log("\n📋 Sitrep received:", text.slice(0, 200));
    sitrepReceived = true;
  },
});

// Inject a safe test mission
const envelope = {
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  source: "smoke-test",
  type: "mission.inbound",
  payload: {
    text: "Check system health and report status",
    source_channel: "smoke",
    principal_id: "director",
  },
};

nc.publish(
  "valor.missions.inbound",
  new TextEncoder().encode(JSON.stringify(envelope)),
);

logger.info("Smoke mission injected", { id: envelope.id });
console.log("✅ Smoke mission injected — waiting up to 90s for sitrep...");

// Poll until sitrep arrives or deadline passes
const deadline = Date.now() + TIMEOUT_MS;
while (!sitrepReceived && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
}

sub.unsubscribe();
await closeNatsConnection();

if (sitrepReceived) {
  console.log("\n\n✅ SMOKE TEST PASSED — Director is processing missions");
  process.exit(0);
} else {
  console.log("\n\n❌ SMOKE TEST FAILED — No sitrep received within 90s");
  console.log("Check: Is director-service.ts running? Is Ollama reachable?");
  process.exit(1);
}
