#!/usr/bin/env bash
# Stop all VALOR services gracefully
set -euo pipefail

VALOR_DIR="${VALOR_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG_DIR="$VALOR_DIR/logs"

echo "Stopping VALOR services..."

for pidfile in "$LOG_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  name=$(basename "$pidfile" .pid)
  if kill -0 "$pid" 2>/dev/null; then
    echo "  Stopping $name (PID $pid)..."
    kill "$pid" 2>/dev/null || true
  else
    echo "  $name already stopped"
  fi
  rm -f "$pidfile"
done

echo "All VALOR services stopped."
