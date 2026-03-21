/**
 * VALOR Telegram Gateway — Diagnostic Commands
 *
 * /logs [target]    — Tail log files
 * /health           — Deep health check (NATS, Ollama, Director, JetStream)
 * /ollama [cmd]     — Model management (list, unload, load <model>)
 * /retry            — Re-publish last failed/stuck mission
 *
 * All commands are Principal-only. Designed for phone use — output is concise.
 *
 * Mission: VM-021
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { jetstreamManager } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import type TelegramBot from "node-telegram-bot-api";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const LOGS_DIR = process.env.VALOR_LOGS_DIR ?? "logs";
const LOG_TAIL_LINES = 15;

const LOG_FILE_MAP: Record<string, string> = {
  director: "director.log",
  nats: "nats.log",
  consumer: "consumer.log",
  analyst: "analyst.log",
  gateway: "gateway.log",
};

// Stored reference to last inbound mission for /retry
let lastMissionPayload: { subject: string; data: Uint8Array } | null = null;

export function setLastMission(subject: string, data: Uint8Array): void {
  lastMissionPayload = { subject, data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

async function fetchJson<T>(
  url: string,
  opts?: RequestInit,
): Promise<{ ok: boolean; data?: T; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, latencyMs };
    }
    const data = (await res.json()) as T;
    return { ok: true, data, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function tailLog(filename: string, lines: number): Promise<string> {
  const filepath = path.join(LOGS_DIR, filename);
  if (!existsSync(filepath)) {
    return `(file not found: ${filepath})`;
  }
  try {
    const content = await readFile(filepath, "utf8");
    const allLines = content.split("\n").filter((l) => l.trim());
    if (allLines.length === 0) return "(log file is empty)";
    const tail = allLines.slice(-lines);
    return tail.join("\n");
  } catch (err) {
    return `(read error: ${err instanceof Error ? err.message : String(err)})`;
  }
}

function bytesToGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

// ---------------------------------------------------------------------------
// /logs [target]
// ---------------------------------------------------------------------------

export async function handleLogs(
  bot: TelegramBot,
  chatId: number,
  target: string,
): Promise<void> {
  const normalized = target.toLowerCase().trim() || "director";
  const filename = LOG_FILE_MAP[normalized];

  if (!filename) {
    const validTargets = Object.keys(LOG_FILE_MAP).join(", ");
    await bot.sendMessage(
      chatId,
      `❓ Unknown log target: \`${normalized}\`\n\nValid targets: ${validTargets}`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  await bot.sendMessage(chatId, `🔍 Fetching last ${LOG_TAIL_LINES} lines of \`${filename}\`...`, {
    parse_mode: "Markdown",
  });

  const tail = await tailLog(filename, LOG_TAIL_LINES);

  // Telegram code block max ~4096 chars — truncate if needed
  const truncated = tail.length > 3500 ? "...(truncated)\n" + tail.slice(-3400) : tail;

  await bot.sendMessage(chatId, `📋 \`${filename}\` — last ${LOG_TAIL_LINES} lines:\n\`\`\`\n${truncated}\n\`\`\``, {
    parse_mode: "Markdown",
  });
}

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

interface OllamaTagsResponse {
  models: Array<{ name: string; size: number; modified_at: string }>;
}

interface OllamaPsResponse {
  models: Array<{
    name: string;
    size_vram: number;
    size: number;
    until: string;
  }>;
}

export async function handleHealth(
  bot: TelegramBot,
  chatId: number,
  nc: NatsConnection,
): Promise<void> {
  await bot.sendMessage(chatId, "🔍 Running health checks...");

  const lines: string[] = ["🩺 *VALOR Deep Health*", ""];

  // 1. NATS connectivity
  try {
    const rtt = await nc.rtt();
    lines.push(`✅ NATS: connected (${rtt}ms RTT)`);
  } catch (err) {
    lines.push(`❌ NATS: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. JetStream — pending missions count
  try {
    const jsm = await jetstreamManager(nc);
    const missionsInfo = await jsm.streams.info("MISSIONS");
    const pending = missionsInfo.state.messages;
    const consumers = missionsInfo.state.consumer_count;
    lines.push(`✅ JetStream MISSIONS: ${pending} pending msg(s), ${consumers} consumer(s)`);
  } catch (err) {
    lines.push(`❌ JetStream: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Active consumers (operatives connected)
  try {
    const jsm = await jetstreamManager(nc);
    const consumerList = await jsm.consumers.list("MISSIONS").next();
    if (consumerList.length > 0) {
      const names = consumerList
        .map((c) => c.name.replace("mission-consumer-", ""))
        .join(", ");
      lines.push(`✅ Active consumers: ${names}`);
    } else {
      lines.push(`⚠️ Active consumers: none (no operatives connected)`);
    }
  } catch {
    lines.push(`⚠️ Consumer list: unavailable`);
  }

  lines.push("");

  // 4. Ollama reachability
  const tagsResult = await fetchJson<OllamaTagsResponse>(`${OLLAMA_URL}/api/tags`);
  if (tagsResult.ok && tagsResult.data) {
    const count = tagsResult.data.models?.length ?? 0;
    lines.push(`✅ Ollama: reachable (${tagsResult.latencyMs}ms, ${count} model(s) available)`);
  } else {
    lines.push(`❌ Ollama: unreachable — ${tagsResult.error}`);
    lines.push(`   URL: ${OLLAMA_URL}`);
  }

  // 5. Ollama VRAM — what's loaded
  const psResult = await fetchJson<OllamaPsResponse>(`${OLLAMA_URL}/api/ps`);
  if (psResult.ok && psResult.data) {
    const loaded = psResult.data.models ?? [];
    if (loaded.length === 0) {
      lines.push(`💤 Ollama VRAM: no models loaded`);
    } else {
      for (const m of loaded) {
        const vram = m.size_vram > 0 ? bytesToGb(m.size_vram) : "CPU";
        const until = m.until ? new Date(m.until).toISOString().slice(11, 19) + " UTC" : "?";
        lines.push(`🧠 Loaded: ${m.name} (${vram} VRAM, expires ${until})`);
      }
    }
  } else {
    lines.push(`⚠️ Ollama /api/ps: ${psResult.error ?? "unavailable"}`);
  }

  lines.push("");

  // 6. Director log — last activity
  const dirLog = await tailLog("director.log", 3);
  if (dirLog.startsWith("(")) {
    lines.push(`📋 Director log: ${dirLog}`);
  } else {
    const lastLines = dirLog.split("\n").filter((l) => l.trim()).slice(-3);
    lines.push("📋 Director (last 3 lines):");
    lines.push("```");
    lines.push(lastLines.join("\n"));
    lines.push("```");
  }

  await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}

// ---------------------------------------------------------------------------
// /ollama [subcommand]
// ---------------------------------------------------------------------------

export async function handleOllama(
  bot: TelegramBot,
  chatId: number,
  subcommand: string,
): Promise<void> {
  const parts = subcommand.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || "list";

  if (cmd === "list" || cmd === "") {
    // Show loaded models (/api/ps) and available models (/api/tags)
    const [psResult, tagsResult] = await Promise.all([
      fetchJson<OllamaPsResponse>(`${OLLAMA_URL}/api/ps`),
      fetchJson<OllamaTagsResponse>(`${OLLAMA_URL}/api/tags`),
    ]);

    const lines: string[] = ["🤖 *Ollama Status*", ""];

    // Loaded in VRAM
    if (psResult.ok && psResult.data) {
      const loaded = psResult.data.models ?? [];
      if (loaded.length === 0) {
        lines.push("💤 *In VRAM:* none");
      } else {
        lines.push("🧠 *In VRAM:*");
        for (const m of loaded) {
          const vram = m.size_vram > 0 ? bytesToGb(m.size_vram) : "CPU only";
          lines.push(`  • ${m.name} — ${vram}`);
        }
      }
    } else {
      lines.push(`❌ VRAM check failed: ${psResult.error}`);
    }

    lines.push("");

    // Available models
    if (tagsResult.ok && tagsResult.data) {
      const models = tagsResult.data.models ?? [];
      lines.push(`📦 *Available (${models.length}):*`);
      for (const m of models.slice(0, 12)) {
        const size = bytesToGb(m.size);
        lines.push(`  • ${m.name} (${size})`);
      }
      if (models.length > 12) {
        lines.push(`  ... and ${models.length - 12} more`);
      }
    } else {
      lines.push(`❌ Model list failed: ${tagsResult.error}`);
    }

    lines.push("");
    lines.push("_/ollama unload — free VRAM_");
    lines.push("_/ollama load \\<model\\> — warm a model_");

    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
    return;
  }

  if (cmd === "unload") {
    // Get currently loaded models and unload them all
    const psResult = await fetchJson<OllamaPsResponse>(`${OLLAMA_URL}/api/ps`);
    if (!psResult.ok || !psResult.data) {
      await bot.sendMessage(chatId, `❌ Cannot check loaded models: ${psResult.error}`);
      return;
    }

    const loaded = psResult.data.models ?? [];
    if (loaded.length === 0) {
      await bot.sendMessage(chatId, "💤 No models loaded — VRAM already free.");
      return;
    }

    await bot.sendMessage(chatId, `⏳ Unloading ${loaded.length} model(s)...`);

    const results: string[] = [];
    for (const m of loaded) {
      const result = await fetchJson(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
      });
      results.push(
        result.ok
          ? `✅ Unloaded: ${m.name}`
          : `❌ Failed to unload ${m.name}: ${result.error}`,
      );
    }

    await bot.sendMessage(chatId, results.join("\n") + "\n\n💤 VRAM freed.");
    return;
  }

  if (cmd === "load") {
    const modelName = parts.slice(1).join(" ").trim();
    if (!modelName) {
      await bot.sendMessage(chatId, "❓ Usage: `/ollama load <model-name>`", {
        parse_mode: "Markdown",
      });
      return;
    }

    await bot.sendMessage(chatId, `⏳ Warming \`${modelName}\`... (may take 30s)`, {
      parse_mode: "Markdown",
    });

    const result = await fetchJson(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, keep_alive: "10m", prompt: "" }),
    });

    if (result.ok) {
      // Check it loaded
      const psResult = await fetchJson<OllamaPsResponse>(`${OLLAMA_URL}/api/ps`);
      const vram = psResult.data?.models?.find((m) => m.name === modelName)?.size_vram;
      const vramStr = vram && vram > 0 ? ` (${bytesToGb(vram)} VRAM)` : "";
      await bot.sendMessage(
        chatId,
        `✅ \`${modelName}\` loaded${vramStr}`,
        { parse_mode: "Markdown" },
      );
    } else {
      await bot.sendMessage(
        chatId,
        `❌ Failed to load \`${modelName}\`: ${result.error}`,
        { parse_mode: "Markdown" },
      );
    }
    return;
  }

  await bot.sendMessage(
    chatId,
    "❓ Unknown /ollama command.\n\nUsage:\n`/ollama` — list models\n`/ollama unload` — free VRAM\n`/ollama load <model>` — warm a model",
    { parse_mode: "Markdown" },
  );
}

// ---------------------------------------------------------------------------
// /retry
// ---------------------------------------------------------------------------

export async function handleRetry(
  bot: TelegramBot,
  chatId: number,
  nc: NatsConnection,
): Promise<void> {
  if (!lastMissionPayload) {
    await bot.sendMessage(
      chatId,
      "⚠️ No mission to retry — no failed or stuck mission recorded in this session.\n\nUse `/mission <text>` to dispatch a new one.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const { subject, data } = lastMissionPayload;

  try {
    nc.publish(subject, data);
    await bot.sendMessage(
      chatId,
      `🔄 Mission re-published to \`${subject}\`.\n\nDirector should pick it up within 10s. Watch for sitreps.`,
      { parse_mode: "Markdown" },
    );
    console.log(`[TelegramGateway] /retry: re-published to ${subject}`);
  } catch (err) {
    await bot.sendMessage(
      chatId,
      `❌ Retry failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
