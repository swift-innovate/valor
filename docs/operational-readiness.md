# VALOR Operational Readiness Checklist

**Mission:** VM-019  
**Operative:** Mira  
**Status:** DRAFT  
**Last Updated:** 2026-03-21  
**Question:** Is VALOR ready for Tom to use as his daily command system?

---

## Executive Summary

**Short answer:** No. VALOR is in Phase 1 development with core infrastructure built but not yet integrated end-to-end.

**Current state:**
- ✅ **VALOR Command Dashboard** — Running, accessible at http://localhost:3003
- ✅ **NATS Infrastructure** — Server binary present, TypeScript client implemented
- ✅ **Director System Prompt** — Assembled and validated
- ✅ **Telegram Gateway** — NATS bridge implemented
- ✅ **Analyst Review Loop** — Multi-model verdict system built
- ⚠️ **Integration** — Components built but not wired together in production
- ❌ **Director LLM** — Not yet running as active service
- ❌ **Agent-Tick NATS Consumer** — Template exists, not deployed to agents
- ❌ **End-to-End Flow** — Never tested with real mission dispatch

**Gap to production:** 2-4 weeks of integration work + testing before daily use is realistic.

---

## 1. Startup Procedure

### Current Services (mirapc workstation)

| Service | Host | Port | Status | Start Command |
|---------|------|------|--------|---------------|
| **VALOR Command Dashboard** | mirapc | 3003 | ✅ Running (systemd) | `systemctl --user start valor-command` |
| **NATS Server** | mirapc | 4222 | ❌ Not running | Manual start (see below) |
| **Director LLM** | N/A | — | ❌ Not implemented | Not built yet |
| **Ollama** | citadel | 11434 | ✅ Running | Already running on citadel |
| **Telegram Gateway** | N/A | — | ❌ Not running | Not deployed yet |

### ⚠️ Critical Gap: No Startup Script

There is no single command to start VALOR. Each component must be started manually.

### Startup Sequence (Manual, Current State)

```bash
# 1. Start NATS Server
cd ~/.openclaw/workspace/sit/projects/valor
./infrastructure/bin/nats-server -c infrastructure/nats.conf &

# 2. Verify NATS is running
# (No health check script exists — must check manually)
ps aux | grep nats-server

# 3. VALOR Command Dashboard (already running via systemd)
systemctl --user status valor-command

# 4. Director LLM (not implemented)
# Would be: pnpm run director (or similar)

# 5. Telegram Gateway (not deployed)
# Would be: pnpm run telegram-gateway (or similar)
```

### What's Missing

- [ ] **Systemd service for NATS** — NATS runs ad-hoc, doesn't survive reboots
- [ ] **Director service** — No executable to start
- [ ] **Telegram gateway service** — Built but not deployed
- [ ] **Health check endpoint** — No `/health` API to verify all services
- [ ] **Single startup script** — No `scripts/start-valor.sh` or equivalent
- [ ] **Dependency ordering** — No guarantee NATS starts before Director

### Ideal Startup (Future State)

```bash
# Single command:
scripts/start-valor.sh

# Or via systemd:
systemctl --user start valor.target
```

**Target:** All services orchestrated via systemd `.target` with proper dependencies.

---

## 2. Health Verification

### How to Verify VALOR is Working (Current State)

**Step 1: Check VALOR Command Dashboard**
```bash
# Service status
systemctl --user status valor-command

# Expected: "active (running)"
# Dashboard: http://localhost:3003
```

**Dashboard should show:**
- Mission board (currently demo data)
- Navigation between Overview/Missions/Operatives/Decisions
- No connection errors

**Step 2: Check NATS Server**
```bash
# Process check
ps aux | grep nats-server

# Expected: nats-server process running
# Port check
nc -zv localhost 4222

# Expected: "Connection to localhost 4222 port [tcp/*] succeeded!"
```

**Step 3: Verify JetStream Streams**
```bash
cd ~/.openclaw/workspace/sit/projects/valor
node --import tsx scripts/validate-nats.ts
```

**Expected output:**
```
✓ NATS connected
✓ Stream MISSIONS created
✓ Stream SITREPS created
✓ Stream REVIEW created
✓ Stream SYSTEM_EVENTS created
✓ 27/27 validation tests passed
```

### What a Healthy System Looks Like

**In the Dashboard:**
- [ ] Live mission updates (real missions, not demo data)
- [ ] Operative heartbeats showing in real-time
- [ ] Sitrep feed populating
- [ ] No "Disconnected" or error states

