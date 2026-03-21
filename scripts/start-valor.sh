#!/usr/bin/env bash
#
# VALOR Service Startup Script
#
# Starts all Phase 1 services in order:
# 1. NATS Server (if not already running)
# 2. JetStream stream provisioning
# 3. Director LLM service
# 4. Operative consumer (eddie by default)
#
# Usage: bash scripts/start-valor.sh
#
# Environment variables:
#   NATS_URL          - NATS server URL (default: nats://localhost:4222)
#   OLLAMA_BASE_URL   - Ollama endpoint (default: http://starbase:40114)
#   DIRECTOR_MODEL    - Gear 1 model (default: gemma3:27b)
#   OPERATIVE         - Which operative to start (default: eddie)
#   VALOR_DIR         - Project root (default: script's parent dir)
#
set -euo pipefail

VALOR_DIR="${VALOR_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$VALOR_DIR"

NATS_URL="${NATS_URL:-nats://localhost:4222}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://starbase:40114}"
DIRECTOR_MODEL="${DIRECTOR_MODEL:-gemma3:27b}"
DIRECTOR_GEAR2_MODEL="${DIRECTOR_GEAR2_MODEL:-nemotron-cascade-2:latest}"
OPERATIVE="${OPERATIVE:-eddie}"
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
echo "  Operative: $OPERATIVE"
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
# 3. Director Service
# ---------------------------------------------------------------------------
echo ""
echo "── Step 3: Director Service ──"

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
# 4. Operative Consumer
# ---------------------------------------------------------------------------
echo ""
echo "── Step 4: Operative Consumer ($OPERATIVE) ──"

if pgrep -f "operative-consumer.ts.*--operative $OPERATIVE" &>/dev/null; then
  echo "  ✓ Consumer for $OPERATIVE already running"
else
  echo "  Starting consumer for $OPERATIVE..."
  LOG_LEVEL=info \
  nohup node --import tsx src/consumers/operative-consumer.ts \
    --operative "$OPERATIVE" \
    --nats "$NATS_URL" \
    > "$LOG_DIR/consumer-$OPERATIVE.log" 2>&1 &
  echo $! > "$LOG_DIR/consumer-$OPERATIVE.pid"
  sleep 2

  if pgrep -f "operative-consumer.ts.*--operative $OPERATIVE" &>/dev/null; then
    echo "  ✓ Consumer started (PID $(cat "$LOG_DIR/consumer-$OPERATIVE.pid"))"
  else
    echo "  ✗ Consumer failed — check $LOG_DIR/consumer-$OPERATIVE.log"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 5. Health Check
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

# Director
if pgrep -f "director-service.ts" &>/dev/null; then
  echo "  ✓ Director: running"
else
  echo "  ✗ Director: not running"
fi

# Consumer
if pgrep -f "operative-consumer.ts" &>/dev/null; then
  echo "  ✓ Consumer ($OPERATIVE): running"
else
  echo "  ✗ Consumer ($OPERATIVE): not running"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         VALOR Engine — Running               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Logs:     $LOG_DIR/"
echo "║  NATS:     $NATS_URL"
echo "║  Director: valor.missions.inbound"
echo "║  Consumer: valor.missions.$OPERATIVE.pending"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "To stop all services: bash scripts/stop-valor.sh"
echo "To check health:      bash scripts/health-check.sh"
