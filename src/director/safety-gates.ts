/**
 * VALOR Director Safety Gates
 *
 * Pre-LLM regex pattern matching from VM-007 spec.
 * Runs synchronously before any LLM call. If a gate fires,
 * the mission is intercepted and escalated to the Principal.
 */

import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateLevel = "P0" | "P1" | "P2";

export interface GateIntercept {
  mission_text: string;
  matched_gate: GateLevel;
  matched_patterns: string[];
  intercept_id: string;
  intercepted_at: string;
  status: "PENDING" | "APPROVED" | "ABORTED";
  override_by: string | null;
  override_at: string | null;
}

export interface GateResult {
  passed: boolean;
  intercept: GateIntercept | null;
}

// ---------------------------------------------------------------------------
// Whitelist — recurring false positives bypass all gates
// ---------------------------------------------------------------------------

const GATE_WHITELIST: RegExp[] = [
  /\bdocument\s+the\s+payment\s+flow\b/i,
  /\breview\s+the\s+invoice\s+format\b/i,
];

// ---------------------------------------------------------------------------
// P0 — Financial Transactions (BLOCK immediately)
// ---------------------------------------------------------------------------

const P0_FINANCIAL_PATTERNS: RegExp[] = [
  /\b(wire\s+transfer|bank\s+transfer|ACH|SWIFT|routing\s+number)\b/i,
  /\b(send|transfer|move|wire)\s+\$?\d+(\.\d{2})?\b/i,
  /\b(pay|payment|payout)\s+(to|for)\s+\w/i,
  /\bpurchase\s+(order|invoice|PO)\s*#?\d+/i,
  /\b(send|transfer|move)\s+(BTC|ETH|SOL|USDC|crypto|bitcoin|ethereum)\b/i,
  /\b(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/,
  /\b(credit\s+card|debit\s+card|card\s+number|CVV|expir(y|ation))\b/i,
  /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/,
  /\b(submit|pay|approve|process)\b.{0,30}\b(invoice|bill|charge)\b/i,
  /\bcharg(e|ing)\s+(customer|client|account)\b/i,
  /\b(issue|process|send)\b.{0,20}\b(refund|chargeback|reversal)\b/i,
  // Broader transfer pattern — catches "transfer budget", "transfer funds"
  /\btransfer\b.{0,30}\b(budget|funds?|balance|account|checking|savings)\b/i,
];

// ---------------------------------------------------------------------------
// P1 — Mass Communications & Destructive Operations (BLOCK)
// ---------------------------------------------------------------------------

const P1_MASS_COMMS_PATTERNS: RegExp[] = [
  /\b(blast|broadcast|bulk\s+email|mass\s+email|mass\s+SMS|email\s+all|SMS\s+all)\b/i,
  /\bsend\s+(to\s+)?(all|everyone|entire\s+list|subscriber|mailing\s+list)\b/i,
  /\b(newsletter|campaign)\s+(send|launch|fire|blast)\b/i,
  /\bsubscriber(s)?\s+(count|list).*send\b/i,
  /\b(delete|drop|truncate|wipe|purge)\b.{0,30}\b(all|entire|database|table|bucket|volume|records)\b/i,
  /\b(rm\s+-rf|format\s+c:|del\s+\/[sq])\b/i,
  /\bfactory\s+reset\b/i,
  /\b(terminate|destroy|delete)\b.{0,30}\b(all|every|instance|server|node|cluster|stack|environment)\b/i,
  /\b(shutdown|poweroff|kill)\s+(all|every|production|prod)\b/i,
  /\bdestroy\s+infrastructure\b/i,
  /\b(rotate|revoke|invalidate)\s+(all|every)\s+(key|token|credential|secret|API\s+key)\b/i,
];

// ---------------------------------------------------------------------------
// P2 — Public Content Publishing (WARN, hold for approval)
// ---------------------------------------------------------------------------

const P2_PUBLIC_PUBLISH_PATTERNS: RegExp[] = [
  /\b(post|publish|tweet|share)\b.{0,30}\b(Twitter|X|LinkedIn|Instagram|Facebook|TikTok)\b/i,
  /\b(social\s+media|social\s+post)\s+(publish|go\s+live|schedule)\b/i,
  /\b(publish|go\s+live|deploy)\b.{0,40}\b(blog\s+post|article|press\s+release)\b/i,
  /\btweet\b/i, // "tweet" alone is always public content
  /\b(update|change|edit)\s+(homepage|landing\s+page|public\s+site)\b/i,
  /\b(press\s+release|public\s+statement|announcement)\s+(send|publish|release)\b/i,
  /\bsend\s+(PR|press\s+release)\s+to\b/i,
  /\b(update|change|modify)\b.{0,20}\b(DNS|A\s+record|CNAME)\b/i,
  /\b(submit|publish|release)\b.{0,40}\b(App\s+Store|Play\s+Store|marketplace)\b/i,
  /\bapp\s+(release|submission|update)\s+(v\d|version)\b/i,
];

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

function makeInterceptId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function matchPatterns(text: string, patterns: RegExp[]): string[] {
  const matches: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      matches.push(m[0]);
    }
  }
  return matches;
}

