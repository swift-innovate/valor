# Task: Database Adapter Abstraction — SQLite + Postgres Dual Backend

> Priority: HIGH — Foundation for scaling, auth, and human participants.
> This is a REFACTOR, not a feature. No new functionality. The engine must
> behave identically after this change. All existing tests must pass.

Read `CLAUDE.md` first — respect the Scope Boundary section.

## Goal

Replace all direct `better-sqlite3` calls in repositories with a `DbAdapter`
interface. Implement two adapters: SQLite (current behavior, default) and
Postgres (new, opt-in via config). The backend is selected by an env var.
SQLite remains the default — zero friction for local dev.

## Why

1. **Postgres enables Supabase** — a direct `pg` connection to Supabase is
   just a connection string change. No proprietary SDK needed.
2. **Humans are coming** — auth, sessions, and user management need a real
   database. Supabase Auth + Postgres RLS is the path.
3. **SQLite stays for local dev** — anyone can `pnpm dev` with zero setup.
   Postgres is for production/scale.

## Architecture

```
src/db/
  adapter.ts              ← DbAdapter interface + factory
  adapters/
    sqlite-adapter.ts     ← wraps better-sqlite3 (current behavior)
    postgres-adapter.ts   ← wraps pg (node-postgres)
  database.ts             ← updated: uses adapter factory instead of raw better-sqlite3
  migrations/
    sqlite/               ← current .sql files moved here (unchanged)
    postgres/             ← new PG-dialect versions of same migrations
  repositories/           ← updated: use db.query/db.execute instead of getDb().prepare()
```

## What to Build

### 1. DbAdapter Interface (`src/db/adapter.ts`)

```typescript
export interface DbRow {
  [key: string]: unknown;
}

export interface DbResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface DbAdapter {
  /** Query returning multiple rows */
  queryAll<T extends DbRow = DbRow>(sql: string, params?: Record<string, unknown>): T[];

  /** Query returning one row or null */
  queryOne<T extends DbRow = DbRow>(sql: string, params?: Record<string, unknown>): T | null;

  /** Execute a statement (INSERT, UPDATE, DELETE) */
  execute(sql: string, params?: Record<string, unknown>): DbResult;

  /** Execute raw SQL (for migrations, multi-statement) */
  exec(sql: string): void;

  /** Run a function inside a transaction */
  transaction<T>(fn: () => T): T;

  /** Close the connection */
  close(): void;
}
```

### 2. SQLite Adapter (`src/db/adapters/sqlite-adapter.ts`)

Wraps `better-sqlite3`. This is a thin translation of the current `database.ts`
behavior behind the `DbAdapter` interface.

**Parameter style:** SQLite uses `@param` named parameters. The adapter accepts
`Record<string, unknown>` and passes it directly to `better-sqlite3` (which
already supports this).

```typescript
import Database from "better-sqlite3";

export function createSqliteAdapter(dbPath: string): DbAdapter {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    queryAll(sql, params = {}) {
      return db.prepare(sql).all(params) as T[];
    },
    queryOne(sql, params = {}) {
      return (db.prepare(sql).get(params) as T) ?? null;
    },
    execute(sql, params = {}) {
      const result = db.prepare(sql).run(params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    exec(sql) {
      db.exec(sql);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
    close() {
      db.close();
    },
  };
}
```

### 3. Postgres Adapter (`src/db/adapters/postgres-adapter.ts`)

Wraps `pg` (node-postgres). **Critical difference:** Postgres uses `$1, $2, $3`
positional parameters, not `@param` named parameters.

The adapter must translate `@param` style to `$N` positional style automatically
so repositories don't need to change their SQL strings.

```typescript
import pg from "pg";

function translateParams(
  sql: string,
  params: Record<string, unknown>
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  let index = 0;
  const text = sql.replace(/@(\w+)/g, (_, name) => {
    values.push(params[name]);
    return `$${++index}`;
  });
  return { text, values };
}

export function createPostgresAdapter(connectionString: string): DbAdapter {
  const pool = new pg.Pool({ connectionString });
  // ... implement interface using pool.query()
}
```

**Important:** `pg` is async. The current codebase is fully synchronous.
Two options:

**Option A (recommended): Use `pg` with synchronous wrapper.**
Use the `pg-native` or `better-pg` package that provides sync queries, OR
restructure the adapter to be async and update all repositories to async.

**Option B: Use `@electric-sql/pglite` for a Postgres-compatible sync engine.**
PGLite runs Postgres in-process (like SQLite) and supports sync operations.
This means "local Postgres" and "Supabase Postgres" are the same dialect but
different connection targets. However, PGLite is newer and less battle-tested.

