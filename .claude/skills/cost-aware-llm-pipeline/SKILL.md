---
name: cost-aware-llm-pipeline
description: LLM model routing and cost optimization patterns for Herd Pro. Use when designing model selection logic, setting up routing rules, or auditing LLM spend across VALOR operatives. Trigger on: "model routing", "which model", "cost", "herd pro", "llm pipeline", "token budget".
origin: ECC-adapted/SIT
---

# Cost-Aware LLM Pipeline — Herd Pro

Route tasks to the cheapest model that can handle them well.

## Routing Tiers

| Tier | Model | Use When |
|---|---|---|
| **Fast** | `claude-haiku-4-5` | Pattern matching, formatting, simple Q&A, background observation |
| **Standard** | `claude-sonnet-4-6` | Code review, feature implementation, general tasks |
| **Heavy** | `claude-opus-4-6` | Security audit, architecture decisions, complex reasoning |
| **Local** | Ollama (CITADEL) | Dev/test, bulk processing, offline work |

## Routing Logic (Herd Pro)

```rust
pub enum TaskComplexity {
    Trivial,    // haiku
    Standard,   // sonnet
    Complex,    // opus
    Local,      // ollama
}

impl ModelRouter {
    pub fn route(&self, task: &Task) -> Model {
        match task.complexity() {
            TaskComplexity::Trivial  => Model::Haiku,
            TaskComplexity::Standard => Model::Sonnet,
            TaskComplexity::Complex  => Model::Opus,
            TaskComplexity::Local    => Model::Ollama(self.ollama_endpoint.clone()),
        }
    }
    
    fn complexity_from_task(task: &Task) -> TaskComplexity {
        if task.has_tag("security") || task.has_tag("architecture") {
            return TaskComplexity::Complex;
        }
        if task.estimated_tokens() < 500 && !task.requires_reasoning() {
            return TaskComplexity::Trivial;
        }
        TaskComplexity::Standard
    }
}
```

## VALOR Operative → Model Defaults

| Operative | Default Model | Override When |
|---|---|---|
| Gage (code) | sonnet | Security review → opus |
| Forge (code) | sonnet | Architecture → opus |
| Rook (security) | opus | Always |
| Paladin (autonomous) | sonnet | Simple monitoring → haiku |
| Zeke (ranch) | haiku | Complex planning → sonnet |
| Herbie (trading) | sonnet | Market analysis → opus |
| Mira (comms) | sonnet | Simple drafts → haiku |
| Crazy-Eddie (SIT) | sonnet | Strategy → opus |

## Ollama Local Models (CITADEL / starbase:40114)

Use local models for:
- Development and testing (no cost, no rate limits)
- Bulk Engram reflection passes
- Background observer agent tasks
- Experiments with new prompting patterns

```bash
# Check available models
curl http://starbase:40114/api/tags

# Route to local for dev
export HERD_PROFILE=local
```

## Cost Guards

```typescript
// Track spend per operative per session
interface SessionBudget {
  operative: string;
  maxTokens: number;
  spentTokens: number;
  hardLimit: boolean;  // if true, refuse over-limit requests
}

// Warn at 80%, stop at 100%
if (session.spentTokens > session.maxTokens * 0.8) {
  log.warn(`[${operative}] Approaching token budget (${pct}%)`);
}
```

## Caching (Content Hash)

For repeated identical prompts (Engram reflection, batch analysis):

```typescript
import { createHash } from 'crypto';

function getCacheKey(prompt: string, model: string): string {
  return createHash('sha256')
    .update(prompt + model)
    .digest('hex');
}

async function cachedCompletion(prompt: string, model: string) {
  const key = getCacheKey(prompt, model);
  const cached = await cache.get(key);
  if (cached) return cached;
  
  const result = await llm.complete(prompt, model);
  await cache.set(key, result, { ttl: 3600 });
  return result;
}
```

## OpenRouter Overflow

When CITADEL is unavailable or at capacity, fall through to OpenRouter:

```
Primary: http://starbase:40114 (Ollama/CITADEL)
Overflow: OpenRouter
  - anthropic/claude-haiku-4.5
  - anthropic/claude-sonnet-4.5
  - deepseek/deepseek-r1
```
