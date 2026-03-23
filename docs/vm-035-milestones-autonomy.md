# Mission VM-035: Initiative Milestones + Agent Autonomy Tiers

## Problem Statement

Two gaps prevent VALOR from managing long-term goals with multi-phase missions:

1. **Initiatives are flat containers.** An initiative has missions, but no phases, no ordering, no dependencies between missions, and no milestone-based progress. A long-term goal like "Launch Fracture Code Marketing Campaign" needs Phase 1 (research) → Phase 2 (draft) → Phase 3 (review/approve) → Phase 4 (send). The current model can't express this.

2. **Agents have no autonomy levels.** Every ambiguity escalates to the Director (human). There's no middle tier where an agent asks its division lead, or where a proven agent is trusted to self-dispatch. A Tier 1 division lead should be able to shepherd an initiative through phases without pulling the Director in at every gate.

## Part A: Initiative Milestones

### A1. New Migration — `011-milestones.sql`

Create in both `src/db/migrations/sqlite/` and `src/db/migrations/postgres/`:

```sql
-- Milestones within initiatives (ordered phases)
CREATE TABLE IF NOT EXISTS initiative_milestones (
  id             TEXT NOT NULL PRIMARY KEY,
  initiative_id  TEXT NOT NULL REFERENCES initiatives(id),
  title          TEXT NOT NULL,
  objective      TEXT NOT NULL DEFAULT '',
  sequence       INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending', 'active', 'complete', 'skipped')),
  target_date    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_initiative ON initiative_milestones(initiative_id);

-- Link missions to milestones (optional, alongside existing initiative_id)
ALTER TABLE missions ADD COLUMN milestone_id TEXT REFERENCES initiative_milestones(id);

CREATE INDEX IF NOT EXISTS idx_missions_milestone ON missions(milestone_id);

-- Cross-mission dependencies within an initiative
CREATE TABLE IF NOT EXISTS mission_dependencies (
  mission_id     TEXT NOT NULL REFERENCES missions(id),
  depends_on_id  TEXT NOT NULL REFERENCES missions(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mission_id, depends_on_id)
);
```

### A2. Milestone Repository — `src/db/repositories/milestone-repo.ts`

New file. Exports:

```typescript
// Types
export type MilestoneStatus = "pending" | "active" | "complete" | "skipped";

export interface Milestone {
  id: string;
  initiative_id: string;
  title: string;
  objective: string;
  sequence: number;
  status: MilestoneStatus;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface MilestoneProgress {
  total_missions: number;
  completed: number;
  failed: number;
  active: number;
  progress_pct: number;
}

// CRUD
export function createMilestone(input: {...}): Milestone;
export function getMilestone(id: string): Milestone | null;
export function listMilestones(initiativeId: string): Milestone[];  // ordered by sequence
export function updateMilestone(id: string, updates: {...}): Milestone | null;
export function deleteMilestone(id: string): boolean;

// Progress
export function getMilestoneProgress(id: string): MilestoneProgress;
// Same logic as getInitiativeProgress but scoped to milestone_id

// Mission assignment
export function assignMissionToMilestone(missionId: string, milestoneId: string): boolean;
// Sets both milestone_id AND initiative_id (from the milestone's parent)

// Dependencies
export function addMissionDependency(missionId: string, dependsOnId: string): boolean;
export function removeMissionDependency(missionId: string, dependsOnId: string): boolean;
export function getMissionDependencies(missionId: string): string[];  // returns depends_on_ids
export function getMissionDependents(missionId: string): string[];   // returns missions that depend on this one
export function areDependenciesMet(missionId: string): boolean;
// Checks if all depends_on missions are in complete/aar_complete status
```

### A3. Update Initiative Repository

In `initiative-repo.ts`, update `getInitiativeProgress()` to be milestone-aware:

```typescript
export interface InitiativeProgress {
  total_missions: number;
  completed: number;
  failed: number;
  active: number;
  progress_pct: number;
  milestones: {
    total: number;
    completed: number;
    active: number;
    current: string | null;  // title of the active milestone
  };
}
```

Progress calculation: if milestones exist, `progress_pct` is based on milestone completion (completed milestones / total milestones), not raw mission count. If no milestones, falls back to the current mission-count logic.

### A4. Milestone API Routes — `src/api/milestones.ts`

