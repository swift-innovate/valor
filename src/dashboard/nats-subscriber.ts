/**
 * NATS Subscriber for Mission Control Dashboard
 *
 * Connects to NATS and subscribes to all relevant subjects,
 * feeding messages into the dashboard state manager.
 *
 * Mission: VM-016
 * Operative: Mira
 */

import { getNatsConnection, closeNatsConnection } from "../nats/index.js";
import type { NatsConnection, Subscription, Msg } from "@nats-io/nats-core";
import { jetstream, DeliverPolicy } from "@nats-io/jetstream";
import type {
  VALORMessage,
  MissionBrief,
  SystemEvent,
  Heartbeat,
  ReviewVerdict,
  CommsMessage,
} from "../types/nats.js";
import type { NatsSitrep } from "../nats/index.js";
import { STREAM_NAMES } from "../nats/types.js";
import { natsState } from "./nats-state.js";
import { getMission, transitionMission } from "../db/repositories/mission-repo.js";
import type { MissionStatus } from "../types/mission.js";
import { logger } from "../utils/logger.js";

function decode<T>(msg: Msg): VALORMessage<T> {
  return JSON.parse(new TextDecoder().decode(msg.data)) as VALORMessage<T>;
}

/**
 * NATS subscription manager for dashboard
 */
export class NATSSubscriber {
  private nc: NatsConnection | null = null;
  private connected: boolean = false;
  private subs: Subscription[] = [];

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
      this.nc = await getNatsConnection({
        servers: [natsUrl],
        name: "dashboard-subscriber",
      });
      this.connected = true;
      console.log("[NATSSubscriber] Connected to NATS");

      // Hydrate state from JetStream history before subscribing to live
      await this.hydrateFromJetStream();

      // Start all subscriptions for live updates
      this.subscribeMissions();
      this.subscribeSitreps();
      this.subscribeHeartbeats();
      this.subscribeSystemEvents();
      this.subscribeReviewVerdicts();
      this.subscribeComms();

