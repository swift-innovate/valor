/**
 * NATS State Manager for Mission Control Dashboard
 * 
 * Subscribes to NATS subjects and maintains real-time state
 * for the Mission Control dashboard.
 * 
 * Mission: VM-016
 * Operative: Mira
 */

import type {
  VALORMessage,
  MissionBrief,
  Sitrep,
  SystemEvent,
  Heartbeat,
  ReviewVerdict,
  CommsMessage,
} from "../types/nats.js";

/**
 * Mission state maintained from NATS subscriptions
 */
export interface DashboardMission {
  mission_id: string;
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  assigned_to: string;
  status: "pending" | "active" | "blocked" | "complete" | "failed";
  progress_pct: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  artifacts: string[];
  blockers: string[];
  latest_sitrep: string | null;
}

/**
 * Operative status maintained from heartbeats
 */
export interface DashboardOperative {
  callsign: string;
  status: "IDLE" | "BUSY" | "ERROR" | "OFFLINE";
  current_mission: string | null;
  last_heartbeat: string | null;
  uptime_seconds: number;
}

/**
 * System event for activity feed
 */
export interface DashboardEvent {
  id: string;
  timestamp: string;
  event_type: string;
  source: string;
  summary: string;
  details: Record<string, unknown>;
}

/**
 * Review verdict
 */
export interface DashboardVerdict {
  mission_id: string;
  decision: "APPROVE" | "RETRY" | "ESCALATE";
  reasoning: string;
  timestamp: string;
}

/**
 * Comms message
 */
export interface DashboardComms {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  priority: string;
  category: string;
}

/**
 * In-memory state maintained from NATS subscriptions
 */
class NATSStateManager {
  // State maps
  private missions: Map<string, DashboardMission> = new Map();
  private operatives: Map<string, DashboardOperative> = new Map();
  private events: DashboardEvent[] = [];
  private verdicts: DashboardVerdict[] = [];
  private comms: DashboardComms[] = [];
  
  // Heartbeat timeout tracking
  private heartbeatTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds

  // Event listeners for real-time updates
  private listeners: Set<(event: string, data: unknown) => void> = new Set();

  constructor() {
    // Initialize with known operatives from roster
    const operatives = ["mira", "eddie", "forge", "gage", "zeke", "rook", "herbie", "paladin"];
    for (const op of operatives) {
      this.operatives.set(op, {
        callsign: op,
        status: "OFFLINE",
        current_mission: null,
        last_heartbeat: null,
        uptime_seconds: 0,
      });
    }
  }

