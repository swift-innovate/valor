# Task: Artifacts — Shared Content Between Agents

> Priority: HIGH — Agents are actively trying to share code and can't.
> Dependency: Comms system must be working (it is).

Read `CLAUDE.md` first — respect the Scope Boundary section.

## Problem

Agents can exchange text messages but have no way to share structured content
like code, configurations, scripts, analysis results, or documents. When Mira
writes code for Tracer, she has to paste it inline in a chat message body. There's
no way to name it, version it, reference it later, or render it properly.

## Design

Two pieces:

1. **Artifacts table** — persistent named content that lives independent of any
   single message. Agents create artifacts, other agents reference them.
2. **Attachments on messages** — comms messages can optionally include artifact IDs
   so the dashboard renders them inline with the message.

### Why a separate table instead of just bigger message bodies?

- Artifacts can be referenced across conversations
- Artifacts can be updated/versioned without resending
- Artifacts have their own content type (code, markdown, config, data)
- Artifacts become the building blocks for mission deliverables later

## What to Build

### 1. Artifact Schema (`src/types/artifact.ts`)

```typescript
export const ArtifactType = z.enum([
  "code",        // Source code (has language field)
  "markdown",    // Markdown document
  "config",      // Configuration (YAML, JSON, TOML, env)
  "data",        // Structured data (JSON, CSV)
  "text",        // Plain text
  "log",         // Log output
]);

export const ArtifactSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  content_type: ArtifactType,
  language: z.string().nullable(),   // "typescript", "python", "yaml", etc. — for code/config syntax highlighting
  content: z.string(),               // The actual content
  summary: z.string().nullable(),    // Optional one-liner description
  created_by: z.string(),            // Agent ID or "director"
  conversation_id: z.string().nullable(), // Conversation it was created in (if any)
  version: z.number().int().default(1),
  created_at: z.string(),
  updated_at: z.string(),
});
```

### 2. DB Migration (`007-artifacts.sql`)

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL,
  language TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  created_by TEXT NOT NULL,
  conversation_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_created_by ON artifacts(created_by);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(content_type);
```

### 3. Artifact Repository (`src/db/repositories/artifact-repo.ts`)

- `createArtifact(input)` — create and return
- `getArtifact(id)` — get by ID
- `updateArtifact(id, updates)` — update content, bumps version
- `listArtifacts(filters?)` — filter by created_by, conversation_id, content_type
- `listArtifactsByConversation(conversationId)` — all artifacts shared in a conversation
- `deleteArtifact(id)` — delete (Director only in API layer)

### 4. API Routes (`src/api/artifacts.ts`)

```
POST   /artifacts              — Create an artifact
GET    /artifacts               — List artifacts (filterable)
GET    /artifacts/:id           — Get single artifact with full content
PUT    /artifacts/:id           — Update artifact (content, title, summary — bumps version)
DELETE /artifacts/:id           — Delete artifact (Director only via X-VALOR-Role)
GET    /artifacts/conversation/:conversationId — All artifacts in a conversation
```

Wire into `src/api/index.ts` and mount in `src/index.ts` as `app.route("/artifacts", artifactRoutes)`.

### 5. Comms Integration

Add an optional `attachments` field to `CommsMessageSchema`:

```typescript
export const CommsMessageSchema = z.object({
  // ... existing fields ...
  
  // Attachments — artifact IDs to display with this message
  attachments: z.array(z.string()).default([]),
});
```

When an agent sends a message with attachments, the comms-repo validates that
each artifact ID exists.

The dashboard comms page renders attachments inline below the message body:
- Code artifacts get a syntax-highlighted code block with title and language badge
- Markdown artifacts render as formatted text
- Config/data artifacts get a collapsible code block
- Text/log artifacts get a monospace block

### 6. Agent Workflow

An agent that wants to share code does this:

```
1. POST /artifacts
   {
     "title": "engram-memory-bridge.ts",
     "content_type": "code",
     "language": "typescript",
     "content": "import { Engram } from 'engram';\n...",
     "summary": "Bridge module connecting Engram recall to OpenClaw session context",
     "created_by": "agt_mira456",
     "conversation_id": "conv_abc123"
   }

2. POST /comms/messages
   {
     "from_agent_id": "agt_mira456",
     "to_agent_id": "agt_tracer789",
     "subject": "Here's the memory bridge",
     "body": "Built the bridge module. Key design decisions: ...",
     "attachments": ["art_xyz789"],
     "conversation_id": "conv_abc123",
     "category": "response"
   }
```

### 7. Dashboard: Artifact Rendering in Comms

In `src/dashboard/pages/comms.ts`, when rendering a message that has attachments:

- After the message body, render each attached artifact as a card:
  - Header: title + content_type badge + language badge (if code)
  - Content: the artifact content in a `<pre><code>` block
  - For code artifacts: use a dark background with monospace font, scrollable if long
  - For markdown: render as HTML (or just show raw markdown for now)
  - Truncate to first 30 lines with "Show more" if artifact is long

The artifact lookup can be done at render time — the comms page already queries
messages, so just add an artifact lookup for any message that has attachments.

### 8. Dashboard: Artifacts Page (optional but recommended)

Add `/dashboard/artifacts` page showing all artifacts:
- Filterable by agent, content_type, conversation
- Each row: title, type, language, created_by (callsign), conversation link, version, timestamp
- Click to view full content

Add to NAV_ITEMS in layout.ts:
```typescript
{ href: "/dashboard/artifacts", label: "Artifacts", icon: "file-code" },
```

### 9. SKILL.md Update

Add an Artifacts section:

```markdown
## Sharing Content: Artifacts

When you need to share code, configs, or documents with other agents, create
an artifact and attach it to your message.

### Create an Artifact
POST /artifacts

### Attach to a Message
Include the artifact ID in the `attachments` array when sending a comms message.
```

### 10. Tests

- Create artifact (code, markdown, config types)
- Get artifact by ID
- Update artifact bumps version
- List artifacts filtered by agent, conversation, type
- Send message with attachment (valid artifact ID)
- Send message with invalid attachment ID (should fail or warn)
- Dashboard renders artifact inline with message
- Director can delete artifacts, agents cannot

## Event Bus

Publish on artifact changes:
- `artifact.created` — payload includes artifact_id, title, content_type, created_by
- `artifact.updated` — payload includes artifact_id, new version
- `artifact.deleted` — payload includes artifact_id

## Do NOT

- Reference or import Engram, Herd Pro, or Operative
- Store binary files (this is text content only for now)
- Build a full file system — this is named text blobs with metadata
- Add syntax highlighting libraries server-side — just use `<pre><code>` with CSS
