import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getTelegramConfig", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when TELEGRAM_BOT_TOKEN is not set", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "12345");

    // Dynamic import to pick up env changes
    const { getTelegramConfig } = await import("../../src/telegram/bot.js");
    const cfg = getTelegramConfig();
    expect(cfg).toBeNull();
  });

  it("returns null when TELEGRAM_CHAT_ID is not set", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");

    const { getTelegramConfig } = await import("../../src/telegram/bot.js");
    const cfg = getTelegramConfig();
    expect(cfg).toBeNull();
  });

  it("returns config when both env vars are set", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token-123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "99999");

    const { getTelegramConfig } = await import("../../src/telegram/bot.js");
    const cfg = getTelegramConfig();
    expect(cfg).toEqual({
      botToken: "test-token-123",
      chatId: "99999",
    });
  });
});
