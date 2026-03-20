import { describe, it, expect } from "vitest";
import {
  estimateCost,
  formatCost,
  getModelPricing,
  getContextWindow,
  listModels,
} from "../../src/providers/cost.js";

describe("Cost Estimator", () => {
  it("returns pricing for known models", () => {
    const pricing = getModelPricing("claude-sonnet-4-20250514");
    expect(pricing).toBeDefined();
    expect(pricing!.costPer1kInput).toBe(0.003);
    expect(pricing!.costPer1kOutput).toBe(0.015);
  });

  it("returns undefined for unknown models", () => {
    expect(getModelPricing("gpt-4")).toBeUndefined();
  });

  it("calculates cost correctly", () => {
    // Sonnet: $0.003/1k input, $0.015/1k output
    const cost = estimateCost("claude-sonnet-4-20250514", 1000, 500);
    // (1000/1000) * 0.003 + (500/1000) * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it("returns 0 for local models", () => {
    expect(estimateCost("llama3.2", 10000, 5000)).toBe(0);
  });

  it("returns 0 for unknown models", () => {
    expect(estimateCost("unknown-model", 1000, 500)).toBe(0);
  });

  it("formats costs correctly", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.003)).toBe("$0.0030");
  });

  it("returns context window", () => {
    expect(getContextWindow("claude-sonnet-4-20250514")).toBe(200000);
    expect(getContextWindow("unknown")).toBe(0);
  });

  it("lists all models", () => {
    const models = listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.provider === "anthropic")).toBe(true);
    expect(models.some((m) => m.provider === "ollama")).toBe(true);
  });
});