  /**
   * Subscribe to state change events
   */
  subscribe(listener: (event: string, data: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit state change event to all listeners
   */
  private emit(event: string, data: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (err) {
        console.error("[NATSState] Listener error:", err);
      }
    }
  }

  /**
   * Handle incoming MissionBrief (mission dispatched)
   */
  handleMissionBrief(msg: VALORMessage<MissionBrief>): void {
    const brief = msg.payload;
    const mission: DashboardMission = {
      mission_id: brief.mission_id,
      title: brief.title,
      description: brief.description,
      priority: brief.priority,
      assigned_to: brief.assigned_to,
      status: "pending",
      progress_pct: null,
      created_at: brief.created_at,
      started_at: null,
      completed_at: null,
      artifacts: [],
      blockers: [],
      latest_sitrep: null,
    };

    this.missions.set(brief.mission_id, mission);
    this.addEvent({
      id: msg.id,
      timestamp: msg.timestamp,
      event_type: "mission.dispatched",
      source: msg.source,
      summary: `Mission ${brief.mission_id} dispatched to ${brief.assigned_to}`,
      details: { mission_id: brief.mission_id, operative: brief.assigned_to },
    });

    this.emit("mission.updated", mission);
  }

  /**
   * Handle incoming Sitrep (mission progress update)
   */
  handleSitrep(msg: VALORMessage<Sitrep>): void {
    const sitrep = msg.payload;
    let mission = this.missions.get(sitrep.mission_id);

    if (!mission) {
      // Create stub mission from sitrep (happens during hydration or if
      // the dashboard missed the original MissionBrief)
      mission = {
        mission_id: sitrep.mission_id,
        title: sitrep.mission_id,
        description: "",
        priority: "P2",
        assigned_to: sitrep.operative ?? "unknown",
        status: "pending",
        progress_pct: null,
        created_at: msg.timestamp,
        started_at: null,
        completed_at: null,
        artifacts: [],
        blockers: [],
        latest_sitrep: null,
      };
      this.missions.set(sitrep.mission_id, mission);
    }

    // Update mission state from sitrep
    if (sitrep.status === "ACCEPTED" || sitrep.status === "IN_PROGRESS") {
      mission.status = "active";
      if (!mission.started_at) {
        mission.started_at = msg.timestamp;
      }
    } else if (sitrep.status === "BLOCKED") {
      mission.status = "blocked";
    } else if (sitrep.status === "COMPLETE") {
      mission.status = "complete";
      mission.completed_at = msg.timestamp;
      mission.progress_pct = 100;
    } else if (sitrep.status === "FAILED") {
      mission.status = "failed";
      mission.completed_at = msg.timestamp;
    }

    if (sitrep.progress_pct !== null && sitrep.progress_pct !== undefined) {
      mission.progress_pct = sitrep.progress_pct;
    }

    if (sitrep.artifacts) {
      mission.artifacts = sitrep.artifacts;
    }

    if (sitrep.blockers) {
      mission.blockers = sitrep.blockers;
    }

    mission.latest_sitrep = sitrep.summary;

    this.addEvent({
      id: msg.id,
      timestamp: msg.timestamp,
      event_type: "sitrep",
      source: msg.source,
      summary: `${sitrep.mission_id}: ${sitrep.summary}`,
      details: { mission_id: sitrep.mission_id, status: sitrep.status },
    });

    this.emit("mission.updated", mission);
    this.emit("sitrep.received", sitrep);
  }

  /**
   * Handle incoming Heartbeat
   */
  handleHeartbeat(msg: VALORMessage<Heartbeat>): void {
    const hb = msg.payload;
    const operative = this.operatives.get(hb.operative);

    if (!operative) {
      // Unknown operative, create entry
      this.operatives.set(hb.operative, {
        callsign: hb.operative,
        status: hb.status,
        current_mission: hb.current_mission,
        last_heartbeat: msg.timestamp,
        uptime_seconds: hb.uptime_seconds,
      });
    } else {
      // Update existing operative
      operative.status = hb.status;
      operative.current_mission = hb.current_mission;
      operative.last_heartbeat = msg.timestamp;
      operative.uptime_seconds = hb.uptime_seconds;
    }

    // Clear existing timeout and set new one
    const existing = this.heartbeatTimeouts.get(hb.operative);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(() => {
      const op = this.operatives.get(hb.operative);
      if (op) {
        op.status = "OFFLINE";
        this.emit("operative.offline", op);
      }
    }, this.HEARTBEAT_TIMEOUT_MS);

    this.heartbeatTimeouts.set(hb.operative, timeout);

    this.emit("operative.updated", operative || this.operatives.get(hb.operative));
  }

  /**
   * Handle system event
   */
  handleSystemEvent(msg: VALORMessage<SystemEvent>): void {
    const event = msg.payload;
    
    this.addEvent({
      id: msg.id,
      timestamp: msg.timestamp,
      event_type: event.event_type,
      source: msg.source,
      summary: this.formatSystemEventSummary(event),
      details: event.details,
    });

    // Update operative status if it's an agent event
    if (event.event_type === "agent.online" || event.event_type === "agent.offline") {
      const operative = this.operatives.get(event.details.agent as string);
      if (operative) {
        operative.status = event.event_type === "agent.online" ? "IDLE" : "OFFLINE";
        this.emit("operative.updated", operative);
      }
    }

    this.emit("system.event", event);
  }

  /**
   * Handle review verdict
   */
  handleVerdict(msg: VALORMessage<ReviewVerdict>): void {
    const verdict = msg.payload;
    
    const dashboardVerdict: DashboardVerdict = {
      mission_id: verdict.mission_id,
      decision: verdict.decision,
      reasoning: verdict.reasoning,
      timestamp: msg.timestamp,
    };

    this.verdicts.unshift(dashboardVerdict); // Prepend (newest first)
    if (this.verdicts.length > 100) {
      this.verdicts.pop(); // Keep only last 100
    }

    this.addEvent({
      id: msg.id,
      timestamp: msg.timestamp,
      event_type: "review.verdict",
      source: msg.source,
      summary: `${verdict.mission_id}: ${verdict.decision}`,
      details: { mission_id: verdict.mission_id, decision: verdict.decision },
    });

    this.emit("verdict.received", dashboardVerdict);
  }

  /**
   * Handle comms message
   */
  handleCommsMessage(msg: VALORMessage<CommsMessage>): void {
    const comms = msg.payload;

    const dashboardComms: DashboardComms = {
      id: msg.id,
      from: comms.from,
      to: comms.to,
      text: comms.text,
      timestamp: msg.timestamp,
      priority: comms.priority,
      category: comms.category,
    };

    this.comms.unshift(dashboardComms); // Prepend (newest first)
    if (this.comms.length > 200) {
      this.comms.pop(); // Keep only last 200
    }

    this.emit("comms.received", dashboardComms);
  }

  /**
   * Add event to feed
   */
  private addEvent(event: DashboardEvent): void {
    this.events.unshift(event); // Prepend (newest first)
    if (this.events.length > 100) {
      this.events.pop(); // Keep only last 100
    }
    this.emit("event.added", event);
  }

  /**
   * Format system event summary for display
   */
  private formatSystemEventSummary(event: SystemEvent): string {
    switch (event.event_type) {
      case "agent.online":
        return `${event.details.agent} came online`;
      case "agent.offline":
        return `${event.details.agent} went offline`;
      case "agent.error":
        return `${event.details.agent} error: ${event.details.error}`;
      case "system.startup":
        return "VALOR system startup";
      case "system.shutdown":
        return "VALOR system shutdown";
      case "mission.dispatched":
        return `Mission ${event.details.mission_id} dispatched`;
      case "mission.completed":
        return `Mission ${event.details.mission_id} completed`;
      default:
        return event.event_type;
    }
  }

  /**
   * Get all missions
   */
  getMissions(filters?: {
    status?: DashboardMission["status"];
    operative?: string;
  }): DashboardMission[] {
    let missions = Array.from(this.missions.values());
    
    if (filters?.status) {
      missions = missions.filter((m) => m.status === filters.status);
    }
    
    if (filters?.operative) {
      missions = missions.filter((m) => m.assigned_to === filters.operative);
    }

    return missions.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  /**
   * Get mission by ID
   */
  getMission(mission_id: string): DashboardMission | undefined {
    return this.missions.get(mission_id);
  }

  /**
   * Get all operatives
   */
  getOperatives(): DashboardOperative[] {
    return Array.from(this.operatives.values()).sort((a, b) => 
      a.callsign.localeCompare(b.callsign)
    );
  }

  /**
   * Get operative by callsign
   */
  getOperative(callsign: string): DashboardOperative | undefined {
    return this.operatives.get(callsign);
  }

  /**
   * Get recent events
   */
  getEvents(limit: number = 50): DashboardEvent[] {
    return this.events.slice(0, limit);
  }

  /**
   * Get recent verdicts
   */
  getVerdicts(limit: number = 20): DashboardVerdict[] {
    return this.verdicts.slice(0, limit);
  }

  /**
   * Get recent comms
   */
  getComms(limit: number = 50): DashboardComms[] {
    return this.comms.slice(0, limit);
  }

  /**
   * Get fleet statistics
   */
  getStats() {
    const missions = Array.from(this.missions.values());
    const operatives = Array.from(this.operatives.values());

    return {
      missions: {
        total: missions.length,
        pending: missions.filter((m) => m.status === "pending").length,
        active: missions.filter((m) => m.status === "active").length,
        blocked: missions.filter((m) => m.status === "blocked").length,
        complete: missions.filter((m) => m.status === "complete").length,
        failed: missions.filter((m) => m.status === "failed").length,
      },
      operatives: {
        total: operatives.length,
        online: operatives.filter((o) => o.status !== "OFFLINE").length,
        busy: operatives.filter((o) => o.status === "BUSY").length,
        idle: operatives.filter((o) => o.status === "IDLE").length,
        error: operatives.filter((o) => o.status === "ERROR").length,
        offline: operatives.filter((o) => o.status === "OFFLINE").length,
      },
    };
  }

  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.missions.clear();
    this.events.length = 0;
    this.verdicts.length = 0;
    this.comms.length = 0;
    
    // Clear heartbeat timeouts
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.heartbeatTimeouts.clear();

    // Reset operatives to offline
    for (const op of this.operatives.values()) {
      op.status = "OFFLINE";
      op.current_mission = null;
      op.last_heartbeat = null;
      op.uptime_seconds = 0;
    }
  }
}

/**
 * Singleton state manager instance
 */
export const natsState = new NATSStateManager();
