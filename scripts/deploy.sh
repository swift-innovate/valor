#!/usr/bin/env bash
#
# VALOR Engine — Deploy Script
#
# Pulls latest code, installs deps, typechecks, tests, and restarts.
# Works with either Docker Compose or systemd deployment.
#
# Usage:
#   bash scripts/deploy.sh              # auto-detect mode
#   bash scripts/deploy.sh docker       # force Docker mode
#   bash scripts/deploy.sh systemd      # force systemd mode
#
set -euo pipefail

VALOR_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$VALOR_DIR"

MODE="${1:-auto}"

# ── Helpers ─────────────────────────────────────────────────────────────────

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

detect_mode() {
  if [ "$MODE" != "auto" ]; then
    echo "$MODE"
    return
  fi

  if [ -f "deploy/docker-compose.yml" ] && command -v docker &>/dev/null && docker compose version &>/dev/null; then
    echo "docker"
  elif systemctl --user is-active valor-engine.service &>/dev/null 2>&1 || systemctl is-active valor-engine.service &>/dev/null 2>&1; then
    echo "systemd"
  elif command -v docker &>/dev/null; then
    echo "docker"
  else
    echo "systemd"
  fi
}

# ── Step 1: Pull latest code ───────────────────────────────────────────────

log "Pulling latest code..."
git pull --ff-only || fail "git pull failed — resolve conflicts manually"

# ── Step 2: Install dependencies ────────────────────────────────────────────

log "Installing dependencies..."
npm install

# ── Step 3: Typecheck ───────────────────────────────────────────────────────

log "Running typecheck..."
npx tsc --noEmit || fail "Typecheck failed — fix type errors before deploying"

# ── Step 4: Run tests ──────────────────────────────────────────────────────

log "Running tests..."
if npx vitest run --reporter=verbose 2>/dev/null; then
  log "Tests passed"
else
  log "WARNING: Tests failed — review output above"
  read -r -p "[deploy] Continue despite test failures? [y/N] " response
  case "$response" in
    [yY]) log "Continuing..." ;;
    *)    fail "Deploy aborted due to test failures" ;;
  esac
fi

# ── Step 5: Restart services ───────────────────────────────────────────────

DEPLOY_MODE=$(detect_mode)
log "Deploying via: $DEPLOY_MODE"

case "$DEPLOY_MODE" in
  docker)
    log "Rebuilding Docker images..."
    docker compose -f deploy/docker-compose.yml build

    log "Restarting services..."
    docker compose -f deploy/docker-compose.yml up -d

    log "Waiting for health check..."
    sleep 5
    if docker compose -f deploy/docker-compose.yml ps | grep -q "(healthy)"; then
      log "Services healthy"
    else
      log "WARNING: Services may not be healthy yet — check with: docker compose -f deploy/docker-compose.yml ps"
    fi
    ;;

  systemd)
    log "Restarting systemd services..."

    if systemctl is-active valor-engine.service &>/dev/null 2>&1; then
      sudo systemctl restart valor-engine.service
      log "valor-engine.service restarted"
    elif systemctl --user is-active valor-engine.service &>/dev/null 2>&1; then
      systemctl --user restart valor-engine.service
      log "valor-engine.service restarted (user mode)"
    else
      log "WARNING: valor-engine.service not found — start manually or install unit files:"
      log "  sudo cp deploy/valor-engine.service /etc/systemd/system/"
      log "  sudo cp deploy/valor-director.service /etc/systemd/system/"
      log "  sudo systemctl daemon-reload"
      log "  sudo systemctl enable --now valor-engine.service"
    fi

    # Restart director if it's running
    if systemctl is-active valor-director.service &>/dev/null 2>&1; then
      sudo systemctl restart valor-director.service
      log "valor-director.service restarted"
    elif systemctl --user is-active valor-director.service &>/dev/null 2>&1; then
      systemctl --user restart valor-director.service
      log "valor-director.service restarted (user mode)"
    fi

    sleep 3
    VALOR_PORT="${VALOR_PORT:-3200}"
    if curl -sf "http://localhost:${VALOR_PORT}/health" &>/dev/null; then
      log "VALOR engine healthy on port ${VALOR_PORT}"
    else
      log "WARNING: Health check failed — check logs: journalctl -u valor-engine -f"
    fi
    ;;

  *)
    fail "Unknown deploy mode: $DEPLOY_MODE (use 'docker' or 'systemd')"
    ;;
esac

log "Deploy complete"