New Hono route module. Director-only write operations:

```
POST   /initiatives/:id/milestones          — Create milestone (Director only)
GET    /initiatives/:id/milestones          — List milestones (ordered by sequence)
GET    /milestones/:id                       — Get milestone with progress
PUT    /milestones/:id                       — Update milestone (Director only)
DELETE /milestones/:id                       — Delete milestone (Director only)
POST   /milestones/:id/missions             — Assign mission to milestone (Director only)
POST   /missions/:id/dependencies           — Add dependency (Director only)
DELETE /missions/:id/dependencies/:depId    — Remove dependency (Director only)
GET    /missions/:id/dependencies           — List dependencies
```

Mount in `src/index.ts` alongside existing routes.

### A5. Update Mission Schema

In `src/types/mission.ts`, add `milestone_id` to `MissionSchema`:

```typescript
milestone_id: z.string().nullable().default(null),
```

Update `mission-repo.ts` `createMission()` and `updateMission()` to handle `milestone_id` in the INSERT/UPDATE SQL.

### A6. Dashboard — Initiative Detail with Milestones

Update `src/dashboard/pages/initiatives.ts` to show milestones on the initiative detail view:

- Each milestone rendered as a collapsible section, ordered by sequence
- Milestone header shows: title, status badge, progress bar, target date
- Inside each milestone: table of assigned missions with status/operative/progress
- Missions not assigned to any milestone shown in a separate "Ungrouped" section
- Milestone status badges: pending (gray), active (blue), complete (green), skipped (gray strikethrough)

### A7. Tests

Create `tests/db/milestones.test.ts`:

- Milestone CRUD (create, read, list ordered by sequence, update, delete)
- Milestone progress calculation
- Mission assignment to milestone (sets both milestone_id and initiative_id)
- Mission dependency CRUD
- `areDependenciesMet()` — returns false when dependency is not complete, true when it is
- Initiative progress calculation with milestones (milestone-based vs mission-count-based)

---

## Part B: Agent Autonomy Tiers

### B1. New Migration — `012-autonomy.sql`

```sql
-- Agent autonomy tiers and permissions
ALTER TABLE agents ADD COLUMN autonomy_tier INTEGER NOT NULL DEFAULT 3
  CHECK(autonomy_tier IN (1, 2, 3));

ALTER TABLE agents ADD COLUMN autonomy_permissions TEXT NOT NULL DEFAULT '{}';
-- JSON object with permission flags

ALTER TABLE agents ADD COLUMN budget_per_mission_usd REAL NOT NULL DEFAULT 0;

ALTER TABLE agents ADD COLUMN escalate_to TEXT;
-- agent_id of the agent to escalate to (usually division lead)
-- NULL means escalate directly to Director

ALTER TABLE agents ADD COLUMN max_concurrent_missions INTEGER NOT NULL DEFAULT 1;

ALTER TABLE agents ADD COLUMN trust_score REAL NOT NULL DEFAULT 0;
-- 0-100, computed from mission history. Informational — does not gate anything automatically.

-- Promotion history (audit trail for tier changes)
CREATE TABLE IF NOT EXISTS autonomy_promotions (
  id           TEXT NOT NULL PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  from_tier    INTEGER NOT NULL,
  to_tier      INTEGER NOT NULL,
  promoted_by  TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### B2. Update Agent Types

In `src/types/agent.ts`:

```typescript
export const AutonomyTier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type AutonomyTier = z.infer<typeof AutonomyTier>;

