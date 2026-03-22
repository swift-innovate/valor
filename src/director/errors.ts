/**
 * VALOR Director Error Types
 *
 * Typed error classes for Director pipeline failures.
 * Enables specific error handling and recovery strategies.
 */

/**
 * Thrown when an LLM HTTP call times out.
 */
export class LlmTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`LLM timeout after ${timeoutMs}ms: ${url}`);
    this.name = "LlmTimeoutError";
  }
}

/**
 * Thrown when Ollama is unreachable (network error, connection refused).
 */
export class LlmNetworkError extends Error {
  constructor(
    public readonly url: string,
    public readonly cause: Error,
  ) {
    super(`Cannot reach Ollama at ${url}: ${cause.message}`);
    this.name = "LlmNetworkError";
  }
}

/**
 * Thrown when Ollama returns HTTP error (4xx, 5xx).
 */
export class LlmHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Ollama returned ${status}: ${body.slice(0, 200)}`);
    this.name = "LlmHttpError";
  }
}