**In NATS:**
- [ ] 4 JetStream streams created (MISSIONS, SITREPS, REVIEW, SYSTEM_EVENTS)
- [ ] Messages flowing through subjects
- [ ] No consumer lag warnings

**Heartbeat Intervals (Design Intent):**
- **Agent-tick:** 30-second heartbeats per operative
- **Director:** No heartbeat defined yet
- **NATS:** Built-in cluster heartbeat (n/a for single-node)

### First Command to Test Pipeline (Future State)

```
Tom (Telegram): /mission Deploy the Fracture Code email campaign

Expected flow:
1. Telegram Gateway receives command
2. Director classifies → routes to Eddie
3. NATS publishes to valor.missions.eddie.pending
4. Eddie's agent-tick picks up mission
5. Eddie publishes sitrep (ACCEPTED)
6. Telegram relays sitrep back to Tom
```

**Current reality:** This flow is not yet wired. Director LLM doesn't exist, agent-tick NATS consumer isn't deployed.

---

## 3. Known Gaps

### What's NOT Wired Up Yet

| Component | Status | Impact |
|-----------|--------|--------|
| **Director LLM Service** | ❌ Not built | Cannot route missions automatically |
| **Gage Autonomous Mode** | ❌ Blocked (Claude capabilities) | Code Division Lead can't operate |
| **Engram Integration** | ❌ Not started | No cross-mission memory |
| **Herd Pro Routing** | ❌ N/A | Using basic Ollama (works fine) |
| **Multi-Division Support** | ❌ Not built | Only single-division mode works |
| **Cross-Division Access Controls** | ❌ Not built | Black Division isolation doesn't exist yet |
| **VECTOR Checkpoint Integration** | ❌ Not built | Decision layer not wired to missions |
| **Operative Fleet** | ⚠️ Partial | Only Eddie/Mira tested, others not deployed |
| **Production NATS Deployment** | ❌ Manual only | No systemd service, no auto-restart |

### What's Fragile or Might Break

**NATS Persistence:**
- ✅ JetStream enabled — missions persist across restarts
- ❌ No monitoring — if NATS crashes silently, missions queue invisibly
- ❌ No alert system — Tom won't know NATS is down

**Dashboard Connection:**
- ⚠️ Dashboard polls backend every 5 seconds
- ❌ No WebSocket/SSE real-time updates yet (VM-016 built SSE, not deployed)
- Impact: 5-second lag on mission updates

**Agent-Tick Consumer:**
- ⚠️ Template exists but not deployed to any agents
- Impact: No operative can pick up missions from NATS yet

**Director Routing:**
- ❌ No Director service exists
- Impact: Tom must manually route missions (no `/mission` command works)

### Recovery Scenarios

**If NATS goes down:**
```bash
# Current: Manual restart required
cd ~/.openclaw/workspace/sit/projects/valor
./infrastructure/bin/nats-server -c infrastructure/nats.conf &

# JetStream streams auto-recover (data persists)
# Queued missions are delivered when consumer reconnects
```

**Does it auto-recover?** ❌ No. NATS must be manually restarted.

**If Ollama isn't running on CITADEL:**
```bash
# Check Ollama status
ssh citadel "systemctl status ollama"

# Restart if needed
ssh citadel "systemctl restart ollama"
```

**Impact:** Director can't classify/route. Manual intervention required.

**If Dashboard crashes:**
```bash
# Systemd auto-restarts
systemctl --user status valor-command

# If service is dead:
systemctl --user restart valor-command
```

**Impact:** UI unavailable, but backend operations continue (NATS is independent).

---

## 4. Day-One Workflow

### Scenario: Tom Wakes Up Monday Morning, Wants to Use VALOR for His Workday

**Realistic Walkthrough (Current State):**

#### Step 1: Boot VALOR
```bash
# Tom's workstation (mirapc)
ssh mirapc

# Start NATS manually
cd ~/.openclaw/workspace/sit/projects/valor
./infrastructure/bin/nats-server -c infrastructure/nats.conf &

# Verify services
systemctl --user status valor-command
ps aux | grep nats-server
```

**Time:** 2-3 minutes  
**Friction:** Manual start, no health check

#### Step 2: Open Dashboard
```
Browser: http://localhost:3003
```

**What Tom sees:** Mission board (demo data), no real missions yet.

**Friction:** Demo data clutters view, unclear what's real vs. test.

#### Step 3: Create First Mission

