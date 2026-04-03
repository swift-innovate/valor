# VALOR Engine

> Unified AI Agent Orchestration Platform

VALOR Engine is an autonomous AI agent orchestration platform. It manages missions, control gates, stream supervision, divisions, and decision checkpoints — and can execute missions internally through multi-phase operative agents.

## Quick Start

```bash
cp .env.example .env
# Configure at least one provider (see .env.example)
pnpm install
pnpm dev
```

## Execution Architecture

VALOR dispatches missions through three paths depending on the agent's configuration:

```
                    ┌─────────────────────┐
                    │    Orchestrator      │
                    │  gates → classify →  │
                    │     dispatch         │
                    └──┬───────┬────────┬──┘
                       │       │        │
               Path A  │ Path C│  Path B│
              webhook  │internal│ stream │
                       │       │        │
                  ┌────▼──┐ ┌──▼─────────────────────────┐ ┌────▼────┐
                  │Webhook│ │   OperativeAgent (Phase 1)  │ │ Direct  │
                  │  POST │ │ Observe→Plan→Act→Validate→  │ │ Stream  │
                  └───────┘ │ Reflect→Evolve              │ └─────────┘
                            └──┬──────────────┬───────────┘
                               │              │
                       ┌───────▼──────┐ ┌─────▼──────────────┐
                       │    Engram    │ │   Sub-agents        │
                       │  (Phase 3)  │ │   (Phase 4)         │
                       │  per-agent  │ │  parallel fan-out    │
                       │  .engram    │ │  cheaper models      │
                       │  files      │ │  read-only memory    │
                       └─────────────┘ └──────────────────────┘
                               │              │
                       ┌───────▼──────────────▼───────────┐
                       │      Provider Registry           │
                       │  Ollama (5090/4080/4070)          │
                       │  + Anthropic + OpenAI             │
                       └──────────────┬───────────────────┘
                                      │
                       ┌──────────────▼───────────────────┐
                       │         Event Bus                │
                       │  sitreps → dashboard + Telegram  │
                       └──────────────────────────────────┘
```

- **Path A (webhook):** Agent has an `endpoint_url` — mission brief POSTed to the external agent
- **Path B (direct stream):** No agent — single LLM call streamed through a provider
- **Path C (internal):** Agent with `runtime: "internal"` — full 6-phase operative loop runs in-process

### Internal Execution Stack

| Layer | What it does |
|-------|-------------|
| **OperativeAgent** | Runs the Observe→Plan→Act→Validate→Reflect→Evolve loop per mission |
| **Engram** | Per-agent memory via `.engram` SQLite files in `data/engram/` — recall in Observe, retain in Reflect |
| **Sub-agents** | Parallel fan-out from the Act phase — concurrent scoped LLM calls on cheaper models with read-only parent memory |
| **Provider Registry** | Routes LLM calls to Ollama (multi-GPU), Anthropic, or OpenAI based on model and capability |
| **Event Bus** | Sitreps published after each phase — consumed by dashboard, Telegram, and monitors |

### Agent Runtime Types

| Runtime | Dispatch | Use case |
|---------|----------|----------|
| `internal` | In-process operative loop | Autonomous agents managed by the engine |
| `openclaw` | Webhook POST | External OpenClaw agents |
| `ollama` / `claude_api` / `openai_api` | Webhook or direct stream | External agents with specific runtimes |
| `custom` | Webhook | User-defined external agents |

## Engine Architecture

7-layer engine:

1. **Core Engine** — Mission lifecycle, stream supervision, failure routing, WAL
2. **Provider Layer** — Claude API, Ollama, OpenClaw, Home Assistant, custom adapters
3. **Execution Layer** — Internal OperativeAgent, sub-agent dispatch, Engram memory bridge
4. **Identity Layer** — SSOP-typed persona registry
5. **Memory Layer** — Namespaced per-division state + per-agent Engram files
6. **Decision Layer** — VECTOR Method checkpoints and bias scoring
7. **Communication Bus** — Typed EventEnvelope pub/sub with guaranteed delivery
8. **Division Schema** — Registration, autonomy policies, escalation rules

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

Agents connect via **MCP (Model Context Protocol)** — the recommended method for external agents:

```
POST /mcp  →  initialize with callsign + agent_key
           →  10 typed tools auto-discovered (check_inbox, accept_mission, submit_sitrep, ...)
           →  Session-based auth, no per-request headers
           →  Every tool call = implicit heartbeat
```

Internal agents (`runtime: "internal"`) don't use MCP — they execute directly within the engine process and publish sitreps through the event bus.

REST endpoints remain available for the dashboard and backward compatibility. See [`SKILL.md`](SKILL.md) for the full agent integration guide.

## API

Default port: `3200`

| Endpoint | Purpose |
|----------|---------|
| `POST /mcp` | **MCP server** — agent communication (recommended) |
| `GET /health` | Engine health + provider + Engram + MCP status |
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
