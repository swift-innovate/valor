/**
 * Server-Sent Events (SSE) endpoint for real-time dashboard updates
 * 
 * Mission: VM-016
 * Operative: Mira
 */

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { natsState } from "./nats-state.js";

export const sseRoutes = new Hono();

/**
 * SSE endpoint for real-time updates
 * 
 * Sends events:
 * - mission.updated: When a mission changes state
 * - sitrep.received: When a new sitrep arrives
 * - operative.updated: When an operative status changes
 * - operative.offline: When an operative goes offline
 * - system.event: System lifecycle events
 * - verdict.received: Review verdicts
 * - comms.received: Comms messages
 * - event.added: Activity feed events
 * 
 * Client usage:
 * ```js
 * const eventSource = new EventSource('/dashboard/sse');
 * eventSource.addEventListener('mission.updated', (e) => {
 *   const mission = JSON.parse(e.data);
 *   // Update UI
 * });
 * ```
 */
sseRoutes.get("/", (c) => {
  // Set SSE headers
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (stream) => {
    // Send initial connection message
    await stream.writeln('event: connected');
    await stream.writeln('data: {"message":"Connected to VALOR Mission Control"}');
    await stream.writeln('');

    // Send initial state
    await stream.writeln('event: initial-state');
    await stream.writeln(`data: ${JSON.stringify({
      missions: natsState.getMissions(),
      operatives: natsState.getOperatives(),
      stats: natsState.getStats(),
    })}`);
    await stream.writeln('');

    // Subscribe to state changes
    const unsubscribe = natsState.subscribe(async (event, data) => {
      try {
        await stream.writeln(`event: ${event}`);
        await stream.writeln(`data: ${JSON.stringify(data)}`);
        await stream.writeln('');
      } catch (err) {
        console.error("[SSE] Error sending event:", err);
      }
    });

    // Keep connection alive with periodic pings
    const pingInterval = setInterval(async () => {
      try {
        await stream.writeln('event: ping');
        await stream.writeln('data: {"timestamp":"' + new Date().toISOString() + '"}');
        await stream.writeln('');
      } catch (err) {
        console.error("[SSE] Ping failed:", err);
        clearInterval(pingInterval);
      }
    }, 30000); // Ping every 30 seconds

    // Clean up on disconnect
    stream.onAbort(() => {
      unsubscribe();
      clearInterval(pingInterval);
      console.log("[SSE] Client disconnected");
    });

    // Keep the stream open — use a promise that never resolves.
    // stream.sleep(Number.MAX_SAFE_INTEGER) overflows a 32-bit int
    // and resolves in 1ms, killing the connection instantly.
    await new Promise<void>(() => {});
  });
});
