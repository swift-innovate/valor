/**
 * Grok CLI provider adapter.
 *
 * Runs xAI's `grok` CLI headlessly as an inference backend, authenticated by
 * the user's Grok subscription — no API key. Web search is disabled so the
 * call is a pure completion, and the CLI runs in a scratch directory.
 *
 * Output contract (verified against grok 0.2.x, `--output-format json`):
 *   { "text": "...", "stopReason": "EndTurn", "sessionId": "...", ... }
 * Note: grok's JSON does not report token usage — usage is returned as zeros.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import type { StreamEvent } from "../../types/index.js";
import type {
  ProviderAdapter,
  ProviderHealth,
  ProviderRequest,
  ProviderResponse,
  ProviderType,
} from "../types.js";
import { flattenToPrompt, runCli, stderrTail, type SpawnFn } from "./cli-common.js";

export interface GrokCliAdapterConfig {
  /** CLI binary. Default "grok" (resolved on PATH). */
  binPath?: string;
  /** Bare model names this adapter serves (registry routing). */
  models?: string[];
  /** Per-request timeout. Default 180s. */
  timeoutMs?: number;
  /** Dependency-injection seam for tests. */
  spawn?: SpawnFn;
}

const DEFAULT_TIMEOUT_MS = 180_000;
/** "grok" routes to the CLI's own configured default model (no --model flag). */
// "grok-build" is the field-tested coding model (per the substrate conductor —
// the CLI default grok-composer-2.5-fast misbehaved on agentic work there).
export const GROK_DEFAULT_MODELS = ["grok", "grok-build", "grok-composer-2.5-fast", "grok-4", "grok-code"];

interface GrokJson {
  text?: string;
  stopReason?: string;
  sessionId?: string;
}

function parseGrokJson(stdout: string): GrokJson | undefined {
  // The result is a single JSON object; auth-worker noise may precede it on
  // some platforms, so parse from the first "{".
  const start = stdout.indexOf("{");
  if (start === -1) return undefined;
  try {
    return JSON.parse(stdout.slice(start)) as GrokJson;
  } catch {
    return undefined;
  }
}

export function createGrokCliAdapter(config: GrokCliAdapterConfig = {}): ProviderAdapter {
  const binPath = config.binPath ?? "grok";
  const models = config.models ?? [...GROK_DEFAULT_MODELS];
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawn = config.spawn;

  let workDir: string | undefined;
  function getWorkDir(): string {
    if (!workDir) {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "valor-grok-"));
    }
    return workDir;
  }

  const adapter: ProviderAdapter = {
    id: "grok_cli",
    name: "Grok CLI (subscription)",
    type: "custom" as ProviderType,
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      maxContextTokens: 128_000,
      models,
    },

    async healthCheck(): Promise<ProviderHealth> {
      const start = Date.now();
      try {
        const result = await runCli({ binPath, args: ["--version"], timeoutMs: 15_000, spawn });
        return {
          status: result.exitCode === 0 ? "healthy" : "unavailable",
          latency_ms: Date.now() - start,
          last_check: new Date().toISOString(),
          ...(result.exitCode === 0 ? {} : { details: { error: stderrTail(result.stderr) || `exit ${result.exitCode}` } }),
        };
      } catch (err) {
        return {
          status: "unavailable",
          latency_ms: Date.now() - start,
          last_check: new Date().toISOString(),
          details: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    },

    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      const model = request.model;
      // System prompt goes through the CLI's own flag; only messages are flattened.
      const prompt = flattenToPrompt(request.messages);
      const args = [
        "-p", prompt,
        "--output-format", "json",
        "--cwd", getWorkDir(),
        "--disable-web-search",
        // Pure completion: one turn, no agentic tool loop. Without this,
        // coding-tuned models (grok-build) try read_file in the empty scratch
        // dir, error out, and return no text.
        "--max-turns", "1",
        ...(request.system ? ["--system-prompt-override", request.system] : []),
        // "grok" (or empty) → let the CLI use its configured default model
        ...(model && model !== "grok" ? ["--model", model] : []),
      ];

      // grok takes the prompt as an argv element; under win32 shell mode the
      // cmd.exe command line caps at ~8K chars. Warn before it fails cryptically.
      if (process.platform === "win32" && prompt.length > 7_500) {
        logger.warn("grok prompt approaches the win32 command-line limit — consider trimming history", {
          prompt_chars: prompt.length,
        });
      }
      const result = await runCli({ binPath, args, cwd: getWorkDir(), timeoutMs, spawn });

      if (result.timedOut) {
        throw new Error(`grok timed out after ${timeoutMs}ms`);
      }
      // grok emits auth-worker noise to stderr even on success — trust exit
      // code + parsed JSON, not stderr.
      if (result.exitCode !== 0) {
        throw new Error(`grok exited with code ${result.exitCode}.${stderrTail(result.stderr)}`);
      }

      const parsed = parseGrokJson(result.stdout);
      if (!parsed?.text) {
        throw new Error(`grok exited 0 but returned no text.${stderrTail(result.stderr)}`);
      }

      return {
        content: parsed.text,
        model: model || "grok",
        usage: { input_tokens: 0, output_tokens: 0 }, // grok's JSON has no usage data
        stop_reason: "end_turn",
      };
    },

    async *stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
      const sessionId = `grok_${nanoid(12)}`;
      try {
        const response = await adapter.complete(request);
        yield {
          session_id: sessionId,
          sequence: 0,
          event_type: "token",
          data: { text: response.content },
          timestamp: new Date().toISOString(),
        };
        yield {
          session_id: sessionId,
          sequence: 1,
          event_type: "completion",
          data: { stop_reason: response.stop_reason, usage: response.usage },
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        yield {
          session_id: sessionId,
          sequence: 0,
          event_type: "error",
          data: { error: err instanceof Error ? err.message : String(err) },
          timestamp: new Date().toISOString(),
        };
      }
    },
  };

  return adapter;
}

/** True when the grok CLI is installed and answers --version. */
export async function detectGrokCli(binPath = "grok", spawn?: SpawnFn): Promise<boolean> {
  try {
    const result = await runCli({ binPath, args: ["--version"], timeoutMs: 15_000, spawn });
    return result.exitCode === 0;
  } catch (err) {
    logger.debug("grok CLI not detected", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
