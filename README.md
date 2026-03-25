# VALOR Engine

> Unified AI Agent Orchestration Platform

VALOR Engine is a standalone orchestration authority for AI agent fleets. It manages missions, control gates, stream supervision, divisions, and decision checkpoints — without hosting or running agents directly.

## Quick Start

```bash
cp .env.example .env
# Configure at least one provider (see .env.example)
pnpm install
pnpm dev
```

## Architecture

7-layer engine:

1. **Core Engine** — Mission lifecycle, stream supervision, failure routing, WAL
2. **Provider Layer** — Claude API, Ollama, OpenClaw, Home Assistant, custom adapters
3. **Identity Layer** — SSOP-typed persona registry
4. **Memory Layer** — Namespaced per-division state
5. **Decision Layer** — VECTOR Method checkpoints and bias scoring
6. **Communication Bus** — Typed EventEnvelope pub/sub with guaranteed delivery
7. **Division Schema** — Registration, autonomy policies, escalation rules

## Providers

Configure via environment variables:

| Provider | Env Var | Protocol |
|----------|---------|----------|
| Anthropic Claude | `ANTHROPIC_API_KEY` | Anthropic Messages API |
| Ollama (local) | `OLLAMA_BASE_URL` | Standard Ollama HTTP |

The provider layer is runtime-agnostic. Add custom adapters by implementing the `ProviderAdapter` interface.

## Test Suite

```bash
pnpm test
```

## Agent Communication

Agents connect via **MCP (Model Context Protocol)** — the recommended method:

```
POST /mcp  →  initialize with callsign + agent_key
           →  10 typed tools auto-discovered (check_inbox, accept_mission, submit_sitrep, ...)
           →  Session-based auth, no per-request headers
           →  Every tool call = implicit heartbeat
```

REST endpoints remain available for the dashboard and backward compatibility. See [`SKILL.md`](SKILL.md) for the full agent integration guide.

## API

Default port: `3200`

| Endpoint | Purpose |
|----------|---------|
| `POST /mcp` | **MCP server** — agent communication (recommended) |
| `GET /health` | Engine health + provider + MCP status |
| `GET /providers` | Registered provider list |
| `GET /skill.md` | Agent integration guide (live markdown) |
| `/agent-cards/*` | Agent registration cards + approval flow |
| `/agents/*` | Agent roster, heartbeat, health |
| `/comms/*` | Inter-agent messaging, conversations, group chats |
| `/artifacts/*` | Shared content (code, configs, docs) between agents |
| `/missions/*` | Mission CRUD, dispatch, approve, abort |
| `/divisions/*` | Division CRUD, agent roster |
| `/personas/*` | Persona CRUD |
| `/decisions/*` | VECTOR analysis, checkpoints |
| `/sitreps/*` | Situation reports |
| `/dashboard/*` | Web UI (comms log, agent cards, artifacts, missions, approvals) |

## License

MIT — see [LICENSE](LICENSE)
