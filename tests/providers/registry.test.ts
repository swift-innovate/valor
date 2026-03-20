import { describe, it, expect, beforeEach } from "vitest";
import {
  registerProvider,
  getProvider,
  getProvidersByType,
  getBestProvider,
  listProviders,
  clearProviders,
} from "../../src/providers/registry.js";
import type { ProviderAdapter, ProviderHealth } from "../../src/providers/types.js";
import type { StreamEvent } from "../../src/types/index.js";

function mockProvider(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: "test_provider",
    name: "Test Provider",
    type: "claude_api",
    capabilities: {
      streaming: true,
      toolUse: true,
      vision: false,
      maxContextTokens: 200000,
      models: ["claude-sonnet-4-20250514", "claude-3-haiku-20240307"],
    },
    async healthCheck(): Promise<ProviderHealth> {
      return { status: "healthy", latency_ms: 50, last_check: new Date().toISOString() };
    },
    async *stream(): AsyncIterable<StreamEvent> {},
    async complete() {
      return {
        content: "test",
        model: "test",
        usage: { input_tokens: 0, output_tokens: 0 },
        stop_reason: "end_turn" as const,
      };
    },
    ...overrides,
  };
}

beforeEach(() => clearProviders());

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider", () => {
    const p = mockProvider();
    registerProvider(p);
    expect(getProvider("test_provider")).toBe(p);
  });

  it("returns undefined for unknown provider", () => {
    expect(getProvider("nope")).toBeUndefined();
  });

  it("lists all providers", () => {
    registerProvider(mockProvider({ id: "a", name: "A" }));
    registerProvider(mockProvider({ id: "b", name: "B" }));
    expect(listProviders()).toHaveLength(2);
  });

  it("filters by type", () => {
    registerProvider(mockProvider({ id: "cloud", type: "claude_api" }));
    registerProvider(mockProvider({ id: "local", type: "ollama" }));
    expect(getProvidersByType("claude_api")).toHaveLength(1);
    expect(getProvidersByType("ollama")).toHaveLength(1);
  });

  it("finds best provider by model", () => {
    registerProvider(mockProvider({
      id: "haiku_only",
      capabilities: {
        streaming: true, toolUse: false, vision: false,
        maxContextTokens: 200000, models: ["claude-3-haiku-20240307"],
      },
    }));
    registerProvider(mockProvider({
      id: "sonnet",
      capabilities: {
        streaming: true, toolUse: true, vision: false,
        maxContextTokens: 200000, models: ["claude-sonnet-4-20250514"],
      },
    }));

    const best = getBestProvider({ model: "claude-sonnet-4-20250514" });
    expect(best?.id).toBe("sonnet");
  });

  it("prefers local when requested", () => {
    registerProvider(mockProvider({ id: "cloud", type: "claude_api" }));
    registerProvider(mockProvider({ id: "local", type: "ollama" }));

    const best = getBestProvider({ preferLocal: true });
    expect(best?.id).toBe("local");
  });

  it("returns undefined when no match", () => {
    registerProvider(mockProvider({
      capabilities: {
        streaming: true, toolUse: false, vision: false,
        maxContextTokens: 200000, models: ["claude-3-haiku-20240307"],
      },
    }));

    expect(getBestProvider({ model: "gpt-4" })).toBeUndefined();
  });

  it("provider with empty models list matches any model request", () => {
    // Empty models = not yet health-checked, treat as "accepts any"
    registerProvider(mockProvider({
      id: "ollama_unchecked",
      type: "ollama",
      capabilities: {
        streaming: true, toolUse: false, vision: false,
        maxContextTokens: 128000, models: [],
      },
    }));

    const best = getBestProvider({ model: "llama3.1:8b" });
    expect(best?.id).toBe("ollama_unchecked");
  });

  it("provider with populated models list excludes non-matching model", () => {
    registerProvider(mockProvider({
      id: "ollama_checked",
      type: "ollama",
      capabilities: {
        streaming: true, toolUse: false, vision: false,
        maxContextTokens: 128000, models: ["llama3.1:8b"],
      },
    }));

    expect(getBestProvider({ model: "mistral:7b" })).toBeUndefined();
    expect(getBestProvider({ model: "llama3.1:8b" })?.id).toBe("ollama_checked");
  });
});
