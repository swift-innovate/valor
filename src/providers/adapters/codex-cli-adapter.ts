/**
 * Codex CLI provider adapter.
 *
 * Runs OpenAI's `codex exec` non-interactively as an inference backend,
 * authenticated by the user's ChatGPT subscription — no API key. Invocations
 * are read-only sandboxed, ephemeral (no session files), and run in a scratch
 * directory so the CLI never touches the VALOR repo.
 *
 * Output contract (verified against codex-cli 0.142.x, `--json` JSONL):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N,...}}
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

export interface CodexCliAdapterConfig {
  /** CLI binary. Default "codex" (resolved on PATH). */
  binPath?: string;
  /** Bare model names this adapter serves (registry routing). */
  models?: string[];
  /** Per-request timeout. Default 180s — CLI startup + reasoning is slow. */
  timeoutMs?: number;
  /** Dependency-injection seam for tests. */
  spawn?: SpawnFn;
}

const DEFAULT_TIMEOUT_MS = 180_000;
/** "codex" routes to the CLI's own configured default model (no -m flag). */
export const CODEX_DEFAULT_MODELS = ["codex", "gpt-5.2-codex", "gpt-5.2", "gpt-5.1-codex-max"];

interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
}

function parseCodexJsonl(stdout: string): { text: string; usage: CodexUsage } {
  const texts: string[] = [];
  let usage: CodexUsage = {};
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const e = event as {
      type?: string;
      item?: { type?: string; text?: string };
      usage?: CodexUsage;
    };
    if (e.type === "item.completed" && e.item?.type === "agent_message" && typeof e.item.text === "string") {
      texts.push(e.item.text);
    } else if (e.type === "turn.completed" && e.usage) {
      usage = e.usage;
    }
  }
  return { text: texts.join("\n"), usage };
}

export function createCodexCliAdapter(config: CodexCliAdapterConfig = {}): ProviderAdapter {
  const binPath = config.binPath ?? "codex";
  const models = config.models ?? [...CODEX_DEFAULT_MODELS];
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawn = config.spawn;

  // Scratch cwd — created lazily; --ephemeral keeps codex from persisting state.
  let workDir: string | undefined;
  function getWorkDir(): string {
    if (!workDir) {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "valor-codex-"));
    }
    return workDir;
  }

  const adapter: ProviderAdapter = {
    id: "codex_cli",
    name: "Codex CLI (subscription)",
    type: "openai_api" as ProviderType,
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      maxContextTokens: 200_000,
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
      const args = [
        "exec",
        "--json",
        "-s", "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "-C", getWorkDir(),
        // "codex" (or empty) → let the CLI use its configured default model
        ...(model && model !== "codex" ? ["-m", model] : []),
        "-", // read the prompt from stdin
      ];

      const prompt = flattenToPrompt(request.messages, request.system);
      const result = await runCli({ binPath, args, cwd: getWorkDir(), timeoutMs, stdin: prompt, spawn });

      if (result.timedOut) {
        throw new Error(`codex exec timed out after ${timeoutMs}ms`);
      }
      if (result.exitCode !== 0) {
        throw new Error(`codex exec exited with code ${result.exitCode}.${stderrTail(result.stderr)}`);
      }

      const parsed = parseCodexJsonl(result.stdout);
      if (!parsed.text) {
        throw new Error(`codex exec produced no agent message.${stderrTail(result.stderr)}`);
      }

      return {
        content: parsed.text,
        model: model || "codex",
        usage: {
          input_tokens: parsed.usage.input_tokens ?? 0,
          output_tokens: parsed.usage.output_tokens ?? 0,
        },
        stop_reason: "end_turn",
      };
    },

    async *stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
      // The CLI has no incremental output mode we consume; emit one completion.
      const sessionId = `codex_${nanoid(12)}`;
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

/** True when the codex CLI is installed and answers --version. */
export async function detectCodexCli(binPath = "codex", spawn?: SpawnFn): Promise<boolean> {
  try {
    const result = await runCli({ binPath, args: ["--version"], timeoutMs: 15_000, spawn });
    return result.exitCode === 0;
  } catch (err) {
    logger.debug("codex CLI not detected", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
