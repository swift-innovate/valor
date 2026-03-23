import { connect } from "@nats-io/transport-node";
import { jetstreamManager } from "@nats-io/jetstream";

async function main() {
  const nc = await connect({ servers: ["nats://localhost:4222"] });
  const jsm = await jetstreamManager(nc);

  for (const stream of ["MISSIONS", "SITREPS", "REVIEW", "SYSTEM_EVENTS"]) {
    try {
      await jsm.streams.purge(stream);
      console.log(`✓ Purged ${stream}`);
    } catch (e: any) {
      console.log(`✗ ${stream}: ${e.message}`);
    }
  }

  await nc.drain();
  console.log("Done.");
}

main().catch(console.error);