**Current method (manual):**
```bash
# Tom SSHs into Eddie's workspace
ssh eddie@tailscale-ip

# Manually creates mission/VM-020 branch
cd ~/.openclaw/agents/eddie/workspace/sit/projects/
git checkout -b mission/VM-020

# Writes mission brief in README.md
# Eddie works, commits, pushes
```

**Time:** 5-10 minutes per mission  
**Friction:** No `/mission` command, no automatic routing, Tom must manually assign

**Desired future state (Phase 1 complete):**
```
Telegram:
/mission Launch Fracture Code email campaign

Director:
✓ Mission VM-020 dispatched to Eddie
✓ Eddie accepted VM-020
[5 minutes later]
✓ Eddie: Draft ready for review
```

**Time:** 30 seconds to dispatch, work happens async  
**Friction:** Near zero

#### Step 4: Monitor Progress

**Current:**
```bash
# Tom checks git manually
cd ~/.openclaw/workspace/sit/projects/
git log --oneline --graph --all

# Or checks dashboard (shows demo data)
```

**Time:** 2-3 minutes per check  
**Friction:** No real-time visibility

**Desired future state:**
```
Dashboard:
- Eddie (IN_PROGRESS) | VM-020 | 60% | Last update: 2 minutes ago
- Live sitrep feed scrolling

Telegram:
[Eddie] VM-020: Email draft complete, artifacts ready
```

**Time:** Passive monitoring, zero active effort  
**Friction:** None

#### Step 5: Review Results

**Current:**
```bash
# Tom reviews Eddie's PR manually
cd ~/sit/projects/fracture-code
git diff main...mission/VM-020

# Approves and merges
git merge mission/VM-020
```

**Time:** 5-15 minutes  
**Friction:** Manual review, no analyst involvement

**Desired future state:**
```
Analyst agent:
✓ VM-020 review complete
✓ Verdict: APPROVE
✓ Artifacts validated, acceptance criteria met

Dashboard:
[Approve] [Request Changes] buttons

Tom clicks Approve → Mission closes
```

**Time:** 2-minute review  
**Friction:** Near zero

### Current Reality vs. Vision

| Activity | Current Time | Vision Time | Gap |
|----------|-------------|-------------|-----|
| **Boot VALOR** | 2-3 min (manual) | 10 sec (systemd) | No startup automation |
| **Create Mission** | 5-10 min (manual git) | 30 sec (Telegram) | No Director LLM |
| **Monitor Progress** | 2-3 min per check (manual) | 0 min (passive feed) | No real-time sitreps |
| **Review Results** | 5-15 min (manual PR) | 2 min (analyst verdict) | No analyst deployed |
| **Total for 1 mission** | ~15-30 min active effort | ~3 min active effort | **80-90% reduction blocked on integration** |

---

## 5. Backup and Recovery

### NATS Data Persistence

**Is NATS data persistent?**  
✅ Yes — JetStream enabled with file-based storage.

**Where?**
```bash
~/.openclaw/workspace/sit/projects/valor/data/jetstream/
```

**Contents:**
- JetStream stream metadata
- Queued messages (missions not yet consumed)
- Consumer state (last acknowledged message per subscriber)

**What happens on reboot?**
- ✅ JetStream data survives
- ✅ Streams auto-recreate on first client connection
- ⚠️ NATS server must be manually restarted (no systemd service)
- ⚠️ Consumers must reconnect (agents must poll or be notified)

### Recovery Scenarios

**Scenario 1: NATS server crashes**
```bash
# Check process
ps aux | grep nats-server

# Restart manually
cd ~/.openclaw/workspace/sit/projects/valor
./infrastructure/bin/nats-server -c infrastructure/nats.conf &

# Verify streams
node --import tsx scripts/validate-nats.ts
```

**Data loss:** ❌ None — JetStream persists messages to disk

**Scenario 2: Mission stuck in queue**
```bash
# Inspect stream
node --import tsx scripts/inspect-stream.ts MISSIONS

# Expected: List of pending messages
# Manual resolution: Republish or consume via CLI
```

**Recovery tool:** ❌ Not built yet

**Scenario 3: Dashboard shows stale data**
```bash
# Restart dashboard service
systemctl --user restart valor-command

# Check browser cache
Ctrl+Shift+R (hard refresh)
```

**Data loss:** ❌ None — backend state is in NATS

**Scenario 4: Complete workstation failure**

**Current backup strategy:** ❌ None

