# VALOR Engine

## Purpose
TypeScript/Node.js agent orchestration engine. Named operatives with six-phase execution loops (Observe → Plan → Act → Validate → Reflect → Evolve), Engram memory integration, NATS JetStream backbone, sub-agent fan-out.

## Architecture
TypeScript, Node.js. NATS JetStream for messaging. Engram for per-operative memory. Director dual-gear classifier (Gemma3:27b + Nemotron-Cascade-2). Telegram gateway. Mission Control dashboard. OperativeAgent internal execution with sub-agent fan-out.

## Conventions
- Tom's VALOR callsign is Director (not "Flight Director").
- Tier 1 agents are autonomous. Tier 3 agents escalate to division leads. Manual promotion only.
- See `CLAUDE.md` for operative definitions, mission workflow, and webhook integration.

## State
**Transitioning.** Per decision `2026-04-11-folder-is-agent`, VALOR's orchestration model is being superseded by the Deck Spec (folder-as-agent, LLM-agnostic). No new investment in NATS, Director, or OperativeAgent infrastructure. This repo is retained as reference during transition. Engram survives independently as a standalone library. Active projects should adopt DECK.md instead of VALOR operative patterns.
