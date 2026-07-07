import { describe, it, expect } from "vitest";
import { config } from "../../src/config.js";

describe("Config", () => {
  it("has sigintUrl with default value", () => {
    expect(config.sigintUrl).toBe("http://localhost:8082");
  });

  it("has disabledGates as an array", () => {
    expect(Array.isArray(config.disabledGates)).toBe(true);
  });

  it("disabledGates defaults to artifact_integrity, oath, vector_checkpoint", () => {
    expect(config.disabledGates).toEqual([
      "artifact_integrity",
      "oath",
      "vector_checkpoint",
    ]);
  });

  it("model policy has neutral defaults", () => {
    expect(config.defaultModel).toBe("ollama/gemma3:12b");
    expect(config.claudeDefaultModel).toBe("claude-sonnet-4-5");
    expect(config.analystModel).toBe("qwen3:latest");
    expect(config.directorModel).toBe("gemma3:27b");
  });
});