**Decision for Claude Code:** Use Option A with async. The repositories are
already simple enough that adding `async/await` is mechanical. The API route
handlers in Hono already support async. This is the clean path.

**If async is too large a change in one PR**, do this instead:
- Keep SQLite adapter synchronous (as-is)
- Make Postgres adapter synchronous using `pg` with a connection-per-query
  pattern (not pooled). This is fine for the current scale.
- Add a `TODO: migrate to async adapter` comment
- The async migration can be a separate task

### 4. Updated database.ts

```typescript
import { config } from "../config.js";
import { createSqliteAdapter } from "./adapters/sqlite-adapter.js";
import { createPostgresAdapter } from "./adapters/postgres-adapter.js";
import type { DbAdapter } from "./adapter.js";

let adapter: DbAdapter | null = null;

export function getAdapter(): DbAdapter {
  if (adapter) return adapter;

  if (config.dbBackend === "postgres") {
    adapter = createPostgresAdapter(config.dbPostgresUrl!);
  } else {
    adapter = createSqliteAdapter(config.dbPath);
  }

  return adapter;
}

// Keep getDb() as a deprecated alias during migration
// so we don't have to update every file at once
export function getDb(): DbAdapter {
  return getAdapter();
}

export function closeDb(): void {
  adapter?.close();
  adapter = null;
}
```

### 5. Updated config.ts

Add new config fields:

```typescript
dbBackend: z.enum(["sqlite", "postgres"]).default("sqlite"),
dbPostgresUrl: z.string().optional(),
```

Mapped from env:
```
DB_BACKEND=sqlite|postgres
DB_POSTGRES_URL=postgresql://user:pass@localhost:5432/valor
```

### 6. Updated .env.example

```env
# Database backend: sqlite (default, zero setup) or postgres (production/scale)
DB_BACKEND=sqlite
DB_SQLITE_PATH=./data/valor.db

# Postgres connection (only needed if DB_BACKEND=postgres)
# Works with local Postgres, Supabase, or any PG-compatible host
# DB_POSTGRES_URL=postgresql://user:pass@localhost:5432/valor
# DB_POSTGRES_URL=postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres
```

### 7. Repository Updates

Every repository file in `src/db/repositories/` needs to be updated:

**Before (current):**
```typescript
import { getDb } from "../database.js";

export function getAgent(id: string): Agent | null {
  const row = getDb().prepare("SELECT * FROM agents WHERE id = @id").get({ id });
  return row ? rowToAgent(row as Record<string, unknown>) : null;
}
```

**After:**
```typescript
import { getAdapter } from "../database.js";

export function getAgent(id: string): Agent | null {
  const row = getAdapter().queryOne("SELECT * FROM agents WHERE id = @id", { id });
  return row ? rowToAgent(row as Record<string, unknown>) : null;
}
```

The changes are mechanical:
- `getDb().prepare(sql).all(params)` → `getAdapter().queryAll(sql, params)`
- `getDb().prepare(sql).get(params)` → `getAdapter().queryOne(sql, params)`
- `getDb().prepare(sql).run(params)` → `getAdapter().execute(sql, params)`
- `getDb().exec(sql)` → `getAdapter().exec(sql)`

**SQL strings stay the same** — the adapter handles the `@param` → `$N`
translation for Postgres internally. Repos don't know or care which backend
they're talking to.

### 8. Postgres Migration Files

Create `src/db/migrations/postgres/` with PG-dialect versions of all 7 migrations.

Key translations from SQLite to Postgres:

| SQLite | Postgres |
|--------|----------|
| `TEXT PRIMARY KEY` | `TEXT PRIMARY KEY` (same) |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT NOT NULL DEFAULT '[]'` | `JSONB NOT NULL DEFAULT '[]'::jsonb` |
| `TEXT NOT NULL DEFAULT '{}'` | `JSONB NOT NULL DEFAULT '{}'::jsonb` |
| `REAL` | `DOUBLE PRECISION` |
| `datetime('now')` | `NOW()` |
| `json_extract(col, '$.key')` | `col->>'key'` |
| `CREATE TABLE IF NOT EXISTS` | `CREATE TABLE IF NOT EXISTS` (same) |
| `CREATE INDEX IF NOT EXISTS` | `CREATE INDEX IF NOT EXISTS` (same) |

For columns currently stored as JSON strings (capabilities, primary_skills,
constraints, etc.): in Postgres use `JSONB` type. The adapter's rowToX()
functions already call `JSON.parse()` on these — for Postgres, `JSONB`
columns come back as objects, so the parse becomes a no-op or identity.

Handle this in the adapter: if the backend is Postgres and a column is already
an object (not a string), skip `JSON.parse()`. OR, let the repos always
`JSON.parse()` and the Postgres adapter always `JSON.stringify()` JSONB
columns on read. Pick whichever is simpler — the important thing is that
the repos don't change behavior.

### 9. Migration Runner Update

The migration runner in `database.ts` needs to pick the right migrations directory:

```typescript
const migrationsDir = config.dbBackend === "postgres"
  ? path.join(baseDir, "migrations", "postgres")
  : path.join(baseDir, "migrations", "sqlite");
