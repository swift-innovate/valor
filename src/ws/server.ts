import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { subscribe } from "../bus/index.js";
import { logger } from "../utils/logger.js";
import type { EventEnvelope } from "../types/index.js";

let wss: WebSocketServer | null = null;

/**
 * Attach a WebSocket server to the existing HTTP server.
 * Broadcasts all event bus messages to connected dashboard clients.
 */
export function attachWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    logger.info("Dashboard WebSocket connected", { clients: wss!.clients.size });

    ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));

    ws.on("close", () => {
      logger.info("Dashboard WebSocket disconnected", { clients: wss!.clients.size });
    });
  });

  // Bridge event bus → WebSocket broadcast
  subscribe("*", (event: EventEnvelope) => {
    broadcast(event);
  });

  logger.info("WebSocket server attached", { path: "/ws" });
  return wss;
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcast(data: unknown): void {
  if (!wss) return;

  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Get count of connected WebSocket clients.
 */
export function getConnectedClients(): number {
  return wss?.clients.size ?? 0;
}

export function closeWebSocket(): void {
  wss?.close();
  wss = null;
}
