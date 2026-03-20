# Task: Divisions Phase 2 — Dashboard UI, Dissolve, and Documentation

> Priority: MEDIUM — Phase 1 membership infrastructure must be complete first.
> Dependency: `tasks/divisions-phase1-membership.md` must be fully implemented and passing tests.

Read `CLAUDE.md` first — respect the Scope Boundary section.

## Problem

Phase 1 added the `division_members` junction table, `division-member-repo.ts`, and the membership API endpoints. But there is no way to see or manage division rosters from the dashboard, existing dashboard pages still use the old `agents.division_id` pattern for counting members, and agents have no documentation on multi-division membership.

## What Phase 1 Provides (Assumed Present)

These exist and work before this task starts:

- **Migration:** `division_members` junction table with `id`, `division_id`, `agent_id`, `role`, `assigned_at`, `assigned_by`
- **Repository:** `src/db/repositories/division-member-repo.ts` exporting: `addMember`, `removeMember`, `getMember`, `updateMemberRole`, `getRoster`, `getAgentDivisions`, `getDivisionLead`, `transferLead`
- **API endpoints:** `GET /divisions/:id/roster`, `POST /divisions/:id/members`, `DELETE /divisions/:id/members/:agentId`, `PUT /divisions/:id/members/:agentId/role`, `POST /divisions/:id/lead`, `GET /divisions/:id/lead`, `GET /agents/:agentId/divisions`
- **Events:** `division.member.added`, `division.member.removed`, `division.member.role_changed`, `division.lead.transferred`

If any of these are missing, stop and complete Phase 1 first.

## What to Build

### 1. Dashboard Page (`src/dashboard/pages/divisions.ts`)

New file exporting `divisionsPage` as a `new Hono()`.

#### List View (`GET /` — mounted at `/dashboard/divisions`)

Follow the card grid pattern from `src/dashboard/pages/overview.ts` (`divisionCard` function).

**Filter bar** — same pattern as agents page:
- `all` → `/dashboard/divisions`
- `has-lead` → `/dashboard/divisions?filter=has-lead`
- `leaderless` → `/dashboard/divisions?filter=leaderless`

Filter logic: call `getRoster(div.id)` per division. `has-lead` keeps divisions with a roster entry where `role === "lead"`. `leaderless` keeps the rest.

**Division card** — card grid `sm:grid-cols-2 lg:grid-cols-3`. Each card links to `/dashboard/divisions?id=<div.id>`. Structure:

- Row 1: division name + namespace (monospace)
- Row 2: lead callsign + health dot, or "No lead" italic
- Row 3: stats grid — member count, active missions, total missions
- Row 4: roster preview — up to 3 callsign badges, "+N more" overflow

Member count from `getRoster().length`. Active mission count excludes terminal statuses.

**Empty state:** `"No divisions registered."`

#### Detail View (same route, when `?id=` param present)

When `c.req.query("id")` is set, render detail instead of list. Same pattern as `artifacts.ts`.

**Structure:**
- Breadcrumb: `Divisions › Division Name`
- Header: name, namespace badge, lead info
- **Roster table** with columns:
  - Callsign (with agent ID below in gray)
  - Role (colored badge: lead=accent, member=gray, operative=blue)
  - Health (use `healthBadge()` pattern from agents page)
  - Last Heartbeat (relative time)
  - Also In — call `getAgentDivisions()`, filter out current division, show remaining as muted text
  - Actions: "Remove" button (disabled for lead, red style), "Change Role" inline `<select>` (member/operative options, no lead option)
- **Add Member form** — select agent (exclude current roster) + role select (member/operative) + Add button. JS: `apiCall('POST', '/divisions/ID/members', {agent_id, role}).then(() => location.reload())`
- **Transfer Lead form** — select from current roster members (exclude current lead) + Transfer button. JS: `apiCall('POST', '/divisions/ID/lead', {agent_id}).then(() => location.reload())`
- **Active Missions panel** — compact list of missions scoped to this division. Each row: title, status badge, assigned agent callsign. Empty state: `"No active missions."`

### 2. Wire Divisions Page Into Dashboard

**`src/dashboard/pages/index.ts`** — add export:
```typescript
export { divisionsPage } from "./divisions.js";
```

**`src/dashboard/index.ts`** — import and mount:
```typescript
dashboardRoutes.route("/divisions", divisionsPage);
```

**`src/dashboard/layout.ts`** — add to `NAV_ITEMS` after "Agents":
```typescript
{ href: "/dashboard/divisions", label: "Divisions", icon: "building" },
```

### 3. Update Agents Page (`src/dashboard/pages/agents.ts`)

Currently shows a single division badge per agent. Replace with multi-division display.

Import `getAgentDivisions`. For each agent, call `getAgentDivisions(agent.id)`. If non-empty, render multiple badges:

```html
<div class="flex flex-wrap gap-1">
  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
    DIV_NAME <span class="text-gray-600">(ROLE)</span>
  </span>
</div>
```

If no memberships and no legacy `division_id`: show `"Unassigned"`.
If no memberships but has legacy `division_id`: show old single-division behavior as fallback.

### 4. Update Overview Page (`src/dashboard/pages/overview.ts`)

In `divisionCard` function:

- Replace `agents.filter(a => a.division_id === div.id)` with `getRoster(div.id)` from member repo
- Use `roster.length` for member count
- Add roster preview row: up to 3 callsign badges + overflow
- Keep existing lead lookup via `div.lead_agent_id`, but also check roster for lead as fallback

### 5. Dissolve Endpoint (`src/api/divisions.ts`)

Add `POST /divisions/:id/dissolve` — Director-only.

