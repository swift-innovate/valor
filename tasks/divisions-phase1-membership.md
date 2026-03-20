# Task: Division Membership — Phase 1 (Roster Management)

> Priority: MEDIUM — Foundational for multi-agent division operations.
> Dependency: None. Additive only. All existing code continues to work unchanged.

Read `CLAUDE.md` first — respect the Scope Boundary section.

## Problem

Divisions exist but have no formal roster. There's no way to enumerate members, assign roles, transfer leadership, or have an agent in multiple divisions. The current `agents.division_id` is a loose pointer with no enforcement.

## Design

Phase 1 adds a `division_members` junction table **alongside** the existing `agents.division_id`. Existing code that reads `agents.division_id` or `divisions.lead_agent_id` keeps working — mutation functions keep both sides in sync. No existing queries, gate evaluators, orchestrator logic, or dashboard pages are modified.

## What to Build

### 1. Migration (`src/db/migrations/008-division-members.sql`)

```sql
-- Division membership roster
-- Phase 1: additive junction table, does not replace agents.division_id

CREATE TABLE IF NOT EXISTS division_members (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('lead', 'member', 'operative')),
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  FOREIGN KEY (division_id) REFERENCES divisions(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE(division_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_division_members_division_role ON division_members(division_id, role);
CREATE INDEX IF NOT EXISTS idx_division_members_agent ON division_members(agent_id);

-- Backfill from existing agents.division_id
INSERT OR IGNORE INTO division_members (id, division_id, agent_id, role, assigned_at, assigned_by)
SELECT
  'dmbr_backfill_' || agents.id,
  agents.division_id,
  agents.id,
  CASE
    WHEN divisions.lead_agent_id = agents.id THEN 'lead'
    ELSE 'member'
  END,
  agents.created_at,
  'system'
FROM agents
INNER JOIN divisions ON divisions.id = agents.division_id
WHERE agents.division_id IS NOT NULL;
```

The backfill uses deterministic IDs (`dmbr_backfill_` + agent ID) so the migration is idempotent. New records use `dmbr_` + nanoid.

### 2. Types (add to `src/types/division.ts`)

Do not modify existing schemas. Add:

```typescript
export const DivisionRole = z.enum(["lead", "member", "operative"]);
export type DivisionRole = z.infer<typeof DivisionRole>;

export const DivisionMemberSchema = z.object({
  id: z.string(),
  division_id: z.string(),
  agent_id: z.string(),
  role: DivisionRole,
  assigned_at: z.string(),
  assigned_by: z.string(),
});
export type DivisionMember = z.infer<typeof DivisionMemberSchema>;

export const DivisionRosterEntrySchema = DivisionMemberSchema.extend({
  callsign: z.string(),
  health_status: z.string(),
});
export type DivisionRosterEntry = z.infer<typeof DivisionRosterEntrySchema>;

export const AgentDivisionEntrySchema = z.object({
  division_id: z.string(),
  division_name: z.string(),
  namespace: z.string(),
  role: DivisionRole,
});
export type AgentDivisionEntry = z.infer<typeof AgentDivisionEntrySchema>;
```

Already exported from `src/types/index.ts` via the existing `export * from "./division.js"` line.

### 3. Repository (`src/db/repositories/division-member-repo.ts`)

New file. Follow patterns from `agent-repo.ts`: `nanoid` for IDs, `getDb()` for queries, `publish()` from `../../bus/index.js` for events.

ID prefix: `dmbr_`

#### Functions

**`addMember(input: { division_id, agent_id, role, assigned_by }): DivisionMember`**

1. Validate division exists. Throw if not found.
2. Validate agent exists. Throw if not found.
3. If `role` is `"lead"`, check for existing lead. If one exists, throw: `"Division already has a lead. Use transferLead to change leadership."`
4. INSERT into `division_members`. If UNIQUE constraint fails, throw with clear message.
5. **Backward compat:** If agent's `division_id` is null, set it to this division.
6. Publish `division.member.added` event.
7. Return created `DivisionMember`.

**`removeMember(division_id, agent_id, removed_by): boolean`**

1. Get member record. Return false if not found.
2. If member is lead, throw: `"Cannot remove division lead. Use transferLead first."`
3. DELETE from `division_members`.
4. **Backward compat:** If agent's `division_id` matches, set to null.
5. Publish `division.member.removed` event.
6. Return true.

**`getMember(division_id, agent_id): DivisionMember | null`**

