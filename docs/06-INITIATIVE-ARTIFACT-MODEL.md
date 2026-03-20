# Phase 6 -- Initiative, Artifact, and Participation Model

> Generated: 2026-03-12 | Purpose: Preserve deliverables across transient agents and support heterogeneous agent participation in VALOR initiatives

> **Scope Note (added 2026-03-19):** This document references Engram and Operative as separate SIT projects with their own responsibilities. They are NOT VALOR dependencies. The boundary descriptions below define what VALOR owns vs. what those independent projects own, to prevent scope bleed. See `CLAUDE.md` Scope Boundary section.

---

## Summary

VALOR should treat the **initiative** as the durable collaborative space and the **agent** as a transient contributor.

This means:

- Deliverables must be preserved independently of any single agent runtime
- Agents may be `operative`, `openclaw`, `hermes`, or future runtimes
- Agents can join, contribute, hand off, disconnect, and rejoin without breaking initiative continuity
- Agent-local cognition stays local; collaborative history and artifacts belong to VALOR

The boundary is:

- **Operative** *(separate SIT project)*: execution runtime, prompt loop, local tools, local session state
- **Engram** *(separate SIT project)*: learned memory, extracted knowledge, preferences, strategies, patterns
- **VALOR** *(this project)*: initiative state, missions, artifacts, communications, approvals, provenance, participation

---

## Design Principles

1. **Initiatives outlive agents.** A project does not disappear because an agent exits.
2. **Artifacts are first-class.** Reports, plans, patches, links, screenshots, manifests, and approvals are preserved with provenance.
3. **Participation is explicit.** Agent involvement is modeled as an assignment record, not inferred from chat logs.
4. **Communications are durable.** Human-to-agent and agent-to-agent exchanges belong to initiative or mission threads.
5. **Handoffs are normal.** Any agent should be able to continue work from preserved initiative context.
6. **Runtime-agnostic orchestration.** VALOR governs work regardless of whether the agent runs on OpenClaw, Operative, Hermes, or something else.

---

## Core Model

```text
Initiative
  -> Missions
  -> Threads
  -> Artifacts
  -> Participants
  -> Assignments
  -> Decisions / Approvals
  -> Event Log
```

### Initiative

The top-level collaborative space. An initiative contains strategy, active work, communications, preserved outputs, and operational history.

### Mission

A scoped unit of work inside the initiative. Missions may produce artifacts, spawn sub-missions, or transfer between agents.

### Artifact

A preserved deliverable or evidence object tied to an initiative and optionally a mission.

### Participant

A human, agent, system, or external service that can contribute to an initiative.

### Assignment

A time-bounded relationship that records who is working on what, under which role and authority.

### Thread

A durable communication channel. Threads preserve human-to-agent and agent-to-agent dialogue independently from any one agent's local memory.

---

## Proposed Schemas

### Initiative

```typescript
import { z } from "zod";

export const InitiativeStatus = z.enum([
  "draft",
  "active",
  "paused",
  "blocked",
  "complete",
  "archived",
]);

export const InitiativeSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1), // short stable slug
  title: z.string().min(1),
  objective: z.string().min(1),
  status: InitiativeStatus,

  strategy: z.object({
    north_star: z.string(),
    constraints: z.array(z.string()),
    success_criteria: z.array(z.string()),
    budget_usd: z.number().nonnegative().optional(),
    deadline_at: z.string().datetime().optional(),
  }),

  owner_participant_id: z.string().uuid().nullable(),
  lead_agent_id: z.string().uuid().nullable(),

  tags: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
```

### Artifact

