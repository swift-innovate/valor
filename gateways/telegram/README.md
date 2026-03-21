# VALOR Telegram Gateway

**Mission:** VM-014  
**Operative:** Mira  
**Status:** IN PROGRESS (blocked on VM-002)  
**Dependencies:**
- VM-002: NATS TypeScript client module (`src/nats/`)
- NATS server with JetStream enabled
- Telegram bot token

---

## Purpose

The Telegram Gateway bridges Telegram <-> NATS, allowing the Principal (Tom) to:

1. **Dispatch missions** via `/mission` command
2. **Query fleet status** via `/status` command
3. **Ask conversational questions** via `/ask` or free text
4. **Receive real-time sitreps** from operatives
5. **Monitor system events** (agents coming online/offline)

The gateway is a **thin bridge** — it translates between Telegram's API and VALOR's NATS messaging backbone. It does NOT contain business logic. All mission classification, routing, and orchestration happens in the Director.

---

## Architecture

```
Telegram
    │
    ├─ /mission <text> ──────┐
    ├─ /status ───────────┐   │
    ├─ /ask <question> ───│───┼──► NATS
    └─ Free text ─────────┘   │
                              │
    ┌─ valor.sitreps.> ───────┤
    ├─ valor.system.events ───┴──► Telegram
    └─ valor.comms.direct.*
```

### NATS Subjects

**Published by gateway:**
- `valor.missions.inbound` — Raw mission text from Principal
- `valor.system.status` — Request fleet status (request/reply)
- `valor.comms.direct.principal.mira` — Conversational queries

**Subscribed by gateway:**
- `valor.sitreps.>` — All sitreps (wildcard subscription)
- `valor.system.events` — System lifecycle events

---

## Commands

### `/mission <text>`

Dispatch a new mission. Examples:

```
/mission Launch email campaign for new product
/mission Check ranch temperature sensors
/mission Review VALOR architecture and document gaps
```

**Flow:**
1. Gateway publishes `RawMissionInbound` to `valor.missions.inbound`
2. Director classifies and decomposes
3. Director publishes `MissionBrief` to `valor.missions.{operative}.pending`
4. Operative picks up and publishes sitreps
5. Gateway relays sitreps back to Telegram

---

### `/status`

Get current fleet status. Shows:
- Which operatives are online/offline
- What mission each operative is working on
- Active/pending/completed mission counts

**Flow:**
1. Gateway publishes `SystemStatusRequest` to `valor.system.status`
2. Director/System publishes `SystemStatusResponse` (reply)
3. Gateway formats response and sends to Telegram

---

### `/ask <question>`

Ask Mira a conversational question. Examples:

```
/ask What's the status of VM-014?
/ask Who is working on the NATS client module?
/ask Summarize today's completed missions
```

**Flow:**
1. Gateway publishes `CommsMessage` to `valor.comms.direct.principal.mira`
2. Mira processes query
3. Mira publishes response to `valor.comms.direct.mira.principal`
4. Gateway relays response to Telegram

---

### Free Text (no command)

If you send a message without a command prefix, it's routed to Mira as a conversational query (same as `/ask`).

---

## Configuration

Environment variables:

```bash
TELEGRAM_BOT_TOKEN=<your_bot_token>
NATS_URL=nats://localhost:4222
PRINCIPAL_TELEGRAM_ID=<tom_telegram_user_id>
```

**Security note:** The gateway only accepts commands from the configured `PRINCIPAL_TELEGRAM_ID`. All other users are ignored.

---

## Installation & Usage

**Prerequisites:**
- NATS server running with JetStream: `nats-server -c nats.conf`
- VM-002 completed: NATS TypeScript client module exists at `src/nats/`
- Telegram bot created via [@BotFather](https://t.me/BotFather)

**Install dependencies:**

```bash
npm install node-telegram-bot-api
npm install nats
```

**Run gateway:**

```bash
# Set environment variables
export TELEGRAM_BOT_TOKEN=<token>
export NATS_URL=nats://localhost:4222
export PRINCIPAL_TELEGRAM_ID=<tom_id>

# Run gateway
node gateways/telegram/index.js
```

**As a systemd service:**

```ini
[Unit]
Description=VALOR Telegram Gateway
After=network.target nats.service

[Service]
Type=simple
User=valor
WorkingDirectory=/opt/valor
Environment=TELEGRAM_BOT_TOKEN=<token>
Environment=NATS_URL=nats://localhost:4222
Environment=PRINCIPAL_TELEGRAM_ID=<tom_id>
ExecStart=/usr/bin/node gateways/telegram/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## Message Formatting

### Sitrep Format

```
✅ VM-014 — COMPLETE

Telegram gateway NATS bridge implemented. All commands 
routed through NATS. Subscriptions active for sitreps 
and system events.

Progress: 100%

📎 Artifacts:
  • gateways/telegram/index.ts
  • src/types/nats.ts
  • docs/nats-subjects.md (updated)
```

### System Event Format

```
🟢 agent.online: eddie
🔴 agent.offline: gage
❌ agent.error: rook (connection timeout)
```

### Status Format

```
**VALOR Fleet Status**

🟢 **mira**: online (working on VM-014)
🟢 **eddie**: online (working on VM-001)
🔴 **forge**: offline
🔴 **gage**: offline
🟢 **zeke**: online (idle)
```

---

## Development Notes

### Current Status (VM-014)

✅ Gateway structure created  
✅ NATS types defined (`src/types/nats.ts`)  
✅ NATS subject schema updated (`docs/nats-subjects.md`)  
✅ Command handlers scaffolded  
⏸️ **Blocked on VM-002:** NATS client module not yet implemented

All NATS operations are marked with `// TODO:` comments. Once VM-002 is complete:

1. Import `NATSClient` from `src/nats/client.js`
2. Uncomment all `// TODO:` blocks
3. Add Telegram bot library (`node-telegram-bot-api`)
4. Test with live NATS server

### Testing Without NATS

The gateway can be run in "stub mode" (current state) for development. It logs all commands to console but doesn't publish to NATS.

---

## Integration with Director (VM-012)

When the Director is implemented, it should:

1. **Subscribe to `valor.missions.inbound`**
2. **Classify each raw mission** using the Director LLM
3. **Publish `MissionBrief`** messages to appropriate operative queues
4. **Log all routing decisions** as sitreps for transparency

The gateway has NO visibility into classification logic. It's a pure transport layer.

---

## Security Considerations

1. **Principal ID verification:** Only configured Telegram user can issue commands
2. **NATS authentication:** Should add NATS user/password or token auth in production
3. **Message validation:** All inbound messages validated before publishing to NATS
4. **Rate limiting:** Should add rate limits to prevent spam (future enhancement)

---

## Future Enhancements

- [ ] Support multiple Principal users (role-based access)
- [ ] Rich formatting (images, buttons, inline keyboards)
- [ ] Mission progress bars (visual)
- [ ] Artifact attachments (files sent to Telegram)
- [ ] Mission history search (`/history VM-014`)
- [ ] Operative health dashboard (`/health`)
- [ ] Interactive approvals (inline buttons for APPROVE/RETRY/ESCALATE)

---

**Mission:** VM-014  
**Operative:** Mira  
**Date:** 2026-03-21  
**Next:** Unblocked by VM-002 (NATS client module)