Simple SELECT. Return null if not found.

**`updateMemberRole(division_id, agent_id, new_role, changed_by): DivisionMember | null`**

1. Get existing member. Return null if not found.
2. If `new_role` is `"lead"`, throw: `"Cannot promote to lead via updateMemberRole. Use transferLead."`
3. If existing role is `"lead"`, throw: `"Cannot demote lead via updateMemberRole. Use transferLead."`
4. UPDATE role.
5. Publish `division.member.role_changed` event with old_role and new_role.
6. Return updated record.

**`getRoster(division_id): DivisionRosterEntry[]`**

```sql
SELECT dm.*, a.callsign, a.health_status
FROM division_members dm
JOIN agents a ON a.id = dm.agent_id
WHERE dm.division_id = @division_id
ORDER BY
  CASE dm.role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 WHEN 'operative' THEN 2 END,
  a.callsign
```

Lead always sorts first.

**`getAgentDivisions(agent_id): AgentDivisionEntry[]`**

```sql
SELECT dm.division_id, d.name AS division_name, d.namespace, dm.role
FROM division_members dm
JOIN divisions d ON d.id = dm.division_id
WHERE dm.agent_id = @agent_id
ORDER BY d.name
```

**`getDivisionLead(division_id): DivisionMember | null`**

SELECT WHERE role = 'lead'.

**`transferLead(division_id, new_lead_agent_id, transferred_by): DivisionMember`**

Must use `getDb().transaction()` for atomicity:

1. Validate division exists. Throw if not.
2. Validate new lead agent exists. Throw if not.
3. Find current lead. If exists, UPDATE their role to `"member"`.
4. If new agent is not already a member, INSERT them with role `"lead"`. If they are, UPDATE role to `"lead"`.
5. **Backward compat:** UPDATE `divisions.lead_agent_id` to new agent.
6. Publish `division.lead.transferred` event (old_lead_agent_id may be null).
7. Return new lead's `DivisionMember` record.

Export all functions from `src/db/repositories/index.ts`.

### 4. Guard on `deleteDivision`

Modify `src/db/repositories/division-repo.ts` — add pre-checks to `deleteDivision`:

- Check `division_members` count. If > 0, throw: `"Cannot delete division with active members. Remove all members first."`
- Check missions with `status NOT IN ('complete', 'aar_complete', 'failed', 'aborted')`. If > 0, throw: `"Cannot delete division with active missions."`

Update DELETE route in `src/api/divisions.ts` to catch these errors and return 409.

### 5. API Endpoints

Add to existing `src/api/divisions.ts`. All mutation endpoints require `X-VALOR-Role: director` or `system`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/divisions/:id/roster` | Open | List members with agent details |
| `POST` | `/divisions/:id/members` | Director | Add agent. Body: `{agent_id, role?}` (default "member"). 201 on success, 409 if duplicate, 404 if division/agent missing |
| `DELETE` | `/divisions/:id/members/:agentId` | Director | Remove agent. 409 if lead, 404 if not member |
| `PUT` | `/divisions/:id/members/:agentId/role` | Director | Change role. Body: `{role}`. 400 if role is "lead" |
| `POST` | `/divisions/:id/lead` | Director | Transfer leadership. Body: `{agent_id}` |
| `GET` | `/divisions/:id/lead` | Open | Get current lead |

Add to `src/api/agents.ts`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/agents/:agentId/divisions` | Open | List agent's division memberships |

### 6. Events

All use `publish()` with `source: { id: "division-membership", type: "system" }`.

| Event Type | Payload |
|------------|---------|
| `division.member.added` | `{ division_id, agent_id, role, assigned_by }` |
| `division.member.removed` | `{ division_id, agent_id, removed_by }` |
| `division.member.role_changed` | `{ division_id, agent_id, old_role, new_role, changed_by }` |
| `division.lead.transferred` | `{ division_id, old_lead_agent_id, new_lead_agent_id, transferred_by }` |

### 7. Tests

#### `tests/db/division-members.test.ts` — Repository tests

Use `freshDb()` / `cleanupDb()` pattern. Create helper functions for test fixtures.

**Required test cases:**