```typescript
export const ArtifactKind = z.enum([
  "brief",
  "plan",
  "report",
  "decision_record",
  "spec",
  "code_patch",
  "pull_request",
  "commit",
  "build_log",
  "test_result",
  "deployment_manifest",
  "dashboard_snapshot",
  "dataset",
  "image",
  "link",
  "other",
]);

export const ArtifactStatus = z.enum([
  "draft",
  "published",
  "superseded",
  "rejected",
  "archived",
]);

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  initiative_id: z.string().uuid(),
  mission_id: z.string().uuid().nullable(),
  thread_id: z.string().uuid().nullable(),

  kind: ArtifactKind,
  status: ArtifactStatus,
  title: z.string().min(1),
  summary: z.string().default(""),

  storage: z.object({
    type: z.enum(["inline", "file", "url", "git"]),
    uri: z.string(),
    mime_type: z.string().nullable(),
    content_hash: z.string().nullable(),
    size_bytes: z.number().int().nonnegative().nullable(),
  }),

  provenance: z.object({
    created_by_participant_id: z.string().uuid(),
    created_by_agent_id: z.string().uuid().nullable(),
    source_event_id: z.string().uuid().nullable(),
    derived_from_artifact_ids: z.array(z.string().uuid()),
    verified_by_participant_id: z.string().uuid().nullable(),
  }),

  labels: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

### Participant

```typescript
export const ParticipantType = z.enum([
  "human",
  "agent",
  "system",
  "external_service",
]);

export const ParticipantSchema = z.object({
  id: z.string().uuid(),
  type: ParticipantType,
  display_name: z.string().min(1),
  callsign: z.string().nullable(),

  agent_runtime: z.enum([
    "operative",
    "openclaw",
    "hermes",
    "claude_api",
    "ollama",
    "custom",
  ]).nullable(),

  identity_ref: z.string().nullable(),
  capabilities: z.array(z.string()),
  status: z.enum(["active", "idle", "offline", "retired"]),
  joined_at: z.string().datetime(),
  last_seen_at: z.string().datetime().nullable(),
});
```

### Assignment

```typescript
export const AssignmentStatus = z.enum([
  "proposed",
  "active",
  "paused",
  "completed",
  "released",
  "revoked",
]);