**What's backed up:**
- ✅ Git repos (if pushed to GitHub)
- ❌ JetStream data (local only, not backed up)
- ❌ Agent workspace files (local only)
- ❌ Dashboard database (if it exists)

**Recovery:**
1. Rebuild workstation
2. Clone VALOR repo
3. Reinstall NATS binary
4. Restart services
5. **All queued missions are lost** — no backup of JetStream data

**Recommended backup:**
```bash
# Add to daily cron
tar -czf ~/backups/valor-$(date +%Y%m%d).tar.gz \
  ~/.openclaw/workspace/sit/projects/valor/data/jetstream/

# Retain 7 days of backups
find ~/backups/valor-*.tar.gz -mtime +7 -delete
```

---

## 6. Migration Plan: Workstation → Proxmox VM

### Current Deployment

**Host:** mirapc (Tom's workstation)  
**Services:**
- VALOR Command Dashboard (systemd user service)
- NATS server (ad-hoc process)
- Director LLM (not running)

**Problems with current deployment:**
- ⚠️ Tied to Tom's workstation — can't use VALOR when workstation is off
- ⚠️ Shares resources with desktop apps — potential performance interference
- ⚠️ No network isolation — all services on workstation's Tailscale IP

### Target Deployment

**Host:** New Proxmox Linux VM  
**Spec:**
- 4 vCPU
- 8GB RAM
- 40GB disk
- Ubuntu 24.04 LTS
- Tailscale connected

**Services:**
- NATS server (systemd service)
- VALOR Command Dashboard (systemd service)
- Director LLM (systemd service)
- Telegram Gateway (systemd service)
- Nginx reverse proxy (for dashboard HTTPS)

### Migration Checklist

#### Pre-Migration

- [ ] **Provision Proxmox VM**
  - Create VM via Proxmox UI or Terraform
  - Install Ubuntu 24.04 LTS
  - Configure Tailscale
  - Set hostname: `valor-vm`

- [ ] **Install Dependencies**
  ```bash
  # On valor-vm
  sudo apt update && sudo apt install -y nodejs npm git curl
  npm install -g pnpm
  ```

- [ ] **Clone VALOR Repo**
  ```bash
  git clone https://github.com/swift-innovate/valor.git /opt/valor
  cd /opt/valor
  pnpm install
  ```

- [ ] **Install NATS Server**
  ```bash
  curl -sL https://github.com/nats-io/nats-server/releases/download/v2.11.4/nats-server-v2.11.4-linux-amd64.tar.gz | tar xz
  sudo mv nats-server-v2.11.4-linux-amd64/nats-server /usr/local/bin/
  sudo chmod +x /usr/local/bin/nats-server
  ```

#### Migration Steps

1. **Stop Services on Workstation**
   ```bash
   # On mirapc
   systemctl --user stop valor-command
   pkill nats-server
   ```

2. **Backup JetStream Data**
   ```bash
   cd ~/.openclaw/workspace/sit/projects/valor
   tar -czf ~/valor-jetstream-backup.tar.gz data/jetstream/
   scp ~/valor-jetstream-backup.tar.gz valor-vm:/tmp/
   ```

3. **Restore on VM**
   ```bash
   # On valor-vm
   cd /opt/valor
   tar -xzf /tmp/valor-jetstream-backup.tar.gz
   ```

4. **Create Systemd Services**

   **NATS Server:**
   ```ini
   # /etc/systemd/system/nats.service
   [Unit]
   Description=NATS Server
   After=network.target

   [Service]
   Type=simple
   User=valor
   WorkingDirectory=/opt/valor
   ExecStart=/usr/local/bin/nats-server -c /opt/valor/infrastructure/nats.conf
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   **VALOR Dashboard:**
   ```ini
   # /etc/systemd/system/valor-dashboard.service
   [Unit]
   Description=VALOR Command Dashboard
   After=nats.service
   Requires=nats.service

   [Service]
   Type=simple
   User=valor
   WorkingDirectory=/opt/valor/projects/valor-command
   ExecStart=/usr/bin/pnpm run dev
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   **Director LLM (when built):**
   ```ini
   # /etc/systemd/system/valor-director.service
   [Unit]
   Description=VALOR Director LLM
   After=nats.service
   Requires=nats.service

   [Service]
   Type=simple
   User=valor
   WorkingDirectory=/opt/valor
   ExecStart=/usr/bin/pnpm run director
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

5. **Enable and Start Services**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable nats valor-dashboard valor-director
   sudo systemctl start nats valor-dashboard valor-director
   ```

6. **Verify Migration**
   ```bash
   # Check all services
   systemctl status nats valor-dashboard valor-director

   # Test NATS
   cd /opt/valor
   node --import tsx scripts/validate-nats.ts

   # Access dashboard
   # http://valor-vm.tailscale-name:3003
   ```

7. **Update Telegram Gateway Config**
   ```bash
   # Point gateway to new NATS address
   VALOR_NATS_URL=nats://valor-vm.tailscale-name:4222
   ```

8. **Cutover**
   - Update DNS/bookmarks to point to valor-vm:3003
   - Announce in Telegram: "VALOR now running on dedicated VM"
   - Monitor for 24 hours

#### Post-Migration

- [ ] **Backup Strategy**
  - Daily cron: Backup JetStream data to NAS/S3
  - Weekly cron: Full VM snapshot via Proxmox
  - Retention: 7 daily, 4 weekly

- [ ] **Monitoring**
  - Add systemd service monitoring
  - Alert on service failures (email/Telegram)
  - Dashboard for VM metrics (CPU/RAM/disk)

- [ ] **Decommission Workstation Services**
  - Remove systemd user service for valor-command
  - Clean up workspace files (optional)

### Migration Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **VM provisioning delay** | Can't start migration | Provision VM in advance, test connectivity |
| **JetStream data corruption during transfer** | Lost queued missions | Verify backup integrity before cutover |
| **Systemd service failures** | Services don't auto-start | Test services before cutover, manual fallback |
| **Tailscale connectivity issues** | Can't access VALOR VM | Fallback to local network access during migration |
| **Ollama on citadel unreachable from VM** | Director can't route | Verify Tailscale mesh before migration |

### Estimated Migration Time

- **Provisioning + setup:** 2-3 hours
- **Data migration:** 30 minutes
- **Service configuration:** 1-2 hours
- **Testing + validation:** 1 hour
- **Total:** 4-7 hours

**Recommendation:** Migrate on a weekend or after-hours to minimize disruption.

---

## 7. Outstanding Issues

### Issues from Completed Missions (VM-001 to VM-016)

#### VM-002: NATS Client Module
- ⚠️ **Connection retry logic not tested under network failure**
  - Impact: If NATS server restarts, clients may not reconnect gracefully
  - Fix: Add integration tests for reconnection scenarios

- ⚠️ **No consumer lag monitoring**
  - Impact: Can't detect if consumers are falling behind on message processing
  - Fix: Add JetStream consumer info API wrapper

#### VM-006: Director System Prompt
- ⚠️ **Prompt hasn't been tested with real missions**
  - Impact: Unknown if Director will route correctly in production
  - Fix: Run benchmark suite with real mission examples

- ⚠️ **No confidence threshold tuning**
  - Impact: Gear 1 → Gear 2 escalation may trigger too often or not enough
  - Fix: Collect metrics from production use, tune threshold

#### VM-008: NATS Deployment
- ❌ **No systemd service for NATS**
  - Impact: NATS must be manually started after every reboot
  - Fix: Create `nats.service` systemd unit

- ❌ **No monitoring for NATS health**
  - Impact: If NATS crashes, Tom won't know until missions fail
  - Fix: Add health check endpoint, integrate with monitoring

- ⚠️ **Single point of failure**
  - Impact: If NATS goes down, entire VALOR system is offline
  - Fix: Phase 2 — clustered NATS deployment

#### VM-013: Agent-Tick NATS Consumer
- ⚠️ **Template not deployed to any agents yet**
  - Impact: No operative can consume missions from NATS
  - Fix: Deploy to Mira/Eddie, test end-to-end

- ❌ **No dead letter queue for failed messages**
  - Impact: If a mission can't be processed, it's silently dropped
  - Fix: Add DLQ stream for error handling

#### VM-014: Telegram Gateway
- ⚠️ **Not running as a service**
  - Impact: Gateway must be manually started
  - Fix: Create systemd service, deploy

- ❌ **No authentication**
  - Impact: Anyone who knows the bot token can dispatch missions
  - Fix: Add chat ID allowlist

#### VM-015: Analyst Agent
- ⚠️ **Review criteria are hard-coded**
  - Impact: Can't adjust what triggers APPROVE vs. RETRY
  - Fix: Make criteria configurable per mission type

- ⚠️ **No appeal process**
  - Impact: If analyst incorrectly rejects work, no recourse
  - Fix: Add "Request Human Review" escalation path

#### VM-016: Dashboard NATS Integration
- ⚠️ **SSE endpoint built but not deployed to dashboard**
  - Impact: Dashboard still uses polling, 5-second lag
  - Fix: Wire SSE endpoint into dashboard frontend

- ❌ **No authentication on SSE endpoint**
  - Impact: Anyone can subscribe to live mission feed
  - Fix: Add Bearer token auth

### Cross-Cutting Issues

#### No End-to-End Integration Tests
- Impact: Individual components work, but full pipeline untested
- Fix: Create `scripts/e2e-test.sh` that simulates complete mission lifecycle

#### No Observability Stack
- Impact: Can't debug production issues, no visibility into performance
- Fix: Add structured logging (Pino), optional metrics export (Prometheus)

#### Git Workflow Not Defined
- Impact: Multiple agents committing to same repo — merge conflict risk
- Fix: Enforce branch-per-mission, document merge strategy

#### No Disaster Recovery Plan
- Impact: If workstation or VM dies, VALOR is offline indefinitely
- Fix: Document recovery procedure, test it quarterly

---

## Priority Action Items

### P0 — Required for Daily Use

1. **Build Director LLM Service** (VM-012)
   - Estimated: 3-5 days
   - Blocker: Can't route missions without Director

2. **Deploy NATS Systemd Service** (VM-008 follow-up)
   - Estimated: 1 day
   - Blocker: NATS must survive reboots

3. **Deploy Agent-Tick NATS Consumer to 1 Agent** (VM-013 follow-up)
   - Estimated: 2 days
   - Blocker: Operatives can't pick up missions

4. **End-to-End Integration Test** (New)
   - Estimated: 1 day
   - Blocker: Must validate full pipeline works

### P1 — Required for Smooth Daily Use

5. **Deploy Telegram Gateway as Service** (VM-014 follow-up)
   - Estimated: 1 day
   - Impact: Tom must manually start gateway

6. **Wire SSE Real-Time Updates to Dashboard** (VM-016 follow-up)
   - Estimated: 1 day
   - Impact: 5-second lag on mission updates

7. **Add Health Check Endpoint** (New)
   - Estimated: 0.5 day
   - Impact: Can't verify system health programmatically

8. **Create Startup Script** (New)
   - Estimated: 0.5 day
   - Impact: Manual startup is error-prone

### P2 — Quality of Life Improvements

9. **Add NATS Monitoring Dashboard** (New)
   - Estimated: 2 days
   - Impact: Can't see queue depth, consumer lag

10. **Build JetStream Backup Script** (New)
    - Estimated: 0.5 day
    - Impact: Risk of data loss on failure

11. **Document Git Workflow** (New)
    - Estimated: 1 day
    - Impact: Merge conflict risk

12. **Tune Director Confidence Threshold** (VM-006 follow-up)
    - Estimated: Ongoing
    - Impact: Suboptimal routing decisions

---

## Conclusion

**Is VALOR ready for Tom to use daily?**

**No — but it's close.**

**What's working:**
- ✅ NATS infrastructure (server + client)
- ✅ Dashboard (UI accessible, systemd service)
- ✅ Core components (Director prompt, Analyst agent, Telegram gateway)
- ✅ Mission schemas and data models

**What's blocking:**
- ❌ Director LLM not running (P0)
- ❌ Agent-tick consumer not deployed (P0)
- ❌ End-to-end pipeline untested (P0)
- ❌ NATS not running as service (P0)

**Estimated time to production:**
- **Minimum:** 1 week (P0 items only, bare-bones functionality)
- **Realistic:** 2-3 weeks (P0 + P1 items, smooth daily use)
- **Polished:** 4-6 weeks (P0 + P1 + P2, production-grade)

**Recommendation:**

Focus on **P0 items first** to prove the pipeline works end-to-end with one real mission. Once that succeeds, migrate to Proxmox VM for always-on availability, then polish with P1/P2 items.

**Next steps:**
1. **VM-012: Build Director LLM Service** (Gage, 3-5 days)
2. **VM-008 follow-up: NATS Systemd Service** (Gage, 1 day)
3. **VM-013 follow-up: Deploy Agent-Tick Consumer** (Mira + Eddie, 2 days)
4. **E2E Integration Test** (Gage + Mira, 1 day)

After these 4 tasks (~1-2 weeks), VALOR will be ready for limited daily use (1-2 missions/day, manual fallback if issues).

---

**Mission VM-019 Complete — Operational Readiness Documented**

_Last updated: 2026-03-21 | Operative: Mira | Status: Ready for Review_
