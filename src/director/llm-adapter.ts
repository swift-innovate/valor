/**
 * VALOR Director LLM Adapter
 *
 * Ollama HTTP adapter for local model inference.
 * Sends system prompt + mission text, expects structured JSON response.
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  model?: string;
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

const DEFAULT_OLLAMA_URL = "http://starbase:40114";

/**
 * Call Ollama's /api/chat endpoint with the given prompt.
 * Returns the raw text response from the model.
 */
export async function callOllama(request: LlmRequest): Promise<LlmResponse> {
  const baseUrl = config.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  const model = request.model ?? config.directorModel;
  const url = `${baseUrl}/api/chat`;

  logger.info("Director LLM call", { model, url });

  const startMs = Date.now();

  const TIMEOUT_MS = 60_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
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
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Ollama request timed out after ${TIMEOUT_MS}ms (model: ${model})`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama returned ${res.status}: ${body}`);
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
}

/**
 * Call Gear 1 (default model — gemma3:27b).
 */
export async function callGear1(
  systemPrompt: string,
  userMessage: string,
): Promise<LlmResponse> {
  return callOllama({
    systemPrompt,
    userMessage,
    model: config.directorModel,
  });
}

/**
 * Call Gear 2 (reasoning model — nemotron-cascade-2).
 */
export async function callGear2(
  systemPrompt: string,
  userMessage: string,
): Promise<LlmResponse> {
  return callOllama({
    systemPrompt,
    userMessage,
    model: config.directorGear2Model,
  });
}
