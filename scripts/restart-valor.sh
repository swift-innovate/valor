#!/usr/bin/env bash
#
# VALOR Service Restart Script
#
# Stops all running VALOR services, then starts them fresh.
# NATS server is left running by default — pass --full to also restart NATS.
#
# Usage:
#   bash scripts/restart-valor.sh          # restart app services, keep NATS
#   bash scripts/restart-valor.sh --full   # restart everything including NATS
#
set -euo pipefail

VALOR_DIR="${VALOR_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$VALOR_DIR"

FULL_RESTART=false
for arg in "$@"; do
  [ "$arg" = "--full" ] && FULL_RESTART=true
done

LOG_DIR="$VALOR_DIR/logs"

echo "╔══════════════════════════════════════════════╗"
echo "║           VALOR Engine — Restart             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ---------------------------------------------------------------------------
# Stop services
# ---------------------------------------------------------------------------
echo "── Stopping services ──"

stop_pid() {
  local pidfile="$1"
  local name
  name=$(basename "$pidfile" .pid)
  [ -f "$pidfile" ] || return 0
  local pid
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "  Stopping $name (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    # Wait up to 5s for the process to exit
    local i=0
    while kill -0 "$pid" 2>/dev/null && [ $i -lt 10 ]; do
      sleep 0.5
      i=$((i + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "  Force-killing $name..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    echo "  $name already stopped"
  fi
  rm -f "$pidfile"
}

# Stop in reverse startup order: telegram, consumers, director, server, (nats)
stop_pid "$LOG_DIR/telegram-gateway.pid"

# Stop all consumer pid files
for f in "$LOG_DIR"/consumer-*.pid; do
  stop_pid "$f"
done

stop_pid "$LOG_DIR/director.pid"
stop_pid "$LOG_DIR/server.pid"

if $FULL_RESTART; then
  stop_pid "$LOG_DIR/nats-server.pid"
  echo "  ✓ All services stopped (including NATS)"
else
  echo "  ✓ App services stopped (NATS left running)"
fi

echo ""
sleep 1

# ---------------------------------------------------------------------------
# Start services
# ---------------------------------------------------------------------------
exec bash "$VALOR_DIR/scripts/start-valor.sh" "$@"
