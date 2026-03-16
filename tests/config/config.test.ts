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
});
