/**
 * VALOR Director LLM Adapter
 *
 * Ollama HTTP adapter for local model inference.
 * Sends system prompt + mission text, expects structured JSON response.
 *
 * Includes timeout handling, typed errors, and retry support.
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { LlmTimeoutError, LlmNetworkError, LlmHttpError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  timeoutMs?: number; // Optional override for timeout
}

export interface LlmResponse {
  content: string;
  model: string;
  totalDurationMs: number;
  evalCount: number;
}

// ---------------------------------------------------------------------------
// Ollama HTTP client
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Call Ollama's /api/chat endpoint with the given prompt.
 * Returns the raw text response from the model.
 *
 * @throws {LlmTimeoutError} if request times out
 * @throws {LlmNetworkError} if Ollama is unreachable
 * @throws {LlmHttpError} if Ollama returns HTTP error
 */
export async function callOllama(request: LlmRequest): Promise<LlmResponse> {
  const baseUrl = config.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  const model = request.model ?? config.directorModel;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl}/api/chat`;

  logger.info("Director LLM call", { model, url, timeout_ms: timeoutMs });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const startMs = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        stream: false,
        format: "json",
        options: {
          temperature: 0.3,
          num_predict: 2048,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text();
      throw new LlmHttpError(url, res.status, body);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      model?: string;
      total_duration?: number;
      eval_count?: number;
    };

    const durationMs = Date.now() - startMs;
    const content = data.message?.content ?? "";

    logger.info("Director LLM response", {
      model: data.model ?? model,
      duration_ms: durationMs,
      eval_count: data.eval_count ?? 0,
      content_length: content.length,
    });

    return {
      content,
      model: data.model ?? model,
      totalDurationMs: durationMs,
      evalCount: data.eval_count ?? 0,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Timeout
    if (error instanceof Error && error.name === "AbortError") {
      throw new LlmTimeoutError(url, timeoutMs);
    }

    // Network errors (ECONNREFUSED, DNS failure, etc.)
    if (
      error instanceof TypeError &&
      error.message.includes("fetch failed")
    ) {
      throw new LlmNetworkError(url, error);
    }

    // HTTP errors (already thrown as LlmHttpError above)
    if (error instanceof LlmHttpError) {
      throw error;
    }

    // Unknown error — wrap and re-throw
    throw new Error(
      `Unexpected Ollama error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Call Gear 1 (default model — gemma3:27b).
 */
export async function callGear1(
  systemPrompt: string,
  userMessage: string,
  timeoutMs?: number,
): Promise<LlmResponse> {
  return callOllama({
    systemPrompt,
    userMessage,
    model: config.directorModel,
    timeoutMs,
  });
}

/**
 * Call Gear 2 (reasoning model — nemotron-cascade-2).
 */
export async function callGear2(
  systemPrompt: string,
  userMessage: string,
  timeoutMs?: number,
): Promise<LlmResponse> {
  return callOllama({
    systemPrompt,
    userMessage,
    model: config.directorGear2Model,
    timeoutMs,
  });
}
