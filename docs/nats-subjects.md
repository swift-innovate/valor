# VALOR NATS Subject Schema

**Document:** VM-001  
**Operative:** Crazy-Eddie  
**Status:** COMPLETE  
**Last Updated:** 2026-03-21  
**Reference:** [PHASE-1-NATS.md](./PHASE-1-NATS.md)

This document defines the complete NATS subject hierarchy and message payload schemas for VALOR's Phase 1 nervous system. It is the implementation spec for VM-002 (NATS TypeScript client).

---

## Design Principles

1. **Hierarchical subjects** — dots as separators, readable top-down: `valor.<domain>.<scope>.<target>`
2. **Provider-agnostic payloads** — message formats work with any pub/sub system; NATS is the broker, not the protocol
3. **Operative roster** — designed for: Mira, Crazy-Eddie, Forge, Gage, Zeke, Rook, Herbie, Paladin
4. **Durability where it matters** — missions and verdicts are durable (JetStream); heartbeats and comms are ephemeral (core NATS)

---

## Subject Hierarchy

### 1. Mission Subjects

```
valor.missions.{operative}.pending        # Director → operative: new mission waiting for pickup
valor.missions.{operative}.active         # Operative → all: mission picked up, work starting
valor.missions.{operative}.complete       # Operative → all: mission finished, awaiting review
valor.missions.{operative}.failed         # Operative → all: mission failed, blockers logged
```

**`{operative}`** — lowercase callsign: `mira`, `eddie`, `forge`, `gage`, `zeke`, `rook`, `herbie`, `paladin`

**Examples:**
```
valor.missions.eddie.pending
valor.missions.gage.active
valor.missions.mira.complete
```

---

### 2. Sitrep Subjects

```
valor.sitreps.{mission_id}                # Operative → all: progress update on a specific mission
```

**`{mission_id}`** — e.g. `VM-001`, `VM-042`. Hyphens are valid in NATS subjects.

**Example:**
```
valor.sitreps.VM-001
valor.sitreps.VM-042
```

---

### 3. Review Subjects

```
valor.review.pending                       # Operative → analyst: completed mission queued for review
valor.review.verdict.{mission_id}          # Analyst → all: APPROVE / RETRY / ESCALATE decision
```

**Examples:**
```
valor.review.pending
valor.review.verdict.VM-001
```

---

### 4. Comms Subjects

```
valor.comms.{channel}                      # Group channel: broadcast to all subscribers
valor.comms.direct.{from}.{to}             # 1:1 direct message between operatives
valor.comms.direct.director.{operative}    # Director → specific operative
valor.comms.direct.{operative}.director    # Operative → Director
```

**Reserved channels:**
- `valor.comms.general` — all operatives
- `valor.comms.ops` — operations coordination
- `valor.comms.alerts` — system alerts and escalations

**Examples:**
```
valor.comms.general
valor.comms.direct.eddie.gage
valor.comms.direct.director.mira
```

---

### 5. System Subjects

```
valor.system.heartbeat.{operative}         # Agent-tick → all: periodic health pulse
valor.system.status                        # Request/reply: fleet-wide status query
valor.system.events                        # System lifecycle events (agent online/offline, etc.)
```

**Examples:**
```
valor.system.heartbeat.eddie
valor.system.status
valor.system.events
```

---

## Message Payload Schemas

All messages share a base envelope. Specific message types extend it.

### Base Envelope

```typescript
interface VALORMessage<T = unknown> {
  id: string;              // UUID v4 — unique message identifier
  timestamp: string;       // ISO 8601 UTC — "2026-03-21T14:30:00.000Z"
  source: string;          // Operative callsign or "director"
  type: VALORMessageType;  // Discriminated union tag
  payload: T;
}

type VALORMessageType =
  | "mission.brief"
  | "mission.pickup"
  | "mission.complete"
  | "mission.failed"
  | "sitrep"
  | "review.submission"
  | "review.verdict"
  | "comms.message"
  | "heartbeat"
  | "system.status.request"
  | "system.status.response"
  | "system.event";
```

