---
name: api-design
description: REST API design patterns for VALOR services (Herd Pro, Engram API, PagePulse). Use when designing new endpoints, reviewing API contracts, or documenting existing routes. Trigger on: "api endpoint", "REST", "route design", "request/response schema", "herd pro api", "engram api".
origin: ECC-adapted/SIT
---

# API Design — VALOR Services

## Response Envelope

All VALOR APIs use a consistent response shape:

```typescript
// Success
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-19T10:00:00Z"
  }
}

// Error
{
  "success": false,
  "error": {
    "code": "OPERATIVE_NOT_FOUND",
    "message": "Operative 'unknown' does not exist",
    "details": { ... }
  },
  "meta": { ... }
}
```

## Herd Pro Routing Endpoint

```
POST /v1/complete
{
  "prompt": string,
  "operative": "gage" | "forge" | "mira" | ...,
  "complexity": "trivial" | "standard" | "complex",  // optional, inferred if omitted
  "tags": string[],
  "budget": { "maxTokens": number }  // optional
}

Response:
{
  "success": true,
  "data": {
    "content": string,
    "model": "claude-haiku-4-5" | "claude-sonnet-4-6" | "claude-opus-4-6" | "ollama/...",
    "tokensUsed": { "input": number, "output": number },
    "cached": boolean,
    "latencyMs": number
  }
}
```

## Engram API Endpoints

```
POST   /v1/memory/retain     — store a memory entry
GET    /v1/memory/recall      — retrieve entries (query params: operative, types, tags, limit)
POST   /v1/memory/reflect     — trigger reflection pass
GET    /v1/memory/graph       — entity/relation knowledge graph
DELETE /v1/memory/:id         — delete specific entry
```

## Pagination

All list endpoints use cursor-based pagination:

```typescript
// Request
GET /v1/memory/recall?limit=20&cursor=mem_abc123

// Response
{
  "data": [...],
  "pagination": {
    "cursor": "mem_xyz789",  // pass as next request's cursor
    "hasMore": true,
    "total": 147
  }
}
```

Never use offset/page — unstable with inserts.

## Error Codes

```typescript
// Consistent error codes across all VALOR services
enum ErrorCode {
  NOT_FOUND         = 'NOT_FOUND',
  INVALID_INPUT     = 'INVALID_INPUT',
  UNAUTHORIZED      = 'UNAUTHORIZED',
  RATE_LIMITED      = 'RATE_LIMITED',
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
  BUDGET_EXCEEDED   = 'BUDGET_EXCEEDED',
  INTERNAL_ERROR    = 'INTERNAL_ERROR',
}
```

## Versioning

- All routes prefixed with `/v1/`
- Breaking changes → new major version
- Deprecation notices in response headers: `X-Deprecated: true`

## Rate Limiting Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1711000000
```
