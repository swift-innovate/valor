import Anthropic from "@anthropic-ai/sdk";
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

export interface ClaudeAdapterConfig {
  apiKey: string;
  defaultModel?: string;
}

export function createClaudeAdapter(config: ClaudeAdapterConfig): ProviderAdapter {
  const client = new Anthropic({ apiKey: config.apiKey });
  const defaultModel = config.defaultModel ?? "claude-sonnet-4-20250514";

  const adapter: ProviderAdapter = {
    id: "claude_api",
    name: "Direct Claude API",
    type: "cloud_api" as ProviderType,
    capabilities: {
      streaming: true,
      toolUse: true,
      vision: true,
      maxContextTokens: 200000,
      models: [
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
        "claude-3-haiku-20240307",
      ],
    },

    async healthCheck(): Promise<ProviderHealth> {
      const start = Date.now();
      try {
        // Minimal request to verify API key and connectivity
        await client.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        });
        return {
          status: "healthy",
          latency_ms: Date.now() - start,
          last_check: new Date().toISOString(),
        };
      } catch (err) {
        const latency = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);

        // Rate limit = degraded, not unavailable
        if (message.includes("rate_limit") || message.includes("429")) {
          return {
            status: "degraded",
            latency_ms: latency,
            last_check: new Date().toISOString(),
            details: { error: message },
          };
        }

        return {
          status: "unavailable",
          latency_ms: latency,
          last_check: new Date().toISOString(),
          details: { error: message },
        };
      }
    },

    async *stream(request: ProviderRequest): AsyncIterable<StreamEvent> {
      const sessionId = `cls_${nanoid(21)}`;
      let sequence = 0;

      const tools = request.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      }));

      try {
        const stream = client.messages.stream({
          model: request.model || defaultModel,
          max_tokens: request.max_tokens ?? 4096,
          temperature: request.temperature,
          system: request.system,
          messages: request.messages.filter((m) => m.role !== "system").map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          ...(tools?.length ? { tools } : {}),
        });

        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            const delta = event.delta;
            if ("text" in delta) {
              yield {
                session_id: sessionId,
                sequence: sequence++,
                event_type: "token",
                data: { text: delta.text },
                timestamp: new Date().toISOString(),
              };
            } else if ("partial_json" in delta) {
              yield {
                session_id: sessionId,
                sequence: sequence++,
                event_type: "tool_use",
                data: { partial_json: delta.partial_json },
                timestamp: new Date().toISOString(),
              };
            }
          } else if (event.type === "message_start") {
            yield {
              session_id: sessionId,
              sequence: sequence++,
              event_type: "heartbeat",
              data: { model: event.message.model },
              timestamp: new Date().toISOString(),
            };
          }
        }

        const finalMessage = await stream.finalMessage();

        yield {
          session_id: sessionId,
          sequence: sequence++,
          event_type: "completion",
          data: {
            stop_reason: finalMessage.stop_reason,
            usage: {
              input_tokens: finalMessage.usage.input_tokens,
              output_tokens: finalMessage.usage.output_tokens,
            },
          },
          timestamp: new Date().toISOString(),
        };
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
      const tools = request.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      }));

      const response = await client.messages.create({
        model: request.model || defaultModel,
        max_tokens: request.max_tokens ?? 4096,
        temperature: request.temperature,
        system: request.system,
        messages: request.messages.filter((m) => m.role !== "system").map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        ...(tools?.length ? { tools } : {}),
      });

      const textContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const toolCalls = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          name: b.name,
          input: b.input as Record<string, unknown>,
        }));

      return {
        content: textContent,
        model: response.model,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        stop_reason: response.stop_reason === "tool_use" ? "tool_use"
          : response.stop_reason === "max_tokens" ? "max_tokens"
          : "end_turn",
      };
    },
  };

  return adapter;
}
