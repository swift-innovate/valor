#!/usr/bin/env bash
#
# VALOR Service Startup Script
#
# Starts all Phase 1 services in order:
# 1. NATS Server (if not already running)
# 2. JetStream stream provisioning
# 3. VALOR Engine Server (dashboard + API)
# 4. Director Service
# 5. Telegram Gateway (if TELEGRAM_BOT_TOKEN is set)
#
# NOTE: Operative consumers are NOT started by VALOR. Agents are fully
# independent — they register via POST /agent-cards, send heartbeats, and
# poll their own NATS queues. See src/consumers/operative-consumer.ts for
# the reference template.
#
# Usage: bash scripts/start-valor.sh
#
# Environment variables:
#   NATS_URL          - NATS server URL (default: nats://localhost:4222)
#   OLLAMA_BASE_URL   - Ollama endpoint (default: http://starbase:40114)
#   DIRECTOR_MODEL    - Gear 1 model (default: gemma3:27b)
#   VALOR_DIR         - Project root (default: script's parent dir)
#
set -euo pipefail

VALOR_DIR="${VALOR_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$VALOR_DIR"

# Load .env if present
if [ -f "$VALOR_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$VALOR_DIR/.env"
  set +a
fi

NATS_URL="${NATS_URL:-nats://localhost:4222}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://starbase:40114}"
DIRECTOR_MODEL="${DIRECTOR_MODEL:-gemma3:27b}"
DIRECTOR_GEAR2_MODEL="${DIRECTOR_GEAR2_MODEL:-nemotron-cascade-2:latest}"
LOG_DIR="$VALOR_DIR/logs"

mkdir -p "$LOG_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║           VALOR Engine — Startup             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Project:  $VALOR_DIR"
echo "  NATS:     $NATS_URL"
echo "  Ollama:   $OLLAMA_BASE_URL"
echo "  Model:    $DIRECTOR_MODEL"
echo ""

# ---------------------------------------------------------------------------
# 1. NATS Server
# ---------------------------------------------------------------------------
echo "── Step 1: NATS Server ──"

if lsof -i :4222 &>/dev/null; then
  echo "  ✓ NATS already running on port 4222"
else
  echo "  Starting NATS server..."
  nohup "$VALOR_DIR/infrastructure/bin/nats-server" \
    -c "$VALOR_DIR/infrastructure/nats.conf" \
    > "$LOG_DIR/nats-server.log" 2>&1 &
  echo $! > "$LOG_DIR/nats-server.pid"
  sleep 2

  if lsof -i :4222 &>/dev/null; then
    echo "  ✓ NATS started (PID $(cat "$LOG_DIR/nats-server.pid"))"
  else
    echo "  ✗ NATS failed to start — check $LOG_DIR/nats-server.log"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 2. JetStream Streams
# ---------------------------------------------------------------------------
echo ""
echo "── Step 2: JetStream Streams ──"

NATS_URL="$NATS_URL" LOG_LEVEL=warn node --import tsx scripts/ensure-streams.ts 2>&1 | sed 's/^/  /'
echo "  ✓ Streams ready"

# ---------------------------------------------------------------------------
# 3. VALOR Engine Server (dashboard + API)
# ---------------------------------------------------------------------------
echo ""
echo "── Step 3: VALOR Engine Server ──"

if pgrep -f "src/index.ts" &>/dev/null; then
  echo "  ✓ VALOR server already running"
else
  echo "  Starting VALOR server..."
  nohup node --import tsx src/index.ts \
    > "$LOG_DIR/server.log" 2>&1 &
  echo $! > "$LOG_DIR/server.pid"

  # Wait for the server to be ready (up to 15s)
  VALOR_PORT="${VALOR_PORT:-3200}"
  ready=false
  for i in $(seq 1 15); do
    sleep 1
    if curl -s --connect-timeout 1 "http://localhost:${VALOR_PORT}/health" &>/dev/null; then
      ready=true
      break
    fi
  done

  if $ready; then
    echo "  ✓ VALOR server ready (PID $(cat "$LOG_DIR/server.pid"))"
  elif pgrep -f "src/index.ts" &>/dev/null; then
    echo "  ⚠ VALOR server process running but /health not responding yet"
  else
    echo "  ✗ VALOR server failed to start — check $LOG_DIR/server.log"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 4. Director Service
# ---------------------------------------------------------------------------
echo ""
echo "── Step 4: Director Service ──"

if pgrep -f "director-service.ts" &>/dev/null; then
  echo "  ✓ Director already running"
else
  echo "  Starting Director..."
  NATS_URL="$NATS_URL" \
  OLLAMA_BASE_URL="$OLLAMA_BASE_URL" \
  DIRECTOR_MODEL="$DIRECTOR_MODEL" \
  DIRECTOR_GEAR2_MODEL="$DIRECTOR_GEAR2_MODEL" \
  LOG_LEVEL=info \
  nohup node --import tsx scripts/director-service.ts \
    > "$LOG_DIR/director.log" 2>&1 &
  echo $! > "$LOG_DIR/director.pid"
  sleep 2

  if pgrep -f "director-service.ts" &>/dev/null; then
    echo "  ✓ Director started (PID $(cat "$LOG_DIR/director.pid"))"
  else
    echo "  ✗ Director failed to start — check $LOG_DIR/director.log"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 5. Telegram Gateway
# ---------------------------------------------------------------------------
echo ""
echo "── Step 5: Telegram Gateway ──"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "  ⚠ TELEGRAM_BOT_TOKEN not set — skipping gateway"
elif pgrep -f "gateways/telegram" &>/dev/null; then
  echo "  ✓ Telegram gateway already running"
else
  echo "  Starting Telegram gateway..."
  NATS_URL="$NATS_URL" \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  PRINCIPAL_TELEGRAM_ID="${PRINCIPAL_TELEGRAM_ID:-8551062231}" \
  OLLAMA_BASE_URL="$OLLAMA_BASE_URL" \
  LOG_LEVEL=info \
  nohup node --import tsx gateways/telegram/index.ts \
    > "$LOG_DIR/telegram-gateway.log" 2>&1 &
  echo $! > "$LOG_DIR/telegram-gateway.pid"
  sleep 3

  if pgrep -f "gateways/telegram" &>/dev/null; then
    echo "  ✓ Telegram gateway started (PID $(cat "$LOG_DIR/telegram-gateway.pid"))"
  else
    echo "  ✗ Telegram gateway failed — check $LOG_DIR/telegram-gateway.log"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Health Check
# ---------------------------------------------------------------------------
echo ""
echo "── Health Check ──"

# NATS
if lsof -i :4222 &>/dev/null; then
  echo "  ✓ NATS: listening on :4222"
else
  echo "  ✗ NATS: not responding"
fi

# Ollama
if curl -s --connect-timeout 3 "$OLLAMA_BASE_URL/api/tags" &>/dev/null; then
  echo "  ✓ Ollama: reachable at $OLLAMA_BASE_URL"
else
  echo "  ⚠ Ollama: not reachable at $OLLAMA_BASE_URL (Director will fail on LLM calls)"
fi

# VALOR Server / Dashboard
VALOR_PORT="${VALOR_PORT:-3200}"
if curl -s --connect-timeout 3 "http://localhost:${VALOR_PORT}/health" &>/dev/null; then
  echo "  ✓ VALOR server: http://localhost:${VALOR_PORT}/dashboard"
else
  echo "  ✗ VALOR server: not responding on :${VALOR_PORT}"
fi

# Director
if pgrep -f "director-service.ts" &>/dev/null; then
  echo "  ✓ Director: running"
else
  echo "  ✗ Director: not running"
fi

# Telegram
if pgrep -f "gateways/telegram" &>/dev/null; then
  echo "  ✓ Telegram gateway: running"
elif [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "  ⚠ Telegram gateway: skipped (no token)"
else
  echo "  ✗ Telegram gateway: not running"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         VALOR Engine — Running               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Dashboard: http://localhost:${VALOR_PORT}/dashboard"
echo "║  Logs:      $LOG_DIR/"
echo "║  NATS:      $NATS_URL"
echo "║  Director:  valor.missions.inbound"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "To stop all services: bash scripts/stop-valor.sh"
echo "To check health:      bash scripts/health-check.sh"
