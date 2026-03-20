import { describe, it, expect, vi, afterEach } from "vitest";
import { createOllamaAdapter } from "../../src/providers/adapters/ollama-adapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OllamaAdapter", () => {
  describe("healthCheck", () => {
    it("populates models list from /api/tags response", async () => {
      const adapter = createOllamaAdapter({ baseUrl: "http://localhost:11434" });

      // Starts empty
      expect(adapter.capabilities.models).toEqual([]);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: "llama3.1:8b", size: 4661226496 },
            { name: "mistral:7b", size: 3825819519 },
          ],
        }),
      }));

      await adapter.healthCheck();

      expect(adapter.capabilities.models).toEqual(["llama3.1:8b", "mistral:7b"]);
    });

    it("leaves models list unchanged when /api/tags returns no models array", async () => {
      const adapter = createOllamaAdapter({ baseUrl: "http://localhost:11434" });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.1.0" }), // no models key
      }));

      await adapter.healthCheck();

      expect(adapter.capabilities.models).toEqual([]);
    });

    it("returns degraded when server responds non-OK", async () => {
      const adapter = createOllamaAdapter({ baseUrl: "http://localhost:11434" });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }));

      const health = await adapter.healthCheck();
      expect(health.status).toBe("degraded");
      expect(adapter.capabilities.models).toEqual([]);
    });

    it("returns unavailable on network error", async () => {
      const adapter = createOllamaAdapter({ baseUrl: "http://localhost:11434" });

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      const health = await adapter.healthCheck();
      expect(health.status).toBe("unavailable");
      expect((health.details as { error?: string }).error).toContain("ECONNREFUSED");
    });
  });
});