1. `addMember` — creates member with `dmbr_` prefix ID
2. `addMember` — sets agent's `division_id` if null (backward compat)
3. `addMember` — does NOT overwrite agent's `division_id` if already set
4. `addMember` — rejects duplicate (same division + agent)
5. `addMember` — rejects role "lead" (must use transferLead)
6. `addMember` — throws if division not found
7. `addMember` — throws if agent not found
8. `removeMember` — removes and returns true
9. `removeMember` — sets agent's `division_id` to null if matched (backward compat)
10. `removeMember` — returns false if not found
11. `removeMember` — throws if target is lead
12. `getMember` — returns member or null
13. `updateMemberRole` — changes role
14. `updateMemberRole` — rejects promotion to lead
15. `updateMemberRole` — rejects demotion of lead
16. `updateMemberRole` — returns null for non-existent membership
17. `getRoster` — returns roster with agent details
18. `getRoster` — lead sorts first
19. `getRoster` — returns empty array for no members
20. `getAgentDivisions` — returns all divisions
21. `getAgentDivisions` — returns empty array for no memberships
22. `getDivisionLead` — returns lead or null
23. `transferLead` — demotes old lead, promotes new
24. `transferLead` — auto-adds new agent if not a member
25. `transferLead` — updates `divisions.lead_agent_id` (backward compat)
26. `transferLead` — works with no existing lead
27. `transferLead` — throws if division not found
28. `transferLead` — throws if agent not found
29. `deleteDivision` — throws with active members
30. `deleteDivision` — throws with active missions
31. `deleteDivision` — succeeds when empty

**Event tests (subscribe before calling, assert payload):**

32. `addMember` publishes `division.member.added`
33. `removeMember` publishes `division.member.removed`
34. `updateMemberRole` publishes `division.member.role_changed`
35. `transferLead` publishes `division.lead.transferred`

#### `tests/api/divisions.test.ts` — API tests

Use Hono `app.request()` pattern with `freshDb()` / `cleanupDb()`.

1. `GET /divisions/:id/roster` — returns roster
2. `GET /divisions/:id/roster` — 404 for missing division
3. `POST /divisions/:id/members` — 201, returns member
4. `POST /divisions/:id/members` — 403 without director header
5. `POST /divisions/:id/members` — 409 for duplicate
6. `POST /divisions/:id/members` — 404 for missing division
7. `POST /divisions/:id/members` — 404 for missing agent
8. `POST /divisions/:id/members` — defaults role to "member"
9. `DELETE /divisions/:id/members/:agentId` — removes member
10. `DELETE /divisions/:id/members/:agentId` — 409 for lead
11. `DELETE /divisions/:id/members/:agentId` — 404 if not member
12. `DELETE /divisions/:id/members/:agentId` — 403 without auth
13. `PUT /divisions/:id/members/:agentId/role` — changes role
14. `PUT /divisions/:id/members/:agentId/role` — 400 for "lead"
15. `POST /divisions/:id/lead` — transfers leadership
16. `POST /divisions/:id/lead` — 404 for missing division
17. `GET /divisions/:id/lead` — returns lead
18. `GET /divisions/:id/lead` — 404 when no lead
19. `GET /agents/:agentId/divisions` — returns memberships
20. `GET /agents/:agentId/divisions` — 404 for missing agent
21. `DELETE /divisions/:id` — 409 with members
22. `DELETE /divisions/:id` — 409 with active missions

## Files to Create

1. `src/db/migrations/008-division-members.sql`
2. `src/db/repositories/division-member-repo.ts`
3. `tests/db/division-members.test.ts`
4. `tests/api/divisions.test.ts`

## Files to Modify

1. `src/types/division.ts` — add new schemas
2. `src/db/repositories/index.ts` — export new repo functions
3. `src/db/repositories/division-repo.ts` — add guards to `deleteDivision`
4. `src/api/divisions.ts` — add 6 new routes, update DELETE for 409
5. `src/api/agents.ts` — add `GET /:id/divisions`

## What Phase 1 Does NOT Include

- No dashboard changes (Phase 2)
- No SKILL.md update (Phase 2)
- No changes to existing queries that use `agents.division_id`
- No changes to comms routing, gate evaluators, or orchestrator
- No dissolve endpoint (Phase 2)
- No changes to `lead-instantiation.ts`

## Do NOT

- Reference or import Engram, Herd Pro, or Operative
- Modify existing `agents.division_id` column or any query that reads it
- Modify `lead-instantiation.ts`, `orchestrator.ts`, `evaluators.ts`, or dashboard pages
- Add new npm dependencies
- Drop or alter the `agents` or `divisions` tables