---

### MissionBrief

_Published to `valor.missions.{operative}.pending` by the Director._

```typescript
interface MissionBrief {
  mission_id: string;          // "VM-001" — unique mission identifier
  title: string;               // Short title: "NATS Subject Schema Design"
  description: string;         // Full task description (markdown supported)
  priority: "P0" | "P1" | "P2" | "P3";
  assigned_to: string;         // Operative callsign: "eddie"
  depends_on: string[];        // Mission IDs that must complete first: ["VM-001"]
  parent_mission: string | null; // Parent mission ID for sub-tasks, or null
  model_tier: "fast" | "standard" | "reasoning";  // Suggested model tier
  acceptance_criteria: string[]; // List of conditions for approval
  context_refs: string[];      // Repo paths or URLs for reference material
  deadline: string | null;     // ISO 8601 or null
  created_at: string;          // ISO 8601
}

// Full message
type MissionBriefMessage = VALORMessage<MissionBrief> & { type: "mission.brief" };
```

**Priority scale:**
- `P0` — Critical, blocks everything
- `P1` — High, blocks other missions
- `P2` — Normal
- `P3` — Low, background work

---

### MissionPickup

_Published to `valor.missions.{operative}.active` by the operative._

```typescript
interface MissionPickup {
  mission_id: string;
  operative: string;           // Callsign confirming pickup
  acknowledged_at: string;     // ISO 8601
  estimated_completion: string | null; // ISO 8601 best estimate, or null
  notes: string | null;        // Any upfront concerns or questions
}

type MissionPickupMessage = VALORMessage<MissionPickup> & { type: "mission.pickup" };
```

---

### Sitrep

_Published to `valor.sitreps.{mission_id}` by the operative during or after work._

```typescript
type SitrepStatus =
  | "ACCEPTED"     // Mission received, not yet started
  | "IN_PROGRESS"  // Actively working
  | "BLOCKED"      // Cannot proceed, needs intervention
  | "COMPLETE"     // Work done, submitting for review
  | "FAILED";      // Unrecoverable failure

interface Sitrep {
  mission_id: string;
  operative: string;
  status: SitrepStatus;
  progress_pct: number;        // 0-100
  summary: string;             // What happened / what was done
  artifacts: SitrepArtifact[]; // Outputs produced
  blockers: string[];          // What is blocking (empty if not BLOCKED)
  next_steps: string[];        // What happens next
  tokens_used: number | null;  // Estimated token consumption, or null
  timestamp: string;           // ISO 8601
}

interface SitrepArtifact {
  type: "file" | "url" | "branch" | "pr" | "note";
  label: string;               // Human-readable: "NATS schema doc"
  ref: string;                 // Path, URL, branch name, PR number, or text
}

type SitrepMessage = VALORMessage<Sitrep> & { type: "sitrep" };
```

---

### ReviewSubmission

_Published to `valor.review.pending` when an operative marks a mission complete._

```typescript
interface ReviewSubmission {
  mission_id: string;
  operative: string;
  completed_at: string;        // ISO 8601
  summary: string;             // What was delivered
  artifacts: SitrepArtifact[]; // Final deliverables
  self_assessment: string | null; // Operative's own notes on quality/risks
}

type ReviewSubmissionMessage = VALORMessage<ReviewSubmission> & { type: "review.submission" };
```

---

### ReviewVerdict

_Published to `valor.review.verdict.{mission_id}` by the analyst._

```typescript
type VerdictDecision = "APPROVE" | "RETRY" | "ESCALATE";

interface ReviewVerdict {
  mission_id: string;
  reviewer: string;            // Analyst callsign or "director"
  decision: VerdictDecision;
  reasoning: string;           // Why this verdict was reached
  issues: string[];            // Specific problems found (empty if APPROVE)
  instructions: string | null; // What to do on RETRY, or null
  escalation_target: string | null; // Who to escalate to, or null
  reviewed_at: string;         // ISO 8601
}

type ReviewVerdictMessage = VALORMessage<ReviewVerdict> & { type: "review.verdict" };
```

