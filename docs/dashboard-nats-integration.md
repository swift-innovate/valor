# Dashboard NATS Integration

**Mission:** VM-016  
**Operative:** Mira  
**Status:** COMPLETE  
**Date:** 2026-03-21

---

## Overview

The Mission Control dashboard now displays real-time data from NATS instead of static database queries. All mission updates, operative heartbeats, sitreps, verdicts, and system events flow through NATS and are pushed to the dashboard via Server-Sent Events (SSE).

---

## Architecture

```
NATS Server
    │
    ├─ valor.missions.*.pending ────┐
    ├─ valor.sitreps.> ─────────────┤
    ├─ valor.system.heartbeat.* ────┼──► NATSSubscriber
    ├─ valor.system.events ─────────┤      │
    ├─ valor.review.verdict.* ──────┤      ├──► NATSStateManager (in-memory)
    └─ valor.comms.> ───────────────┘      │
                                            ├──► SSE Endpoint
                                            │        │
                                            │        └──► Dashboard Frontend (EventSource)
                                            └──► Dashboard Pages (query state)
```

### Components

1. **NATSSubscriber** (`src/dashboard/nats-subscriber.ts`)
   - Connects to NATS on startup
   - Subscribes to all relevant subjects
   - Feeds incoming messages into NATSStateManager

2. **NATSStateManager** (`src/dashboard/nats-state.ts`)
   - Maintains in-memory state from NATS messages
   - Provides query interface for dashboard pages
   - Emits events to SSE listeners on state changes

3. **SSE Endpoint** (`src/dashboard/sse.ts`)
   - Server-Sent Events endpoint at `/dashboard/sse`
   - Pushes real-time updates to connected clients
   - Handles connection lifecycle (reconnects, heartbeats)

4. **Live Dashboard Pages**
   - **Overview** (`src/dashboard/pages/overview-live.ts`) — Fleet status, recent missions, activity feed
   - **Missions** (`src/dashboard/pages/missions-live.ts`) — Full mission board with filters

---

## NATS Subjects Subscribed

| Subject | Message Type | Handler |
|---------|-------------|---------|
| `valor.missions.*.pending` | `MissionBrief` | Creates new mission entry |
| `valor.sitreps.>` | `Sitrep` | Updates mission progress/status |
| `valor.system.heartbeat.*` | `Heartbeat` | Updates operative online status |
| `valor.system.events` | `SystemEvent` | Adds to activity feed |
| `valor.review.verdict.*` | `ReviewVerdict` | Records review decisions |
| `valor.comms.>` | `CommsMessage` | Logs inter-agent comms |

---

## State Model

### Missions

```typescript
interface DashboardMission {
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
```

**State transitions:**
- `MissionBrief` received → status: `pending`
- `Sitrep` with status `ACCEPTED` or `IN_PROGRESS` → status: `active`
- `Sitrep` with status `BLOCKED` → status: `blocked`
- `Sitrep` with status `COMPLETE` → status: `complete`
- `Sitrep` with status `FAILED` → status: `failed`

### Operatives

```typescript
interface DashboardOperative {
  callsign: string;
  status: "IDLE" | "BUSY" | "ERROR" | "OFFLINE";
  current_mission: string | null;
  last_heartbeat: string | null;
  uptime_seconds: number;
}
```

**Heartbeat timeout:** 60 seconds. If no heartbeat is received within 60s, operative status automatically changes to `OFFLINE`.

### Events

Activity feed maintains last 100 events:
- Mission dispatched
- Sitreps
- Agent online/offline
- Review verdicts
- System lifecycle

---

## SSE Events

The dashboard SSE endpoint (`/dashboard/sse`) emits the following events:

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{message: string}` | Initial connection confirmation |
| `initial-state` | `{missions, operatives, stats}` | Full state snapshot on connect |
| `mission.updated` | `DashboardMission` | Mission state changed |
| `sitrep.received` | `Sitrep` | New sitrep arrived |
| `operative.updated` | `DashboardOperative` | Operative status changed |
| `operative.offline` | `DashboardOperative` | Operative went offline (heartbeat timeout) |
| `system.event` | `SystemEvent` | System lifecycle event |
| `verdict.received` | `DashboardVerdict` | Review verdict published |
| `comms.received` | `DashboardComms` | Comms message received |
| `event.added` | `DashboardEvent` | Activity feed event added |
| `ping` | `{timestamp: string}` | Keepalive ping (every 30s) |

---

## Client-Side Integration

### Basic EventSource Usage

```javascript
const eventSource = new EventSource('/dashboard/sse');

eventSource.addEventListener('connected', (e) => {
  console.log('Connected:', e.data);
});

eventSource.addEventListener('mission.updated', (e) => {
  const mission = JSON.parse(e.data);
  // Update mission card in DOM
  updateMissionCard(mission);
});

eventSource.addEventListener('operative.updated', (e) => {
  const operative = JSON.parse(e.data);
  // Update operative status indicator
  updateOperativeStatus(operative);
});

