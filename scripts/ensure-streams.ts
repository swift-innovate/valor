/**
 * Ensure all VALOR JetStream streams exist.
 * Run once after starting NATS, or include in startup script.
 */

import { getNatsConnection, ensureStreams, closeNatsConnection } from "../src/nats/index.js";

async function main(): Promise<void> {
  const natsUrl = process.env.NATS_URL ?? "nats://localhost:4222";
  console.log(`Connecting to NATS at ${natsUrl}...`);

  const nc = await getNatsConnection({ servers: [natsUrl], name: "stream-setup" });
  await ensureStreams(nc);
  console.log("All JetStream streams ensured: MISSIONS, SITREPS, REVIEW, SYSTEM_EVENTS");

  await closeNatsConnection();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
