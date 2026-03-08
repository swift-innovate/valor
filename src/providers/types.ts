import { z } from "zod";
import type { StreamEvent } from "../types/index.js";

// ─── Provider Classification ────────────────────────────

export const ProviderType = z.enum([
  "cloud_api",
  "conduit",
  "herd",
  "openclaw",
  "home_assistant",
]);
export type ProviderType = z.infer<typeof ProviderType>;

// ─── Capabilities & Health ──────────────────────────────

export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  maxContextTokens: number;
  models: string[];
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unavailable";
  latency_ms: number;
  last_check: string;
  details?: Record<string, unknown>;
}

// ─── Request / Response ─────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  max_tokens?: number;
  temperature?: number;
  system?: string;
}

export interface ProviderResponse {
  content: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  tool_calls?: ToolCall[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "error";
}

// ─── Provider Adapter Contract ──────────────────────────

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;

  /** Check if provider is healthy and ready */
  healthCheck(): Promise<ProviderHealth>;

  /** Send a message and get a streaming response */
  stream(request: ProviderRequest): AsyncIterable<StreamEvent>;

  /** Send a message and get a complete response */
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

// ─── Dispatch Criteria ──────────────────────────────────

export interface DispatchCriteria {
  model?: string;
  capabilities?: Partial<ProviderCapabilities>;
  preferLocal?: boolean;
  maxCostPer1kTokens?: number;
  division?: string;
}

// ─── Model Pricing ──────────────────────────────────────

export interface ModelPricing {
  id: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  contextWindow: number;
}
