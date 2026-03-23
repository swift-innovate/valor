/**
 * Inject a mission directly into the Director's NATS subject.
 *
 * Usage:
 *   node --import tsx scripts/inject-mission.ts "Check ranch sensors"
 *   node --import tsx scripts/inject-mission.ts  # uses default mission text
 *
 * Requires: NATS running at NATS_URL (default nats://localhost:4222)
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
const missionText =
  process.argv[2] ?? "Check the ranch temperature sensors and report status";

logger.info("Connecting to NATS", { url: NATS_URL });
const nc = await getNatsConnection({ servers: [NATS_URL], name: "injector" });
await ensureStreams(nc);

const envelope = {
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  source: "test-injector",
  type: "mission.inbound",
  payload: {
    text: missionText,
    source_channel: "cli",
    principal_id: "director",
  },
};

nc.publish(
  "valor.missions.inbound",
  new TextEncoder().encode(JSON.stringify(envelope)),
);

logger.info("Mission injected", { text: missionText, id: envelope.id });
console.log(`✅ Mission injected: "${missionText}"`);

// Give NATS time to flush before closing
await new Promise((r) => setTimeout(r, 1000));
await closeNatsConnection();