Logic:
1. Verify division exists (404)
2. Check for active missions (status not in complete/aar_complete/failed/aborted) — if any, return 409 with `active_mission_count`
3. Get roster, collect affected agent IDs
4. Remove all members via `removeMember()` for each (note: must handle lead removal — either transfer lead away first or bypass the lead check internally)
5. Clear `agents.division_id` for any agent pointing to this division
6. Clear `divisions.lead_agent_id`
7. Publish `division.dissolved` event with `{ division_id, affected_agent_ids }`
8. Return `{ ok: true, division_id, affected_agents: [...] }`

**Design decision:** Do NOT delete the division row or add a `dissolved_at` column. The division becomes an empty shell. Mission history FKs remain valid. This is simpler.

**Lead removal during dissolve:** The dissolve operation needs to remove the lead, but `removeMember` blocks lead removal. Options:
- Call `transferLead` to a dummy/null first — awkward
- Add an internal `forceRemoveMember` that skips the lead check — used only by dissolve
- Demote lead to member first via direct SQL, then remove all — simplest

Choose whichever keeps the code cleanest. Document the choice in a comment.

Add `requireDirector` helper to `divisions.ts` (same pattern as `missions.ts`).

### 6. SKILL.md Update

Add a new section **"7. Divisions"** after the Discovery section. Renumber WebSocket to 8 and Artifacts to 9.

Content:

```markdown
## 7. Divisions

Divisions are teams of agents organized around a mission domain — Code, Operations, R&D, Business, etc. Each division has a namespace, a lead agent, and a roster of members.

### Multi-Division Membership

Agents can belong to multiple divisions with different roles:

| Role | Description |
|------|-------------|
| `lead` | Division authority. Receives escalations, sets priorities. One per division. |
| `member` | Full participant. Receives missions and broadcasts within the division. |
| `operative` | Task-focused. Lower autonomy, receives dispatched work from the lead. |

Division membership is **Director-controlled**. Agents cannot self-assign.

### Discover Your Divisions

```
GET /agents/:agentId/divisions
```

Returns your division memberships with role and division details.

### Division Endpoints (Agent-Accessible)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/divisions` | List all divisions |
| `GET` | `/divisions/:id` | Get division details |
| `GET` | `/divisions/:id/roster` | List all members of a division |
| `GET` | `/divisions/:id/lead` | Get the current lead |
| `GET` | `/agents/:agentId/divisions` | Your division memberships |

### Division Endpoints (Director Only)

Require `X-VALOR-Role: director` header:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/divisions/:id/members` | Add agent to division |
| `DELETE` | `/divisions/:id/members/:agentId` | Remove agent |
| `PUT` | `/divisions/:id/members/:agentId/role` | Change role |
| `POST` | `/divisions/:id/lead` | Transfer leadership |
| `POST` | `/divisions/:id/dissolve` | Dissolve division |
```

### 7. Tests

#### Dashboard tests — add to `tests/dashboard/dashboard.test.ts`

New `describe("Divisions page", ...)` block.

1. **List page renders cards with member counts** — createDivision + createAgent + addMember, GET /dashboard/divisions, assert HTML contains division name, namespace, member count
2. **Detail page renders roster table** — GET /dashboard/divisions?id=ID, assert HTML contains agent callsign, role badge text
3. **Detail page shows cross-division membership** — agent in 2 divisions, detail view shows "Also in" for the other division
4. **Overview page shows roster data** — GET /dashboard, assert division card contains agent callsign from roster
5. **Agents page shows multiple division badges** — agent in 2 divisions, GET /dashboard/agents, assert both division names appear with roles
6. **Empty state** — GET /dashboard/divisions with no divisions, assert "No divisions registered"
7. **Leaderless filter** — division without lead + division with lead, GET ?filter=leaderless, assert only leaderless division appears

#### Dissolve API tests — add to `tests/api/divisions.test.ts`

1. **Dissolve removes all members** — createDivision + 2 agents + addMember, POST dissolve, assert 200, affected_agents length 2, getRoster returns empty
2. **Dissolve blocks with active missions** — createDivision + createMission(status: "streaming"), POST dissolve, assert 409 with active_mission_count
3. **Dissolve requires director** — POST dissolve without header, assert 403
4. **Dissolve clears legacy division_id** — agent with division_id set, POST dissolve, getAgent shows division_id null
5. **Dissolve with no members** — POST dissolve on empty division, assert 200, affected_agents empty

## Files to Create

1. `src/dashboard/pages/divisions.ts`

## Files to Modify

1. `src/dashboard/pages/index.ts` — add divisionsPage export
2. `src/dashboard/index.ts` — mount divisions route
3. `src/dashboard/layout.ts` — add Divisions to NAV_ITEMS
4. `src/dashboard/pages/agents.ts` — multi-division badges
5. `src/dashboard/pages/overview.ts` — roster-based member count + preview
6. `src/api/divisions.ts` — add dissolve endpoint + requireDirector
7. `SKILL.md` — add Divisions section, renumber subsequent sections
8. `tests/dashboard/dashboard.test.ts` — add divisions page tests
9. `tests/api/divisions.test.ts` — add dissolve tests

## What Phase 2 Does NOT Include

- No new database migrations (no schema changes)
- No changes to comms routing (still uses `agents.division_id` for broadcasts)
- No changes to gate evaluators or orchestrator
- No removal of `agents.division_id` column

## Do NOT

- Add database migrations or schema changes
- Add client-side JavaScript frameworks — server-rendered HTML with inline scripts only
- Add syntax highlighting or charting libraries
- Modify comms routing, gate evaluators, or orchestrator logic
- Reference or import Engram, Herd Pro, or Operative