export const AgentPermissions = z.object({
  self_dispatch: z.boolean().default(false),
  self_retry: z.boolean().default(false),
  peer_comms: z.boolean().default(true),
  sub_task_creation: z.boolean().default(false),
  artifact_creation: z.boolean().default(true),
}).default({});
export type AgentPermissions = z.infer<typeof AgentPermissions>;
```

Add to `AgentSchema`:

```typescript
autonomy_tier: AutonomyTier.default(3),
autonomy_permissions: AgentPermissions,
budget_per_mission_usd: z.number().nonneg().default(0),
escalate_to: z.string().nullable().default(null),
max_concurrent_missions: z.number().int().positive().default(1),
trust_score: z.number().min(0).max(100).default(0),
```

### B3. Default Permissions by Tier

When an agent's tier changes, set default permissions for that tier. These can be individually overridden.

```typescript
export const TIER_DEFAULTS: Record<AutonomyTier, AgentPermissions> = {
  1: { self_dispatch: true,  self_retry: true,  peer_comms: true,  sub_task_creation: true,  artifact_creation: true },
  2: { self_dispatch: true,  self_retry: true,  peer_comms: true,  sub_task_creation: false, artifact_creation: true },
  3: { self_dispatch: false, self_retry: false, peer_comms: true,  sub_task_creation: false, artifact_creation: true },
};
```

Tier 3 defaults: can talk to peers and create artifacts, but cannot self-dispatch, self-retry, or create sub-tasks. Everything else requires approval.

Tier 2: can self-dispatch and self-retry within their domain. Still can't create sub-tasks (that's delegation, which is a leadership action).

Tier 1: full permissions. Can create sub-tasks and delegate to agents in their division.

### B4. Promotion API

Add to agent routes (`src/api/agents.ts`):

```
POST /agents/:id/promote    — Promote agent to a higher tier (Director only)
POST /agents/:id/demote     — Demote agent to a lower tier (Director only)
GET  /agents/:id/autonomy   — Get agent's current autonomy settings
PUT  /agents/:id/autonomy   — Update individual permissions (Director only)
GET  /agents/:id/promotions — Get promotion history
```

Promote/demote endpoints:

```typescript
// POST /agents/:id/promote
// Body: { reason: "Completed 10 missions with 100% success rate" }
// Effect: tier 3→2 or 2→1. Sets TIER_DEFAULTS for new tier. Logs to autonomy_promotions.