export const AssignmentSchema = z.object({
  id: z.string().uuid(),
  initiative_id: z.string().uuid(),
  mission_id: z.string().uuid().nullable(),
  participant_id: z.string().uuid(),

  role: z.string(),
  status: AssignmentStatus,
  authority: z.object({
    can_dispatch: z.boolean(),
    can_approve: z.boolean(),
    can_publish_artifacts: z.boolean(),
    tool_policy_ref: z.string().nullable(),
  }),

  assigned_by_participant_id: z.string().uuid(),
  handoff_from_assignment_id: z.string().uuid().nullable(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  notes: z.string().default(""),
});
```

### Thread

```typescript
export const ThreadKind = z.enum([
  "initiative",
  "mission",
  "approval",
  "handoff",
  "incident",
  "artifact_review",
]);

export const ThreadSchema = z.object({
  id: z.string().uuid(),
  initiative_id: z.string().uuid(),
  mission_id: z.string().uuid().nullable(),
  kind: ThreadKind,
  title: z.string().min(1),
  status: z.enum(["open", "resolved", "archived"]),
  created_by_participant_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

### Thread Message

```typescript
export const ThreadMessageSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  initiative_id: z.string().uuid(),
  mission_id: z.string().uuid().nullable(),

  sender_participant_id: z.string().uuid(),
  sender_assignment_id: z.string().uuid().nullable(),
  reply_to_message_id: z.string().uuid().nullable(),

  body: z.string(),
  attachments: z.array(z.string().uuid()),
  visibility: z.enum(["initiative", "mission", "private_approval"]),
  created_at: z.string().datetime(),
});
```

---

## Required Event Types

These event types should sit on top of the existing `EventEnvelope` model.

### Initiative events

- `initiative.created`
- `initiative.updated`
- `initiative.paused`
- `initiative.completed`
- `initiative.archived`

### Participant events

- `participant.registered`
- `participant.joined`
- `participant.left`
- `participant.heartbeat`
- `participant.retired`

### Assignment events

- `assignment.proposed`
- `assignment.accepted`
- `assignment.started`
- `assignment.paused`
- `assignment.completed`
- `assignment.released`
- `assignment.revoked`
- `assignment.handoff.requested`
- `assignment.handoff.completed`

### Thread events

- `thread.created`
- `thread.message.posted`
- `thread.message.edited`
- `thread.resolved`

### Artifact events

- `artifact.created`
- `artifact.published`
- `artifact.superseded`
- `artifact.attached`
- `artifact.verified`
- `artifact.archived`

### Mission and initiative linkage events

- `mission.linked_to_initiative`
- `mission.unlinked_from_initiative`
- `artifact.linked_to_mission`
- `artifact.promoted_to_initiative`

---

## Handoff Model

Handoffs should be explicit and artifact-backed.

Minimum handoff package:

1. Current mission status
2. Open blockers
3. Latest relevant artifacts
4. Pending approvals or decisions
5. Recommended next action
6. Confidence and risk note

Suggested artifact kinds for handoffs:

- `report` for human-readable summary
- `decision_record` for tradeoffs already considered
- `link` or `git` artifact for working code state
- `test_result` or `build_log` for verification evidence

---

## Persistence Rules

### VALOR must preserve

- Strategic intent for the initiative
- Mission definitions and state transitions
- All published artifacts and provenance
- Communications tied to initiative and mission threads
- Assignment history and handoff lineage
- Approval and decision records
- Event history sufficient for replay and audit

### VALOR should not own

- Full prompt transcripts for every runtime turn unless needed for audit
- Agent-private scratchpads
- Raw local tool traces by default
- Long-term semantic memory (owned by Engram, a separate project)

### Engram should hold *(separate project — not VALOR's responsibility to implement)*

- Stable preferences
- Reusable patterns
- Learned strategies
- Named entities and relationships
- Failure modes
- Verified observations worth recall later

### Operative should hold *(separate project — not VALOR's responsibility to implement)*

- Current session loop state
- Current execution context
- Tool routing and containment
- Runtime-local session history needed for immediate performance

---

## Why This Matters

This model prevents initiative continuity from depending on a single agent's runtime or memory shape.

Examples:

- An OpenClaw agent can draft a product strategy, publish it as an artifact, and leave.
- An Operative agent can take the same initiative, read the preserved strategy, and execute implementation missions.
- A Hermes agent can later join for market analysis, publish a report, and exit without disrupting the rest of the initiative.
- A human can review the artifact chain and decision history without needing access to any agent's private memory.

---

## Suggested Database Additions

Add the following tables to the VALOR engine state layer:

- `initiatives`
- `initiative_participants`
- `assignments`
- `threads`
- `thread_messages`
- `artifacts`
- `artifact_links`

Suggested supporting indexes:

- `artifacts (initiative_id, mission_id, kind, status)`
- `assignments (initiative_id, mission_id, participant_id, status)`
- `thread_messages (thread_id, created_at)`
- `events (initiative_id, mission_id, type, timestamp)`

---

## Recommended Next Implementation Steps

1. Add `InitiativeSchema`, `ArtifactSchema`, `ParticipantSchema`, `AssignmentSchema`, `ThreadSchema`, and `ThreadMessageSchema` to `valor-engine/src/types`.
2. Add SQLite migrations and repositories for initiatives, artifacts, assignments, threads, and participants.
3. Extend `EventEnvelope` producers to include `initiative_id` where relevant.
4. Require every completed mission to publish at least one terminal artifact or an explicit `no_artifact` outcome.
5. Add handoff generation as a first-class workflow.
6. Make agent registration and departure explicit so agents can enter and leave initiatives cleanly.

---

## Decision

VALOR should model initiatives and artifacts as durable system primitives, and agents as replaceable contributors operating against those primitives.

This preserves deliverables, supports heterogeneous agents, and makes long-running collaborative work robust to agent churn.