/**
 * Evaluate a mission text against all safety gates.
 * Returns immediately on first match (P0 > P1 > P2 priority order).
 */
export function evaluateGates(missionText: string): GateResult {
  // Check whitelist first — known false positives bypass all gates
  for (const wp of GATE_WHITELIST) {
    if (wp.test(missionText)) {
      return { passed: true, intercept: null };
    }
  }

  // P0 — Financial
  const p0Matches = matchPatterns(missionText, P0_FINANCIAL_PATTERNS);
  if (p0Matches.length > 0) {
    return buildIntercept(missionText, "P0", p0Matches);
  }

  // P1 — Mass comms / destructive
  const p1Matches = matchPatterns(missionText, P1_MASS_COMMS_PATTERNS);
  if (p1Matches.length > 0) {
    return buildIntercept(missionText, "P1", p1Matches);
  }

  // P2 — Public content
  const p2Matches = matchPatterns(missionText, P2_PUBLIC_PUBLISH_PATTERNS);
  if (p2Matches.length > 0) {
    return buildIntercept(missionText, "P2", p2Matches);
  }

  return { passed: true, intercept: null };
}

function buildIntercept(
  missionText: string,
  level: GateLevel,
  matches: string[],
): GateResult {
  const intercept: GateIntercept = {
    mission_text: missionText,
    matched_gate: level,
    matched_patterns: matches,
    intercept_id: makeInterceptId(),
    intercepted_at: new Date().toISOString(),
    status: "PENDING",
    override_by: null,
    override_at: null,
  };

  logger.warn("Safety gate intercepted mission", {
    gate: level,
    intercept_id: intercept.intercept_id,
    patterns: matches,
  });

  return { passed: false, intercept };
}

/**
 * Format a gate intercept for Telegram escalation.
 */
export function formatTelegramAlert(intercept: GateIntercept): string {
  const icon = intercept.matched_gate === "P2" ? "\u26a0\ufe0f" : "\u26d4";
  const label =
    intercept.matched_gate === "P0"
      ? "FINANCIAL"
      : intercept.matched_gate === "P1"
        ? "MASS COMMS / DESTRUCTIVE"
        : "PUBLIC CONTENT";

  const timeout =
    intercept.matched_gate === "P0"
      ? "Auto-aborts in: 10 minutes"
      : intercept.matched_gate === "P1"
        ? "Auto-aborts in: 5 minutes"
        : "Auto-holds until approved (no auto-abort for P2).";

  return [
    `${icon} VALOR SAFETY GATE — ${intercept.matched_gate} ${label}`,
    "─".repeat(40),
    `Mission intercepted at: ${intercept.intercepted_at}`,
    `Intercept ID: gate_${intercept.intercept_id}`,
    "",
    "Mission text:",
    `"${intercept.mission_text}"`,
    "",
    `Matched: ${intercept.matched_patterns.join(", ")}`,
    "",
    `To approve: Reply APPROVED gate_${intercept.intercept_id}`,
    `To abort: Reply ABORT gate_${intercept.intercept_id}`,
    timeout,
  ].join("\n");
}