---

### Heartbeat

_Published to `valor.system.heartbeat.{operative}` by agent-tick._

```typescript
type HeartbeatStatus = "IDLE" | "BUSY" | "ERROR" | "OFFLINE";

interface Heartbeat {
  operative: string;
  status: HeartbeatStatus;
  current_mission: string | null;  // Active mission_id, or null
  tick_interval_ms: number;        // Current agent-tick interval
  uptime_ms: number;               // Time since agent started
  last_activity: string;           // ISO 8601 — last meaningful action
  metadata: Record<string, unknown> | null; // Optional extra context
}

type HeartbeatMessage = VALORMessage<Heartbeat> & { type: "heartbeat" };
```

---

### CommsMessage

_Published to `valor.comms.*` subjects for agent-to-agent communication._

```typescript
type CommsPriority = "routine" | "priority" | "flash";
type CommsCategory =
  | "task_handoff"
  | "status_update"
  | "request"
  | "response"
  | "escalation"
  | "advisory"
  | "coordination";

interface CommsMessage {
  subject: string;             // Message subject line
  body: string;                // Message body (markdown supported)
  to: string | null;           // Recipient callsign for direct, or null for broadcast
  channel: string | null;      // Channel name for group, or null for direct
  priority: CommsPriority;
  category: CommsCategory;
  thread_id: string | null;    // For threaded replies
  in_reply_to: string | null;  // VALORMessage.id of the message being replied to
}

type CommsMessageEnvelope = VALORMessage<CommsMessage> & { type: "comms.message" };
```

---

### SystemStatusRequest / Response

_Request/reply pattern on `valor.system.status`._

```typescript
interface SystemStatusRequest {
  requested_by: string;
  include_missions: boolean;
}

interface OperativeStatus {
  operative: string;
  heartbeat_status: HeartbeatStatus;
  last_heartbeat: string | null;  // ISO 8601
  current_mission: string | null;
}

interface SystemStatusResponse {
  requested_by: string;
  fleet: OperativeStatus[];
  active_missions: number;
  queued_missions: number;
  timestamp: string;
}
```

---

## JetStream Configuration

JetStream provides durable, at-least-once delivery with persistent storage. Use it for messages that must survive NATS restarts.

### Durable Streams (JetStream)

| Stream Name | Subjects | Retention | Reason |
|-------------|----------|-----------|--------|
| `MISSIONS` | `valor.missions.*.*` | `WorkQueuePolicy` | Missions must not be lost on restart |
| `SITREPS` | `valor.sitreps.*` | `LimitsPolicy` (7 days) | Audit trail, replay for late-joining reviewers |
| `REVIEW` | `valor.review.*` | `LimitsPolicy` (30 days) | Verdicts are records |
| `SYSTEM_EVENTS` | `valor.system.events` | `LimitsPolicy` (24h) | Short-term operational record |

**WorkQueuePolicy** — message is removed after exactly one consumer acknowledges it. Right for mission dispatch: one operative picks up, it's gone from the queue.

**LimitsPolicy** — messages retained until age or count limit. Right for sitreps and verdicts: history is useful, but we don't need forever.

### Ephemeral (Core NATS — no JetStream)

| Subject Pattern | Reason |
|----------------|--------|
| `valor.system.heartbeat.*` | High frequency, no persistence needed — missing one heartbeat is fine |
| `valor.comms.*` | Real-time chat; late subscribers don't need old messages |
| `valor.system.status` | Request/reply; ephemeral by nature |

### Consumer Configuration

```typescript
// JetStream consumer for mission pickup — durable, ack-explicit
const consumer = await js.consumers.get("MISSIONS", {
  durable_name: `mission-consumer-${operative}`,
  filter_subject: `valor.missions.${operative}.pending`,
  ack_policy: AckPolicy.Explicit,
  deliver_policy: DeliverPolicy.All,
  max_deliver: 3,          // Retry up to 3 times before marking as failed
  ack_wait: 30_000,        // 30s to acknowledge before redelivery
});
```

