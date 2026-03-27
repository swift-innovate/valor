/**
 * VALOR Check-In Hook Script
 *
 * Runs deterministically after every Claude Code task completion via the Stop hook.
 * Hits VALOR's REST inbox endpoint and outputs results to stdout so Claude sees them.
 *
 * Required environment variables:
 *   VALOR_URL        — Engine base URL (default: http://localhost:3200)
 *   VALOR_AGENT_ID   — Your agent ID (e.g. agt_xxx)
 *   VALOR_CALLSIGN   — Your operative callsign
 *   VALOR_AGENT_KEY  — Auth key (optional in dev mode)
 *
 * Exit codes:
 *   0 — Check-in completed (or skipped gracefully on error)
 *   Non-zero exit is avoided to prevent blocking Claude's workflow
 */

import * as fs from "node:fs";
import * as path from "node:path";

const VALOR_URL = process.env.VALOR_URL ?? "http://localhost:3200";
const AGENT_ID = process.env.VALOR_AGENT_ID ?? "";
const CALLSIGN = process.env.VALOR_CALLSIGN ?? "unknown";
const AGENT_KEY = process.env.VALOR_AGENT_KEY ?? "";
const STATE_FILE = path.join(process.cwd(), ".valor-last-check");

// Timeout for the check-in request (ms)
const REQUEST_TIMEOUT = 5_000;

interface InboxResponse {
  heartbeat_at: string;
  pending_missions: Array<{
    id: string;
    title: string;
    status: string;
    operative: string;
    priority?: string;
  }>;
  directives: Array<{
    type: string;
    mission_id: string;
    reason: string;
    issued_at: string;
  }>;
  messages: Array<{
    id: string;
    payload: {
      subject?: string;
      body?: string;
      from_agent_id?: string;
      category?: string;
      priority?: string;
    };
  }>;
}

function getLastCheck(): string {
  try {
    return fs.readFileSync(STATE_FILE, "utf-8").trim();
  } catch {
    // Default to 30 minutes ago if no state file
    return new Date(Date.now() - 30 * 60_000).toISOString();
  }
}

function persistLastCheck(): void {
  try {
    fs.writeFileSync(STATE_FILE, new Date().toISOString());
  } catch {
    // Non-fatal — next check will just replay some messages
  }
}

async function checkIn(): Promise<void> {
  // Guard: need at minimum an agent ID or callsign-based lookup
  if (!AGENT_ID) {
    // Try to look up agent by callsign
    const agent = await lookupAgentByCallsign();
    if (!agent) {
      console.log(`📡 VALOR: Skipped check-in — VALOR_AGENT_ID not set and callsign lookup failed.`);
      return;
    }
    // Use the looked-up ID
    return checkInWithId(agent.id);
  }

  return checkInWithId(AGENT_ID);
}

async function lookupAgentByCallsign(): Promise<{ id: string } | null> {
  if (!CALLSIGN || CALLSIGN === "unknown") return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (AGENT_KEY) headers["X-VALOR-Agent-Key"] = AGENT_KEY;

    const res = await fetch(`${VALOR_URL}/agents`, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const agents = (await res.json()) as Array<{ id: string; callsign: string }>;
    const match = agents.find(
      (a) => a.callsign.toLowerCase() === CALLSIGN.toLowerCase(),
    );

    return match ?? null;
  } catch {
    return null;
  }
}

async function checkInWithId(agentId: string): Promise<void> {
  const since = getLastCheck();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AGENT_KEY) headers["X-VALOR-Agent-Key"] = AGENT_KEY;

  try {
    const res = await fetch(
      `${VALOR_URL}/agents/${agentId}/inbox?since=${encodeURIComponent(since)}`,
      { headers, signal: controller.signal },
    );

    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) {
        console.log(`📡 VALOR: Agent ${agentId} not found in engine. Check VALOR_AGENT_ID.`);
      } else {
        console.log(`📡 VALOR: Check-in returned HTTP ${res.status}.`);
      }
      return;
    }

    const inbox = (await res.json()) as InboxResponse;

    const missions = inbox.pending_missions?.length ?? 0;
    const directives = inbox.directives?.length ?? 0;
    const messages = inbox.messages?.length ?? 0;

    // Always output — Claude needs to see this
    console.log("");
    console.log("═══════════════════════════════════════════════");
    console.log("  📡 VALOR CHECK-IN");
    console.log("═══════════════════════════════════════════════");
    console.log(`  Operative: ${CALLSIGN}`);
    console.log(`  Heartbeat: ${inbox.heartbeat_at}`);
    console.log("");

    if (directives > 0) {
      console.log(`  ⚠️  ${directives} DIRECTIVE(S) — IMMEDIATE ACTION REQUIRED`);
      for (const d of inbox.directives) {
        console.log(`     ${d.type.toUpperCase()}: Mission ${d.mission_id} — ${d.reason}`);
      }
      console.log("");
    }

    if (missions > 0) {
      console.log(`  📋 ${missions} pending mission(s):`);
      for (const m of inbox.pending_missions) {
        const pri = m.priority ? ` [${m.priority}]` : "";
        console.log(`     → ${m.id}: ${m.title}${pri}`);
      }
      console.log("");
    }

    if (messages > 0) {
      // Filter out own messages
      const others = inbox.messages.filter(
        (m) => m.payload.from_agent_id !== agentId,
      );
      if (others.length > 0) {
        console.log(`  💬 ${others.length} new message(s):`);
        for (const m of others.slice(0, 5)) {
          const subj = m.payload.subject ?? "(no subject)";
          const pri = m.payload.priority === "flash" ? " 🔴" : "";
          console.log(`     → ${subj}${pri}`);
        }
        if (others.length > 5) {
          console.log(`     ... and ${others.length - 5} more`);
        }
        console.log("");
      }
    }

    if (missions === 0 && directives === 0 && messages === 0) {
      console.log("  ✅ All clear — no pending work.");
      console.log("");
    }

    console.log("═══════════════════════════════════════════════");
    console.log("");

    persistLastCheck();
  } catch (err) {
    clearTimeout(timeout);

    if (err instanceof Error && err.name === "AbortError") {
      console.log(`📡 VALOR: Check-in timed out (engine may be offline).`);
    } else {
      console.log(
        `📡 VALOR: Check-in failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// Run
checkIn().catch(() => {
  // Swallow — never block Claude's workflow
});
