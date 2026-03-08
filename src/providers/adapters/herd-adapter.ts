import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import type { StreamEvent } from "../../types/index.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRequest,
  ProviderResponse,
  ProviderType,
} from "../types.js";

export interface HerdAdapterConfig {
  baseUrl: string;       // e.g., "http://localhost:40114"
  statusUrl?: string;    // e.g., "http://localhost:40120/status"
}

export function createHerdAdapter(config: HerdAdapterConfig): ProviderAdapter {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const statusUrl = config.statusUrl ?? `${baseUrl}/status`;

  const adapter: ProviderAdapter = {
    id: "herd",
    name: "Herd (Ollama Proxy)",
    type: "herd" as ProviderType,
    capabilities: {
      streaming: true,
      toolUse: false,
      vision: false,
      maxContextTokens: 128000,
      models: [], // Populated dynamically via health check
    },

    async healthCheck(): Promise<ProviderHealth> {
      const start = Date.now();
      try {
        const res = await fetch(statusUrl, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          return {
            status: "degraded",
            latency_ms: Date.now() - start,
            last_check: new Date().toISOString(),
            details: { http_status: res.status },
          };
        }
        const data = await res.json() as Record<string, unknown>;
        return {
          status: "healthy",
          latency_ms: Date.now() - start,
          last_check: new Date().toISOString(),
          details: data,
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

    async *stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
      const sessionId = `hrd_${nanoid(21)}`;
      let sequence = 0;

      try {
        // Herd proxies to Ollama's /api/chat endpoint
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
            options: {
              temperature: request.temperature,
              num_predict: request.max_tokens,
            },
          }),
        });

        if (!res.ok || !res.body) {
          yield {
            session_id: sessionId,
            sequence: sequence++,
            event_type: "error",
            data: { error: `Herd returned HTTP ${res.status}` },
            timestamp: new Date().toISOString(),
          };
          return;
        }

        // Emit initial heartbeat
        yield {
          session_id: sessionId,
          sequence: sequence++,
          event_type: "heartbeat",
          data: { model: request.model },
          timestamp: new Date().toISOString(),
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line) as {
                message?: { content?: string };
                done?: boolean;
                eval_count?: number;
                prompt_eval_count?: number;
              };

              if (chunk.done) {
                yield {
                  session_id: sessionId,
                  sequence: sequence++,
                  event_type: "completion",
                  data: {
                    stop_reason: "end_turn",
                    usage: {
                      input_tokens: chunk.prompt_eval_count ?? 0,
                      output_tokens: chunk.eval_count ?? 0,
                    },
                  },
                  timestamp: new Date().toISOString(),
                };
              } else if (chunk.message?.content) {
                yield {
                  session_id: sessionId,
                  sequence: sequence++,
                  event_type: "token",
                  data: { text: chunk.message.content },
                  timestamp: new Date().toISOString(),
                };
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        yield {
          session_id: sessionId,
          sequence: sequence++,
          event_type: "error",
          data: { error: err instanceof Error ? err.message : String(err) },
          timestamp: new Date().toISOString(),
        };
      }
    },

    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          options: {
            temperature: request.temperature,
            num_predict: request.max_tokens,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Herd returned HTTP ${res.status}`);
      }

      const data = await res.json() as {
        message?: { content?: string };
        model?: string;
        eval_count?: number;
        prompt_eval_count?: number;
      };

      return {
        content: data.message?.content ?? "",
        model: data.model ?? request.model,
        usage: {
          input_tokens: data.prompt_eval_count ?? 0,
          output_tokens: data.eval_count ?? 0,
        },
        stop_reason: "end_turn",
      };
    },
  };

  return adapter;
}