      console.log("[NATSSubscriber] All subscriptions active");
    } catch (err) {
      console.error("[NATSSubscriber] Connection failed:", err);
      this.connected = false;
      throw err;
    }
  }

  /**
   * Replay SITREPS stream from JetStream to hydrate dashboard state
   * with missions that were dispatched before the dashboard started.
   * Uses an ordered consumer (ephemeral, auto-cleaned) to replay all messages.
   */
  private async hydrateFromJetStream(): Promise<void> {
    if (!this.nc) return;

    try {
      const js = jetstream(this.nc);

      // 1. Replay mission briefs first so missions have correct assigned_to/title
      try {
        const briefConsumer = await js.consumers.get(STREAM_NAMES.MISSIONS, {
          deliver_policy: DeliverPolicy.All,
        });
        let briefCount = 0;
        const briefIter = await briefConsumer.fetch({ max_messages: 1000, expires: 3000 });
        for await (const msg of briefIter) {
          try {
            const envelope = JSON.parse(
              new TextDecoder().decode(msg.data),
            ) as VALORMessage<MissionBrief>;
            if (envelope.type === "mission.brief") {
              natsState.handleMissionBrief(envelope);
              briefCount++;
            }
          } catch {
            // Skip unparseable
          }
        }
        console.log(`[NATSSubscriber] Hydrated ${briefCount} mission briefs from JetStream`);
      } catch (err) {
        console.warn("[NATSSubscriber] Mission brief hydration failed:", err instanceof Error ? err.message : err);
      }

      // 2. Replay sitreps to restore status/progress on top of the briefs
      const consumer = await js.consumers.get(STREAM_NAMES.SITREPS, {
        deliver_policy: DeliverPolicy.All,
      });

      let count = 0;
      const iter = await consumer.fetch({ max_messages: 1000, expires: 3000 });

      for await (const msg of iter) {
        try {
          const envelope = JSON.parse(
            new TextDecoder().decode(msg.data),
          ) as VALORMessage<NatsSitrep>;
          natsState.handleSitrep(envelope);
          count++;
        } catch {
          // Skip unparseable messages
        }
      }

      console.log(`[NATSSubscriber] Hydrated ${count} sitreps from JetStream`);
    } catch (err) {
      // Non-fatal — dashboard just won't have history
      console.warn(
        "[NATSSubscriber] JetStream hydration failed (dashboard will only show new missions):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Subscribe to valor.missions.*.pending (mission briefs)
   */
  private subscribeMissions(): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.missions.*.pending", {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          natsState.handleMissionBrief(decode<MissionBrief>(msg));
        } catch (err) {
          console.error("[NATSSubscriber] Error processing mission brief:", err);
        }
      },
    });
    this.subs.push(sub);
    console.log("[NATSSubscriber] Subscribed to valor.missions.*.pending");
  }

  /**
   * Subscribe to valor.sitreps.> (all sitreps)
   */
  private subscribeSitreps(): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.sitreps.>", {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          const envelope = decode<NatsSitrep>(msg);
          natsState.handleSitrep(envelope);
          this.syncSitrepToDb(envelope.payload);
        } catch (err) {
          console.error("[NATSSubscriber] Error processing sitrep:", err);
        }
      },
    });
    this.subs.push(sub);
    console.log("[NATSSubscriber] Subscribed to valor.sitreps.>");
  }

  /**
   * Sync a live sitrep to the DB mission record, if one exists.
   * Non-fatal — natsState is the source of truth for the dashboard.
   * Not called during JetStream hydration to avoid spurious transitions.
   */
  private syncSitrepToDb(sitrep: NatsSitrep): void {
    const mission = getMission(sitrep.mission_id);
    if (!mission) return; // No DB record for this mission — skip silently

    let targetStatus: MissionStatus | null = null;
    switch (sitrep.status) {
      case "ACCEPTED":
      case "IN_PROGRESS":
        if (mission.status === "dispatched") targetStatus = "streaming";
        break;
      case "COMPLETE":
        if (mission.status === "streaming" || mission.status === "dispatched") targetStatus = "complete";
        break;
      case "FAILED":
        if (mission.status === "streaming" || mission.status === "dispatched") targetStatus = "failed";
        break;
      // BLOCKED has no direct DB mapping — leave status unchanged
    }

    if (!targetStatus) return;

    try {
      transitionMission(sitrep.mission_id, targetStatus);
      logger.debug("DB mission status synced from sitrep", {
        mission_id: sitrep.mission_id,
        sitrep_status: sitrep.status,
        db_status: targetStatus,
      });
    } catch (err) {
      // Non-fatal — natsState is the source of truth for the dashboard
      logger.warn("Failed to sync sitrep to DB", {
        mission_id: sitrep.mission_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Subscribe to valor.system.heartbeat.* (all heartbeats)
   */
  private subscribeHeartbeats(): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.system.heartbeat.*", {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          natsState.handleHeartbeat(decode<Heartbeat>(msg));
        } catch (err) {
          console.error("[NATSSubscriber] Error processing heartbeat:", err);
        }
      },
    });
    this.subs.push(sub);
    console.log("[NATSSubscriber] Subscribed to valor.system.heartbeat.*");
  }

  /**
   * Subscribe to valor.system.events (system lifecycle events)
   */
  private subscribeSystemEvents(): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.system.events", {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          natsState.handleSystemEvent(decode<SystemEvent>(msg));
        } catch (err) {
          console.error("[NATSSubscriber] Error processing system event:", err);
        }
      },
    });
    this.subs.push(sub);
    console.log("[NATSSubscriber] Subscribed to valor.system.events");
  }

  /**
   * Subscribe to valor.review.verdict.* (review verdicts)
   */
  private subscribeReviewVerdicts(): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.review.verdict.*", {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          natsState.handleVerdict(decode<ReviewVerdict>(msg));
        } catch (err) {
          console.error("[NATSSubscriber] Error processing verdict:", err);
        }
      },
    });
    this.subs.push(sub);
    console.log("[NATSSubscriber] Subscribed to valor.review.verdict.*");
  }

  /**
   * Subscribe to valor.comms.> (all comms)
   */
  private subscribeComms(): void {
    if (!this.nc) return;

    const sub = this.nc.subscribe("valor.comms.>", {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          natsState.handleCommsMessage(decode<CommsMessage>(msg));
        } catch (err) {
          console.error("[NATSSubscriber] Error processing comms message:", err);
        }
      },
    });
    this.subs.push(sub);
    console.log("[NATSSubscriber] Subscribed to valor.comms.>");
  }

  /**
   * Stop all subscriptions and disconnect
   */
  async stop(): Promise<void> {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    this.subs = [];

    if (this.nc) {
      await closeNatsConnection();
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