---

## Mission Lifecycle Example

A complete mission from Director dispatch through review, as a sequence of NATS publishes:

```
1. Director publishes MissionBrief
   Subject: valor.missions.eddie.pending
   Payload: { mission_id: "VM-001", title: "NATS Subject Schema Design", ... }

2. Eddie's agent-tick picks up the message, acknowledges to JetStream
   Eddie publishes MissionPickup
   Subject: valor.missions.eddie.active
   Payload: { mission_id: "VM-001", operative: "eddie", acknowledged_at: "..." }

3. Eddie publishes progress sitrep mid-work
   Subject: valor.sitreps.VM-001
   Payload: { status: "IN_PROGRESS", progress_pct: 60, summary: "Schema drafted, examples pending" }

4. Eddie completes work, publishes final sitrep
   Subject: valor.sitreps.VM-001
   Payload: { status: "COMPLETE", progress_pct: 100, artifacts: [{ type: "file", ref: "docs/nats-subjects.md" }] }

5. Eddie publishes to review queue
   Subject: valor.review.pending
   Payload: { mission_id: "VM-001", operative: "eddie", summary: "Schema doc complete. Gage can implement against it." }

6. Analyst (or Director) publishes verdict
   Subject: valor.review.verdict.VM-001
   Payload: { decision: "APPROVE", reasoning: "Schema is comprehensive and implementable." }

7. Mission archived. Board updated.
```

---

## Naming Conventions

| Convention | Rule | Example |
|-----------|------|---------|
| Operatives | Lowercase callsign | `eddie`, `mira`, `gage` |
| Mission IDs | Uppercase with hyphen | `VM-001`, `VM-042` |
| Channels | Lowercase, hyphen-separated | `general`, `ops`, `alerts` |
| Stream names | SCREAMING_SNAKE | `MISSIONS`, `SITREPS` |
| Consumer names | `mission-consumer-{operative}` | `mission-consumer-eddie` |

---

## Wildcard Subscriptions

NATS supports single-token (`*`) and multi-token (`>`) wildcards:

```
valor.missions.*.*          # All mission subjects for all operatives
valor.missions.eddie.*      # All mission states for Eddie only
valor.sitreps.*             # All sitreps for all missions
valor.comms.>               # All comms subjects (group + direct)
valor.system.heartbeat.*    # All operative heartbeats
```

The Director dashboard should subscribe to `valor.>` to receive all VALOR traffic for monitoring.

---

## Subject Index

| Subject | Direction | JetStream | Type |
|---------|-----------|-----------|------|
| `valor.missions.{op}.pending` | Director → operative | ✅ MISSIONS | MissionBrief |
| `valor.missions.{op}.active` | Operative → all | ✅ MISSIONS | MissionPickup |
| `valor.missions.{op}.complete` | Operative → all | ✅ MISSIONS | Sitrep |
| `valor.missions.{op}.failed` | Operative → all | ✅ MISSIONS | Sitrep |
| `valor.sitreps.{mission_id}` | Operative → all | ✅ SITREPS | Sitrep |
| `valor.review.pending` | Operative → analyst | ✅ REVIEW | ReviewSubmission |
| `valor.review.verdict.{mission_id}` | Analyst → all | ✅ REVIEW | ReviewVerdict |
| `valor.comms.{channel}` | Any → subscribers | ❌ ephemeral | CommsMessage |
| `valor.comms.direct.{from}.{to}` | Agent → agent | ❌ ephemeral | CommsMessage |
| `valor.system.heartbeat.{op}` | Agent-tick → all | ❌ ephemeral | Heartbeat |
| `valor.system.status` | Any → all | ❌ ephemeral | StatusRequest/Response |
| `valor.system.events` | System → all | ✅ SYSTEM_EVENTS | SystemEvent |