eventSource.onerror = (err) => {
  console.error('SSE error:', err);
  // Reconnect logic
};
```

### Auto-Reconnect Pattern

The dashboard pages include auto-reconnect logic:
- Max 5 reconnect attempts
- Exponential backoff (2s, 4s, 6s, 8s, 10s)
- Connection status indicator (green dot = connected, red = disconnected)

---

## Configuration

### Environment Variables

```bash
NATS_URL=nats://localhost:4222  # Default if not set
```

### Server Startup

The NATS subscriber is automatically started when the VALOR engine starts:

```typescript
import { natsSubscriber } from "./dashboard/nats-subscriber.js";
const natsUrl = process.env.NATS_URL || "nats://localhost:4222";
await natsSubscriber.start(natsUrl);
```

If NATS connection fails, the dashboard will still work but will not have real-time updates. A warning is logged:

```
[WARN] NATS subscriber failed to start - dashboard will not have real-time updates
```

---

## Testing

### Manual Testing

1. **Start NATS server:**
   ```bash
   nats-server -c infrastructure/nats.conf
   ```

2. **Start VALOR engine:**
   ```bash
   npm run dev
   ```

3. **Open dashboard:**
   ```
   http://localhost:3200/dashboard
   ```

4. **Publish test messages:**
   ```bash
   # Test mission brief
   nats pub valor.missions.mira.pending '{
     "id": "test-123",
     "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
     "source": "test-publisher",
     "type": "mission.brief",
     "payload": {
       "mission_id": "VM-999",
       "title": "Test Mission",
       "description": "Test mission for dashboard",
       "priority": "P2",
       "assigned_to": "mira",
       "depends_on": [],
       "parent_mission": null,
       "model_tier": "standard",
       "acceptance_criteria": ["Test passes"],
       "context_refs": [],
       "deadline": null,
       "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
     }
   }'

   # Test heartbeat
   nats pub valor.system.heartbeat.mira '{
     "id": "hb-123",
     "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
     "source": "mira",
     "type": "heartbeat",
     "payload": {
       "operative": "mira",
       "status": "BUSY",
       "current_mission": "VM-999",
       "tick_interval_ms": 30000,
       "uptime_seconds": 3600,
       "last_activity": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
     }
   }'

   # Test sitrep
   nats pub valor.sitreps.VM-999 '{
     "id": "sitrep-123",
     "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
     "source": "mira",
     "type": "sitrep",
     "payload": {
       "mission_id": "VM-999",
       "status": "IN_PROGRESS",
       "progress_pct": 50,
       "summary": "Dashboard integration testing in progress",
       "artifacts": ["src/dashboard/sse.ts"],
       "blockers": null,
       "next_steps": ["Commit and push"]
     }
   }'
   ```

5. **Observe real-time updates** in the dashboard (should update within 1 second)

### Integration Testing

Use the existing end-to-end test suite:

```bash
npm test -- tests/integration/e2e-mission-lifecycle.test.ts
```

This test validates the full lifecycle:
- Mission dispatch → NATS
- Operative consumes mission
- Sitreps published
- Dashboard state updated

---

## Performance Considerations

### Memory Usage

- **Missions:** Unbounded (all missions kept in memory)
- **Events:** Last 100 (FIFO queue)
- **Verdicts:** Last 100 (FIFO queue)
- **Comms:** Last 200 (FIFO queue)
- **Operatives:** Fixed (8 operatives from roster)

**Recommendation:** For production deployments with >1000 missions, implement:
1. Mission TTL (auto-expire old completed missions)
2. Paginated mission queries
3. Persistent state store (Redis, PostgreSQL)

### SSE Connection Limits

Each connected dashboard client holds one SSE connection. Modern browsers support 6-8 concurrent connections per domain.

**For high-traffic deployments:**
- Use HTTP/2 (unlimited concurrent streams)
- Add reverse proxy with connection pooling (nginx, Caddy)
- Consider WebSocket fallback for older browsers

---

## Future Enhancements

### Phase 2 (Not Implemented)

- [ ] **Agents page** — Live operative roster with detailed health metrics
- [ ] **Comms page** — Real-time chat-like view of inter-agent comms
- [ ] **Approvals page** — Interactive mission approval workflow
- [ ] **DOM updates without reload** — Update cards in place instead of `location.reload()`
- [ ] **Persistent state** — Redis backing for state manager
- [ ] **Historical queries** — Time-range filters for missions and events
- [ ] **WebSocket fallback** — For browsers without SSE support

---

## Troubleshooting

### Dashboard shows "Disconnected"

**Cause:** NATS subscriber failed to connect or SSE connection dropped.

**Check:**
1. NATS server is running: `nats-server -c infrastructure/nats.conf`
2. NATS_URL is correct in environment
3. Check server logs for connection errors
4. Browser console for SSE errors

### Missions not updating

**Cause:** NATS messages not being published or state manager not handling them.

**Check:**
1. Publish test message manually (see Testing section)
2. Check NATS subscription logs: `[NATSSubscriber] Subscribed to ...`
3. Check state manager logs: `[NATSState] ...`
4. Verify message format matches `src/types/nats.ts` schemas

### Page reloads too frequently

**Cause:** SSE reconnect loop or multiple event listeners.

**Check:**
1. Browser console for reconnect messages
2. Multiple tabs open to same dashboard (each has own SSE connection)
3. NATS connection instability

---

**Mission:** VM-016  
**Operative:** Mira  
**Deliverable:** Dashboard NATS integration  
**Status:** COMPLETE  
**Dependencies:** VM-001 (NATS schema), VM-002 (NATS client)