// POST /agents/:id/demote
// Body: { reason: "Repeated failures on critical missions" }
// Effect: tier 1→2 or 2→3. Sets TIER_DEFAULTS for new tier. Logs to autonomy_promotions.
```

The PUT endpoint allows overriding individual permissions without changing the tier:

```typescript
// PUT /agents/:id/autonomy
// Body: { permissions: { self_retry: true } }
// Effect: merges into existing permissions. Does not change tier.
```

### B5. Update HIL Gate

In `src/gates/evaluators.ts`, update `hilGate` to respect agent autonomy:

```typescript
export const hilGate: GateEvaluator = (ctx) => {
  const agent = ctx.agent;

  // Tier 1 agents with self_dispatch bypass HIL (unless safety gate or budget breach)
  if (agent) {
    const permissions = agent.autonomy_permissions as AgentPermissions;
    if (permissions.self_dispatch && agent.autonomy_tier <= 2) {
      // Check budget
      if (agent.budget_per_mission_usd > 0 && ctx.mission.cost_usd > agent.budget_per_mission_usd) {
        return {
          gate: "hil",
          verdict: "escalate",
          reason: `Mission cost exceeds agent budget ($${ctx.mission.cost_usd} > $${agent.budget_per_mission_usd})`,
          details: { cost: ctx.mission.cost_usd, budget: agent.budget_per_mission_usd },
        };
      }
      return { gate: "hil", verdict: "pass", reason: `Agent ${agent.callsign} (Tier ${agent.autonomy_tier}) authorized for self-dispatch`, details: null };
    }
  }

  // Existing division-level HIL logic follows (unchanged)
  // ...
};
```

### B6. Update Escalation Chain

When an agent escalates, the engine should check `agent.escalate_to` first:

- If `escalate_to` is set → route escalation to that agent (usually division lead)
- If `escalate_to` is null OR the escalate-to agent is offline → escalate to Director

This affects the orchestrator's approval flow and the comms escalation routing. Update the escalation sitrep in `orchestrator.ts` to CC the `escalate_to` agent instead of only the Director when appropriate.

### B7. Agent Card Approval — Set Initial Tier

When an agent card is approved (`agent-card-repo.ts` `approveCard()`), the created agent should be Tier 3 with TIER_DEFAULTS[3] permissions. No change to the approval flow — just set the defaults.

### B8. Dashboard — Agent Autonomy Display

Update `src/dashboard/pages/agents.ts` to show:

- Autonomy tier badge (Tier 1/2/3 with color: gold/blue/gray)
- Permissions list (checkmarks for enabled, dashes for disabled)
- Escalation chain (who this agent escalates to)
- Trust score (if > 0)
- Promote/Demote buttons (Director only)

### B9. SKILL.md Update

Add a section to `SKILL.md` explaining autonomy tiers from the agent's perspective:

- Your tier determines what you can do without approval
- Tier 3: all missions require approval, escalate to your division lead
- Tier 2: self-dispatch within domain, escalate to division lead
- Tier 1: full autonomy, delegate to others, escalate to Director only for safety/cross-division
- Your tier is visible at `GET /agents/:id/autonomy`
- Promotions are manual — earn trust through successful mission completion

### B10. Tests

Create `tests/db/autonomy.test.ts`:

- Agent created with Tier 3 defaults
- Promote from Tier 3 → 2: permissions update to TIER_DEFAULTS[2]
- Promote from Tier 2 → 1: permissions update to TIER_DEFAULTS[1]
- Demote from Tier 1 → 2: permissions downgrade
- Cannot promote above Tier 1 or demote below Tier 3
- Individual permission override (PUT /autonomy)
- Promotion history logged
- HIL gate passes for Tier 1/2 with self_dispatch, blocks for Tier 3

Create `tests/gates/autonomy-hil.test.ts`:

- Tier 1 agent bypasses HIL gate
- Tier 2 agent with self_dispatch bypasses HIL gate
- Tier 3 agent blocked by HIL gate (escalate verdict)
- Budget breach blocks even Tier 1 agents
- Escalate_to routing: escalation goes to division lead, not Director

---

## Constraints

- Migration files go in both `sqlite/` and `postgres/` directories
- All new repos follow existing patterns (nanoid IDs, publish to event bus, Zod schemas)
- All new API routes are Director-only for write operations
- Agent types must remain backward compatible — existing agents get Tier 3 defaults via migration
- No changes to the Director classifier or dispatcher (autonomy is enforced at the gate/orchestrator level, not classification)
- All changes must pass `pnpm run typecheck` and `pnpm test`
- Default git branch: `main`

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `src/db/migrations/sqlite/011-milestones.sql` | Milestones + dependencies schema |
| `src/db/migrations/postgres/011-milestones.sql` | Postgres equivalent |
| `src/db/migrations/sqlite/012-autonomy.sql` | Agent autonomy columns + promotions table |
| `src/db/migrations/postgres/012-autonomy.sql` | Postgres equivalent |
| `src/db/repositories/milestone-repo.ts` | Milestone CRUD + dependencies + progress |
| `src/api/milestones.ts` | Milestone + dependency API routes |
| `tests/db/milestones.test.ts` | Milestone repo tests |
| `tests/db/autonomy.test.ts` | Autonomy tier + promotion tests |
| `tests/gates/autonomy-hil.test.ts` | HIL gate autonomy integration tests |

### Modified Files
| File | Change |
|------|--------|
| `src/types/agent.ts` | Add AutonomyTier, AgentPermissions, new fields to AgentSchema |
| `src/types/mission.ts` | Add milestone_id to MissionSchema |
| `src/db/repositories/initiative-repo.ts` | Milestone-aware progress calculation |
| `src/db/repositories/mission-repo.ts` | Handle milestone_id in INSERT/UPDATE |
| `src/db/repositories/agent-repo.ts` | Handle autonomy fields, parse JSON permissions |
| `src/db/repositories/agent-card-repo.ts` | Set Tier 3 defaults on approval |
| `src/db/repositories/index.ts` | Export milestone repo |
| `src/api/agents.ts` | Add promote/demote/autonomy endpoints |
| `src/api/index.ts` | Export milestone routes |
| `src/index.ts` | Mount milestone routes |
| `src/gates/evaluators.ts` | Update HIL gate for autonomy tiers |
| `src/dashboard/pages/initiatives.ts` | Milestone display on initiative detail |
| `src/dashboard/pages/agents.ts` | Autonomy tier display + promote/demote buttons |
| `SKILL.md` | Add autonomy section |

## Verification

1. `pnpm run typecheck` passes
2. `pnpm test` passes (all existing + new tests)
3. Existing agents get Tier 3 defaults after migration (backward compatible)
4. Creating a milestone and assigning missions to it works via API
5. Initiative progress reflects milestone completion when milestones exist
6. Promoting an agent from Tier 3 → 2 updates permissions and logs the promotion
7. HIL gate respects autonomy tier: Tier 1/2 with self_dispatch passes, Tier 3 escalates