```

SQLite migrations are the current files moved to `migrations/sqlite/`.
Postgres migrations are new files in `migrations/postgres/`.

### 10. json_extract Translation

The comms-repo uses `json_extract(payload, '$.category')` for filtering.
In Postgres this becomes `payload->>'category'` BUT only if the `payload`
column is `JSONB`. If it's `TEXT`, you need `payload::jsonb->>'category'`.

Since the Postgres migrations should define `payload` as `JSONB`, use
`payload->>'category'` in the Postgres versions of these queries.

**How to handle this without forking repo code:** The adapter's `@param → $N`
translator can ALSO translate `json_extract(col, '$.key')` to `col->>'key'`
for the Postgres adapter. This keeps the repos writing SQLite-style JSON
access and the adapter translating it. Simple regex:

```typescript
// In postgres adapter's translateParams:
sql = sql.replace(/json_extract\((\w+),\s*'\$\.(\w+)'\)/g, "$1->>'$2'");
```

### 11. Test Infrastructure

Update `tests/helpers/test-db.ts` to use the adapter:

```typescript
import { resetDb, runMigrations } from "../../src/db/database.js";

export function freshDb() {
  resetDb();
  // For SQLite: delete file. For Postgres: DROP/CREATE schema.
  // Tests always run against SQLite for speed unless TEST_DB_BACKEND is set.
  runMigrations();
}
```

Tests should default to SQLite (fast, no external deps). Add a CI flag
`TEST_DB_BACKEND=postgres` that runs the same tests against Postgres.

### 12. Add `pg` Dependency

```bash
pnpm add pg
pnpm add -D @types/pg
```

## What NOT to Do

- Do NOT make repositories async in this PR (unless you choose Option A above
  and commit to the full async migration). Keep it synchronous with sync PG
  queries for now.
- Do NOT add Supabase SDK — just use the `pg` package with a connection string.
  Supabase IS Postgres; no SDK needed for database operations.
- Do NOT add Supabase Auth yet — that's a separate task after this foundation.
- Do NOT change any API behavior, route signatures, or event types.
- Do NOT reference or import Engram, Herd Pro, or Operative.
- Do NOT change the dashboard, WebSocket, or any frontend code.

## Verification

1. `DB_BACKEND=sqlite pnpm test` — all existing tests pass (this is the default)
2. Engine starts with `DB_BACKEND=sqlite` and behaves identically to before
3. Engine starts with `DB_BACKEND=postgres DB_POSTGRES_URL=postgresql://...` and
   all API endpoints work
4. Agent cards, comms, artifacts all work on both backends
5. No SQLite-specific code remains in any repository file (only in sqlite-adapter.ts)

## Files Changed

```
NEW:
  src/db/adapter.ts
  src/db/adapters/sqlite-adapter.ts
  src/db/adapters/postgres-adapter.ts
  src/db/migrations/postgres/001-initial.sql
  src/db/migrations/postgres/002-approvals.sql
  src/db/migrations/postgres/003-personas.sql
  src/db/migrations/postgres/004-decisions.sql
  src/db/migrations/postgres/005-sigint-metadata.sql
  src/db/migrations/postgres/006-agent-cards.sql
  src/db/migrations/postgres/007-artifacts.sql

MOVED:
  src/db/migrations/*.sql → src/db/migrations/sqlite/*.sql

MODIFIED:
  src/db/database.ts          — adapter factory instead of raw better-sqlite3
  src/config.ts               — add dbBackend, dbPostgresUrl
  .env.example                — add DB_BACKEND, DB_POSTGRES_URL
  src/db/repositories/*.ts    — getDb().prepare().X() → getAdapter().queryX()
  tests/helpers/test-db.ts    — use adapter for cleanup
  package.json                — add pg, @types/pg
