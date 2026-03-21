# NATS Server Setup

**Mission:** VM-008
**Last validated:** 2026-03-21

## Quick Start

```bash
# 1. Start nats-server (binary is in infrastructure/bin/)
./infrastructure/bin/nats-server -c infrastructure/nats.conf &

# 2. Run the validation script to create streams and test lifecycle
node --import tsx scripts/validate-nats.ts
```

## Binary

nats-server v2.11.4, downloaded from GitHub releases. Stored at `infrastructure/bin/nats-server` (git-ignored).

To install fresh:
```bash
curl -sL https://github.com/nats-io/nats-server/releases/download/v2.11.4/nats-server-v2.11.4-linux-amd64.tar.gz | tar xz
cp nats-server-v2.11.4-linux-amd64/nats-server infrastructure/bin/
chmod +x infrastructure/bin/nats-server
```

## Configuration

`infrastructure/nats.conf`:
- Listens on `0.0.0.0:4222`
- Max payload: 1MB
- JetStream enabled with data at `./data/jetstream/`
- 256MB memory store, 1GB file store

## JetStream Streams

Created automatically by `ensureStreams()` in `src/nats/streams.ts`:

| Stream | Subjects | Retention | TTL |
|--------|----------|-----------|-----|
| MISSIONS | `valor.missions.*.*` | WorkQueue | - |
| SITREPS | `valor.sitreps.*` | Limits | 7 days |
| REVIEW | `valor.review.>` | Limits | 30 days |
| SYSTEM_EVENTS | `valor.system.events` | Limits | 24h |

## TypeScript Client

All NATS operations go through `src/nats/`:

```typescript
import {
  getNatsConnection,
  ensureStreams,
  publishMissionBrief,
  consumeMissions,
} from "./nats/index.js";

const nc = await getNatsConnection();
await ensureStreams(nc);
```

See `scripts/validate-nats.ts` for a complete usage example covering all message types.

## Ephemeral Subjects (Core NATS)

These do NOT use JetStream — no persistence, no replay:

- `valor.system.heartbeat.*` — agent health pulses
- `valor.comms.*` / `valor.comms.direct.*.*` — real-time chat
- `valor.system.status` — request/reply for fleet status

## Data Directory

`data/jetstream/` — JetStream persistent storage. Git-ignored. Survives NATS restarts.

## Packages

```
@nats-io/transport-node  ^3.3.1  — TCP transport
@nats-io/nats-core        ^3.3.1  — Core NATS types/connection
@nats-io/jetstream         ^3.3.1  — JetStream API
```
