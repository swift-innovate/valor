# VALOR Engine — Production Dockerfile
# Multi-stage build: compile TypeScript, then run minimal runtime image.

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package manifests first for layer caching
COPY package.json package-lock.json* pnpm-lock.yaml* ./

# Install all dependencies (including devDependencies for typecheck)
RUN npm install --ignore-scripts && \
    npm rebuild better-sqlite3

# Copy source
COPY tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY gateways/ gateways/
COPY SKILL.md ./
COPY docs/agent-quickstart.md docs/agent-quickstart.md

# Typecheck — fail the build if types are broken
RUN npx tsc --noEmit

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Native module runtime deps
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -S valor && adduser -S valor -G valor

# Copy package manifests and install production deps only
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3 && \
    npm cache clean --force

# Copy source (tsx runs TypeScript directly, no compile step needed)
COPY tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY gateways/ gateways/
COPY SKILL.md ./
COPY docs/agent-quickstart.md docs/agent-quickstart.md

# Create data directory for SQLite
RUN mkdir -p /data && chown -R valor:valor /data /app

# tsx is needed at runtime — install it explicitly if not in prod deps
RUN npm list tsx 2>/dev/null || npm install tsx

VOLUME ["/data"]

# Switch to non-root user
USER valor

EXPOSE 3200

# Health check — hit the /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3200/health || exit 1

ENV NODE_ENV=production \
    VALOR_PORT=3200 \
    VALOR_DB_PATH=/data/valor.db

CMD ["node", "--import", "tsx", "src/index.ts"]
