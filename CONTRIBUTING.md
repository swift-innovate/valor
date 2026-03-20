# Contributing to VALOR Engine

VALOR is a purpose-built AI agent orchestration engine. Contributions are welcome — but this project has strong opinions about scope, dependencies, and code quality. Read this before opening a PR.

---

## What VALOR Is (and Is Not)

VALOR is a **standalone orchestration authority**. It manages missions, gates, streams, and agent communication. It does not host agents, does not depend on any specific LLM provider, and has zero runtime dependencies on external orchestration frameworks.

Before contributing, understand the scope boundaries in `CLAUDE.md`. The short version:

- No LangChain, CrewAI, AutoGen, or similar frameworks
- No hard dependency on any specific LLM provider — all providers go through protocol-level adapters
- Provider adapters speak standard protocols (Anthropic API, OpenAI API, Ollama HTTP API) — not vendor SDKs with heavy abstractions
- Agent memory, external persona frameworks, and LLM gateway products are separate systems; VALOR does not import them

A user pointing VALOR at a direct API key should get a fully functional orchestration engine with zero additional dependencies.

---

## Development Setup

**Requirements:** Node.js 20+, pnpm

```bash
git clone <repo>
cd valor-engine
pnpm install
cp .env.example .env          # fill in ANTHROPIC_API_KEY or OLLAMA_BASE_URL
pnpm test                     # must be green before you start
```

The test suite runs fully offline — no live API calls. Tests use a transient SQLite database (`:memory:`-style isolation via `freshDb()`/`cleanupDb()` helpers).

---

## Before You Write Code

1. **Run the tests.** `pnpm test` must be green before and after your change.
2. **Read the relevant source files.** Don't propose changes to code you haven't read.
3. **Check for an existing abstraction.** If you're adding a new repo function, check that one doesn't already exist. If you're adding a new type, check `src/types/`.
4. **Keep it minimal.** The right amount of code is the minimum needed for the task. Three similar lines is better than a premature abstraction.

---

## Code Standards

### TypeScript

- Strict mode is non-negotiable (`"strict": true` in `tsconfig.json`)
- No `any` — use `unknown` and narrow, or define a proper type
- Exported types live in `src/types/` and are re-exported from `src/types/index.ts`
- Zod schemas are the single source of truth for runtime validation — `z.infer<typeof Schema>` is the TypeScript type

### File Organization

```
src/
  types/          — Zod schemas + inferred TypeScript types
  db/
    migrations/   — Numbered SQL migrations (007-next-feature.sql)
    repositories/ — One file per entity, typed CRUD + queries
  api/            — Hono route handlers, one file per resource
  bus/            — Event bus (publish/subscribe)
  dashboard/      — Server-rendered HTML dashboard pages
  providers/      — Protocol-level LLM adapters
  stream/         — Stream supervision
  orchestrator/   — Mission lifecycle and dispatch
  gates/          — Control gate evaluators
  identity/       — Persona loading and lead instantiation
```

### Database Migrations

- Migrations are numbered sequentially: `001-initial.sql`, `002-approvals.sql`, etc.
- Never modify an existing migration — add a new one
- New tables get indexes on the columns that will be filtered in `listX()` calls
- Run `pnpm test` after adding a migration to verify it applies cleanly

### API Routes

- Routes live in `src/api/<resource>.ts` and export a named `<resource>Routes` Hono app
- Wire into `src/api/index.ts` (export) and `src/index.ts` (mount)
- Return typed errors: `{ error: string }` with an appropriate HTTP status
- Wrap `c.req.json()` in try/catch — return 400 on parse failure, not 500
- Director-only operations check `X-VALOR-Role: director` header (see `requireDirector()` pattern in `src/api/missions.ts`)

### Event Bus

- Use `publish()` from `src/bus/event-bus.ts` — it persists the event to SQLite AND broadcasts to subscribers
- Do not call `appendEvent()` then `publish()` for the same event — that double-writes
- Event types follow the pattern `<resource>.<action>` (e.g., `agent.card.approved`, `artifact.created`)

### Error Handling

- Every error must be typed, logged, and handled — no silent swallows
- Use `logger` from `src/utils/logger.ts`, not `console.log`
- Repository functions return `null` for not-found, throw for unexpected errors
- API handlers distinguish between 400 (bad input), 404 (not found), 409 (conflict), and 403 (authorization)

---

## Testing

Every new feature needs tests. The test suite lives in `tests/` and mirrors the `src/` structure.

**Run tests:**
```bash
pnpm test                            # full suite
npx vitest run tests/api/artifacts.test.ts   # single file
```

**Test helpers:**
- `freshDb()` — creates a fresh in-memory database with all migrations applied
- `cleanupDb()` — tears it down
- `clearSubscriptions()` — resets the event bus between tests

**What to test:**
- Happy path: valid input returns expected result
- Validation: invalid input returns the right error status and message
- Side effects: DB state is correct after the operation
- Events: the right bus events are published
- Authorization: director-only routes reject non-director callers

**What not to test:**
- Implementation details — test behavior, not how it's implemented
- Framework internals — don't test that Hono routes requests (it does)
- Transient I/O errors — don't add retry loops or sleep in tests

Tests run with `vitest` in parallel. Each test file gets its own database via `freshDb()`/`cleanupDb()` in `beforeEach`/`afterEach`.

---

## Pull Request Guidelines

### Scope

- One concern per PR. A bug fix doesn't need a refactor. A new feature doesn't need unrelated cleanup.
- If you find a bug while working on something else, open a separate issue or PR.

### Commit Format

Use conventional commits:

```
feat: add artifact versioning on update
fix: prevent double-write in comms-repo publish
test: add supervisor error threshold cases
refactor: extract requireDirector helper to shared middleware
docs: update SKILL.md with artifact attachment workflow
```

Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`

### PR Checklist

- [ ] `pnpm test` passes (all tests green)
- [ ] New features have tests
- [ ] No hardcoded agent names in public-facing code or docs (use generic IDs like `agt_abc123`)
- [ ] No new heavy dependencies added without discussion
- [ ] `SKILL.md` updated if the change affects the agent-facing API
- [ ] No `console.log` — use `logger`
- [ ] TypeScript compiles without errors (`pnpm build` if available)

---

## What Gets Rejected

To save everyone time, these will be closed without merge:

- PRs that add LangChain, CrewAI, AutoGen, or similar orchestration frameworks as dependencies
- PRs that add a new `any` type without a documented reason
- PRs that remove tests or reduce coverage on modified code
- PRs that add new features without tests
- PRs that refactor unrelated code "while they were in the area"
- PRs where `pnpm test` is red

---

## Reporting Issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Minimal reproduction steps (ideally a failing test)
- Engine version and Node.js version

For security issues, do not open a public issue — see `SECURITY.md` if present, or contact the maintainers directly.

---

## Architecture Questions

Read `CLAUDE.md` first — it has the full design intent, scope boundaries, and architectural requirements. The `docs/` directory has discovery, dependency analysis, and build planning documents from the initial design phase.

If you're unsure whether a contribution fits the project's direction, open an issue and ask before writing code.
