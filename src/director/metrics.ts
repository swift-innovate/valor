/**
 * VALOR Director Metrics Collector
 *
 * Simple in-memory metrics for the Director service daemon.
 * Tracks classification throughput, latency, gear escalation rate,
 * and safety gate intercept count.
 *
 * Metrics reset on service restart (no persistence needed).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectorMetrics {
  /** Total classifications processed since startup. */
  totalClassifications: number;
  /** Classifications in the current 60-second window. */
  classificationsThisMinute: number;
  /** Rolling classifications/minute (computed from window). */
  classificationsPerMinute: number;
  /** Average classification latency in ms (rolling). */
  avgLatencyMs: number;
  /** Number of classifications that used Gear 1 only. */
  gear1Count: number;
  /** Number of classifications escalated to Gear 2. */
  gear2Count: number;
  /** Gear 2 escalation rate (0-1). */
  gear2Rate: number;
  /** Number of missions intercepted by safety gates. */
  gateInterceptCount: number;
  /** Service uptime in ms. */
  uptimeMs: number;
  /** Last classification timestamp (ISO string or null). */
  lastClassificationAt: string | null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface LatencyWindow {
  timestamp: number;
  durationMs: number;
}

let _totalClassifications = 0;
let _gear1Count = 0;
let _gear2Count = 0;
let _gateInterceptCount = 0;
let _lastClassificationAt: string | null = null;
let _startedAt = Date.now();

/** Sliding window of latencies (last 5 minutes). */
let _latencyWindow: LatencyWindow[] = [];

/** Classification timestamps in current minute window. */
let _minuteWindow: number[] = [];

const LATENCY_WINDOW_MS = 5 * 60_000; // 5 minutes
const MINUTE_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a completed classification.
 */
export function recordClassification(
  gear: 1 | 2 | null,
  gateIntercepted: boolean,
  durationMs: number,
): void {
  const now = Date.now();

  _totalClassifications++;
  _lastClassificationAt = new Date().toISOString();

  if (gateIntercepted) {
    _gateInterceptCount++;
  } else if (gear === 1) {
    _gear1Count++;
  } else if (gear === 2) {
    _gear2Count++;
  }

  _latencyWindow.push({ timestamp: now, durationMs });
  _minuteWindow.push(now);

  // Prune old entries
  pruneWindows(now);
}

/**
 * Record a safety gate intercept (convenience — also counted by recordClassification).
 */
export function recordGateIntercept(): void {
  _gateInterceptCount++;
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

/**
 * Get current metrics snapshot.
 */
export function getMetrics(): DirectorMetrics {
  const now = Date.now();
  pruneWindows(now);

  const avgLatencyMs =
    _latencyWindow.length > 0
      ? _latencyWindow.reduce((sum, w) => sum + w.durationMs, 0) / _latencyWindow.length
      : 0;

  const llmCount = _gear1Count + _gear2Count;
  const gear2Rate = llmCount > 0 ? _gear2Count / llmCount : 0;

  return {
    totalClassifications: _totalClassifications,
    classificationsThisMinute: _minuteWindow.length,
    classificationsPerMinute: _minuteWindow.length,
    avgLatencyMs: Math.round(avgLatencyMs),
    gear1Count: _gear1Count,
    gear2Count: _gear2Count,
    gear2Rate: Math.round(gear2Rate * 1000) / 1000,
    gateInterceptCount: _gateInterceptCount,
    uptimeMs: now - _startedAt,
    lastClassificationAt: _lastClassificationAt,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  _totalClassifications = 0;
  _gear1Count = 0;
  _gear2Count = 0;
  _gateInterceptCount = 0;
  _lastClassificationAt = null;
  _startedAt = Date.now();
  _latencyWindow = [];
  _minuteWindow = [];
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function pruneWindows(now: number): void {
  const latencyCutoff = now - LATENCY_WINDOW_MS;
  _latencyWindow = _latencyWindow.filter((w) => w.timestamp > latencyCutoff);

  const minuteCutoff = now - MINUTE_WINDOW_MS;
  _minuteWindow = _minuteWindow.filter((ts) => ts > minuteCutoff);
}
