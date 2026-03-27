/**
 * VALOR Director Service — CLI Entry Point
 *
 * Starts the Director service daemon using the standalone service module.
 * This is a thin wrapper — all logic lives in src/director/service.ts.
 *
 * Usage:
 *   OLLAMA_BASE_URL=http://starbase:40114 npx tsx scripts/director-service.ts
 *   DIRECTOR_SERVICE_PORT=3201 npx tsx scripts/director-service.ts
 */

import {
  startDirectorService,
  stopDirectorService,
} from "../src/director/service.js";
import { logger } from "../src/utils/logger.js";

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info("Director service received signal", { signal });
  await stopDirectorService();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startDirectorService().catch((err) => {
  logger.error("Director service fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
