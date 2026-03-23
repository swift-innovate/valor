/**
 * Smoke test: Call Gear 1 with a simple mission and print the response.
 *
 * Usage:
 *   OLLAMA_BASE_URL=http://starbase:40114 node --import tsx scripts/test-director-llm.ts
 *
 * No NATS dependency — tests the LLM adapter directly.
 *
 * Mission: VM-030
 */
import { callGear1 } from "../src/director/llm-adapter.js";
import { buildRosterPromptSection } from "../src/director/roster.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptTemplate = readFileSync(
  resolve(__dirname, "../src/director/system-prompt.md"),
  "utf-8",
);

// Build prompt with live roster (empty roster if no agent cards registered)
const roster = buildRosterPromptSection();
const systemPrompt = promptTemplate.replace("{{OPERATIVE_ROSTER}}", roster);

console.log("System prompt length:", systemPrompt.length, "chars");
console.log("Roster section:", roster.slice(0, 200));
console.log("\nCalling Gear 1...\n");

const start = Date.now();
const response = await callGear1(
  systemPrompt,
  'Mission: "Check the ranch temperature sensors and report status"',
);

console.log("Duration:", Date.now() - start, "ms");
console.log("Model:", response.model);
console.log("Eval count:", response.evalCount);
console.log("\nRaw response:\n", response.content);

// Try parsing
try {
  const parsed = JSON.parse(response.content) as {
    decision?: string;
    confidence?: number;
    routing?: unknown;
  };
  console.log("\nParsed decision:", parsed.decision);
  console.log("Confidence:", parsed.confidence);
  console.log("Routing:", parsed.routing);
} catch {
  console.log("\n⚠️  Response is not valid JSON — classifier will attempt recovery");
}
