/**
 * NATS Subscriber for Mission Control Dashboard
 * 
 * Connects to NATS and subscribes to all relevant subjects,
 * feeding messages into the dashboard state manager.
 * 
 * Mission: VM-016
 * Operative: Mira
 */

import { connect, type NatsConnection, StringCodec } from "nats";
import type {
  VALORMessage,
  MissionBrief,
  Sitrep,
  SystemEvent,
  Heartbeat,
  ReviewVerdict,
  CommsMessage,
} from "../types/nats.js";
import { natsState } from "./nats-state.js";

const sc = StringCodec();

/**
 * NATS subscription manager for dashboard
 */
export class NATSSubscriber {
  private nc: NatsConnection | null = null;
  private connected: boolean = false;

  /**
   * Connect to NATS and start subscriptions
   */
  async start(natsUrl: string = "nats://localhost:4222"): Promise<void> {
    if (this.connected) {
      console.log("[NATSSubscriber] Already connected");
      return;
    }

    try {
      console.log(`[NATSSubscriber] Connecting to ${natsUrl}...`);
      this.nc = await connect({ servers: natsUrl });
      this.connected = true;
      console.log("[NATSSubscriber] Connected to NATS");

      // Start all subscriptions
      await Promise.all([
        this.subscribeMissions(),
        this.subscribeSitreps(),
        this.subscribeHeartbeats(),
        this.subscribeSystemEvents(),
        this.subscribeReviewVerdicts(),
        this.subscribeComms(),
      ]);

      console.log("[NATSSubscriber] All subscriptions active");
    } catch (err) {
      console.error("[NATSSubscriber] Connection failed:", err);
      this.connected = false;
      throw err;
    }
  }

  /**
   * Subscribe to valor.missions.*.pending (mission briefs)
   */
  private async subscribeMissions(): Promise<void> {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.missions.*.pending");
    console.log("[NATSSubscriber] Subscribed to valor.missions.*.pending");

    for await (const m of sub) {
      try {
        const msg = JSON.parse(sc.decode(m.data)) as VALORMessage<MissionBrief>;
        natsState.handleMissionBrief(msg);
      } catch (err) {
        console.error("[NATSSubscriber] Error processing mission brief:", err);
      }
    }
  }

  /**
   * Subscribe to valor.sitreps.> (all sitreps)
   */
  private async subscribeSitreps(): Promise<void> {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.sitreps.>");
    console.log("[NATSSubscriber] Subscribed to valor.sitreps.>");

    for await (const m of sub) {
      try {
        const msg = JSON.parse(sc.decode(m.data)) as VALORMessage<Sitrep>;
        natsState.handleSitrep(msg);
      } catch (err) {
        console.error("[NATSSubscriber] Error processing sitrep:", err);
      }
    }
  }

  /**
   * Subscribe to valor.system.heartbeat.* (all heartbeats)
   */
  private async subscribeHeartbeats(): Promise<void> {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.system.heartbeat.*");
    console.log("[NATSSubscriber] Subscribed to valor.system.heartbeat.*");

    for await (const m of sub) {
      try {
        const msg = JSON.parse(sc.decode(m.data)) as VALORMessage<Heartbeat>;
        natsState.handleHeartbeat(msg);
      } catch (err) {
        console.error("[NATSSubscriber] Error processing heartbeat:", err);
      }
    }
  }

  /**
   * Subscribe to valor.system.events (system lifecycle events)
   */
  private async subscribeSystemEvents(): Promise<void> {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.system.events");
    console.log("[NATSSubscriber] Subscribed to valor.system.events");

    for await (const m of sub) {
      try {
        const msg = JSON.parse(sc.decode(m.data)) as VALORMessage<SystemEvent>;
        natsState.handleSystemEvent(msg);
      } catch (err) {
        console.error("[NATSSubscriber] Error processing system event:", err);
      }
    }
  }

  /**
   * Subscribe to valor.review.verdict.* (review verdicts)
   */
  private async subscribeReviewVerdicts(): Promise<void> {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.review.verdict.*");
    console.log("[NATSSubscriber] Subscribed to valor.review.verdict.*");

    for await (const m of sub) {
      try {
        const msg = JSON.parse(sc.decode(m.data)) as VALORMessage<ReviewVerdict>;
        natsState.handleVerdict(msg);
      } catch (err) {
        console.error("[NATSSubscriber] Error processing verdict:", err);
      }
    }
  }

  /**
   * Subscribe to valor.comms.> (all comms)
   */
  private async subscribeComms(): Promise<void> {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.comms.>");
    console.log("[NATSSubscriber] Subscribed to valor.comms.>");

    for await (const m of sub) {
      try {
        const msg = JSON.parse(sc.decode(m.data)) as VALORMessage<CommsMessage>;
        natsState.handleCommsMessage(msg);
      } catch (err) {
        console.error("[NATSSubscriber] Error processing comms message:", err);
      }
    }
  }

  /**
   * Stop all subscriptions and disconnect
   */
  async stop(): Promise<void> {
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      this.connected = false;
      console.log("[NATSSubscriber] Disconnected from NATS");
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Singleton subscriber instance
 */
export const natsSubscriber = new NATSSubscriber();
