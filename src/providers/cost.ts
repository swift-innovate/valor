import type { ModelPricing } from "./types.js";

// Pricing per 1K tokens (USD) — updated March 2026
const MODEL_PRICING: ModelPricing[] = [
  // Claude 4 family
  { id: "claude-opus-4-20250514", provider: "anthropic", costPer1kInput: 0.015, costPer1kOutput: 0.075, contextWindow: 200000 },
  { id: "claude-sonnet-4-20250514", provider: "anthropic", costPer1kInput: 0.003, costPer1kOutput: 0.015, contextWindow: 200000 },
  // Claude 3.5 family
  { id: "claude-3-5-sonnet-20241022", provider: "anthropic", costPer1kInput: 0.003, costPer1kOutput: 0.015, contextWindow: 200000 },
  { id: "claude-3-5-haiku-20241022", provider: "anthropic", costPer1kInput: 0.0008, costPer1kOutput: 0.004, contextWindow: 200000 },
  // Claude 3 family
  { id: "claude-3-opus-20240229", provider: "anthropic", costPer1kInput: 0.015, costPer1kOutput: 0.075, contextWindow: 200000 },
  { id: "claude-3-haiku-20240307", provider: "anthropic", costPer1kInput: 0.00025, costPer1kOutput: 0.00125, contextWindow: 200000 },
  // Local models (free)
  { id: "llama3.2", provider: "ollama", costPer1kInput: 0, costPer1kOutput: 0, contextWindow: 128000 },
  { id: "deepseek-r1", provider: "ollama", costPer1kInput: 0, costPer1kOutput: 0, contextWindow: 128000 },
  { id: "qwen2.5-coder", provider: "ollama", costPer1kInput: 0, costPer1kOutput: 0, contextWindow: 32000 },
];

export function getModelPricing(modelId: string): ModelPricing | undefined {
  return MODEL_PRICING.find((m) => m.id === modelId);
}

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(modelId);
  if (!pricing) return 0;

  return (inputTokens / 1000) * pricing.costPer1kInput
       + (outputTokens / 1000) * pricing.costPer1kOutput;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function getContextWindow(modelId: string): number {
  const pricing = getModelPricing(modelId);
  return pricing?.contextWindow ?? 0;
}

export function listModels(): ModelPricing[] {
  return [...MODEL_PRICING];
}
