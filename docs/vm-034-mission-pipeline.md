# Mission VM-034: Mission Pipeline Overhaul

## Problem Statement

The VALOR mission pipeline has several issues that make it unusable for daily operations:

1. **Two disconnected mission systems.** The DB-backed system (`/missions` API + orchestrator + gates + AAR + stream supervisor) and the NATS-backed system (`/api/missions-live` + nats-state.ts) run independently. The Director dispatcher publishes MissionBriefs to NATS but never creates DB missions. The orchestrator's gate system, AAR pipeline, and stream supervisor never get invoked for Director-dispatched work.

2. **Dashboard shows unhelpful data.** Mission titles are just IDs ("VM-002"). The operative column shows "director" instead of the actual assigned operative. Sub-missions from DECOMPOSE aren't linked to their parent. Stuck missions have no recovery controls (no reassign, no re-dispatch). The default view shows all missions including terminal ones.

3. **Routing heuristics reference non-existent agents.** The system prompt has hardcoded patterns like `"debug code" → Forge`, `"security audit" → Rook` but no agent cards exist for these callsigns. The dynamic roster already handles routing — the hardcoded heuristics cause wasted classification cycles and forced ESCALATEs.

4. **Operative consumer is a stub.** The execution layer is a 5-second setTimeout that publishes fake progress sitreps. Nothing real happens when a mission is dispatched.

## Scope for This Mission

Focus on items 2 and 3 — the dashboard and system prompt. Items 1 and 4 are larger architectural changes that should be separate missions.

---

## Task 1: Fix the System Prompt Routing Heuristics

**File:** `src/director/system-prompt.md`

### 1a. Remove hardcoded operative names from routing heuristics

The "Routing Heuristics" section contains hardcoded patterns like:
```
"debug code" → Forge
"write blog post" → Eddie
"check sensors" → Zeke
"security audit" → Rook
"schedule meeting" → Mira
"market analysis" → Herbie
"monitor service" → Paladin
"architecture decision" → Gage
```

And cross-domain patterns that reference the same names.

**Replace** the hardcoded operative names with **capability-based** routing guidance that works with whatever agents are in the live roster. The heuristics should say things like:

- "code debugging tasks" → route to the operative whose skills include `code`, `debugging`, or `development`
- "content writing tasks" → route to the operative with `writing`, `content`, or `marketing` skills
- "sensor/IoT/ranch tasks" → route to the operative with `homestead_ops`, `sensors`, or `automation` skills
- "security tasks" → route to the operative with `security`, `red_team`, or `audit` skills

The key insight: the `{{OPERATIVE_ROSTER}}` section already lists each operative's skills. The LLM should match mission text to skills in the roster, not to hardcoded callsign names.

Keep the **decision type guidance** (ROUTE vs DECOMPOSE vs TASK vs CONVERSE) — that's correct. Only change the operative-specific routing patterns.

### 1b. Add a fallback instruction

Add a clear instruction after the routing heuristics:

> If no registered operative's skills match the mission, use decision: "ESCALATE" with a clear explanation of what skills are needed. Never route to an operative name that does not appear in the Operative Roster section above.

---

## Task 2: Dashboard — Default to Non-Terminal Missions

**File:** `src/dashboard/pages/missions-live.ts`

### 2a. Change the default view

When the page loads with no query parameters (`/dashboard/missions`), the current code calls `natsState.getMissions({})` which returns everything.

Change the default behavior: when no `status` query parameter is provided and `showArchived` is false, filter to only show non-terminal missions (pending, active, blocked). The "All" stat card link at the top should still show everything when clicked.

Implementation: add a `defaultFilter` flag. If no status filter and not archived view, only show missions where status is NOT `complete` and NOT `failed`.

```typescript
// After: let missions: DashboardMission[];
// Replace the existing logic with:
if (showArchived) {
  missions = natsState.getArchivedMissions();
} else if (statusFilter) {
  missions = natsState.getMissions({ status: statusFilter as any, operative: operativeFilter });
} else {
  // Default view: hide terminal missions
  const all = natsState.getMissions({ operative: operativeFilter });
  missions = all.filter(m => m.status !== "complete" && m.status !== "failed");
}
```

Update the "All" stat card to link to `?status=all` instead of `/dashboard/missions`. Add handling for `status=all` that shows everything:

```typescript
} else if (statusFilter === "all") {
  missions = natsState.getMissions({ operative: operativeFilter });
} else if (statusFilter) {
```

Update the stat card highlight logic so the default (no filter) highlights a new "Active" indicator instead of "All".

### 2b. Add reassign button for active/pending/blocked missions

In `rowActions()`, add a reassign button for non-terminal missions alongside the cancel button:

```typescript
if (!isTerminal) {
  btns.push(html`<button onclick="reassignMission('${m.mission_id}')"
    class="px-2 py-1 text-xs font-medium rounded bg-blue-900/60 hover:bg-blue-800 text-blue-300 transition-colors" title="Reassign">↗</button>`);
  btns.push(html`<button onclick="cancelMission('${m.mission_id}')"
    class="px-2 py-1 text-xs font-medium rounded bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors" title="Cancel">✕</button>`);
}
```

Add the `reassignMission()` JavaScript function to the script block. It should prompt for an operative name (using the known operative list from the server) and call `POST /api/missions-live/:id/reassign` with `{ operative: "name" }`.

Simple implementation using `prompt()` is fine for now:

```javascript
async function reassignMission(id) {
  var operative = prompt('Reassign to which operative?');
  if (!operative) return;
  var res = await fetch('/api/missions-live/' + id + '/reassign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operative: operative }),
  });
  if (res.ok) { showToast('Mission reassigned to ' + operative, 'success'); setTimeout(function(){ location.reload(); }, 500); }
  else { var d = await res.json(); showToast(d.error || 'Reassign failed', 'error'); }
}
```

### 2c. Show mission description as title, not mission ID

In `missionRow()`, the title column currently shows `m.title` which is often just the mission ID. Change it to show the first 80 characters of `m.description` if `m.title` matches the pattern `VM-\d+` (i.e., when the title IS the mission ID). If `m.title` is a real title (doesn't match the VM pattern), show it as-is.

```typescript
const displayTitle = /^VM-\d/.test(m.title) && m.description
  ? m.description.slice(0, 80) + (m.description.length > 80 ? "…" : "")
  : m.title;
```

Use `displayTitle` in the template instead of `m.title`.

### 2d. Show actual operative, not "director"

In the operative column, `m.assigned_to` shows "director" for missions the Director created. But the sitrep often says "Routed to forge (balanced, P1)" — the actual operative name is in the sitrep text.

Add a helper that extracts the real operative from the latest sitrep if `assigned_to` is "director":

```typescript
function resolveOperative(m: DashboardMission): string {
  if (m.assigned_to !== "director") return m.assigned_to;
  // Try to extract from sitrep: "Routed to <operative>" or "Decomposed into..."
  if (m.latest_sitrep) {
    const routeMatch = m.latest_sitrep.match(/Routed to (\w+)/i);
    if (routeMatch) return routeMatch[1];
    const decompMatch = m.latest_sitrep.match(/Decomposed into (\d+)/);
    if (decompMatch) return `${decompMatch[1]} sub-missions`;
  }
  return m.assigned_to;
}
```

Use `resolveOperative(m)` in the operative column instead of `m.assigned_to`.

---

## Task 3: Link Sub-Missions to Parents

**File:** `src/dashboard/pages/missions-live.ts`

When a mission's `latest_sitrep` contains sub-mission IDs (from DECOMPOSE), those IDs should be clickable links to the sub-mission detail page.

In the sitrep preview under the title, replace mission ID patterns (like `VM-002-4`) with links:

```typescript
function linkifyMissionIds(text: string): ReturnType<typeof html> {
  // Replace VM-XXX-N patterns with clickable links
  const linked = text.replace(/(VM-\d+(?:-\d+)?)/g, 
    '<a href="/dashboard/missions/$1" class="text-valor-400 hover:underline">$1</a>');
  return raw(linked);
}
```

Apply this to the `latest_sitrep` display in `missionRow()`.

---

## Constraints

- Do NOT restructure the mission system architecture (no merging DB + NATS systems — that's a separate mission)
- Do NOT modify the operative consumer (`src/consumers/operative-consumer.ts`)
- Do NOT add new npm dependencies
- Do NOT modify test files — but new tests for any new helper functions are welcome
- Match existing code style (Hono templates, Tailwind classes, TypeScript strict)
- All changes must pass `pnpm run typecheck`
- Default git branch: `main`

## Files to Modify

| File | Changes |
|------|---------|
| `src/director/system-prompt.md` | Replace hardcoded operative routing with capability-based guidance |
| `src/dashboard/pages/missions-live.ts` | Default filter, reassign button, display title fix, operative resolution, sub-mission links |

## Files to Optionally Create

| File | Purpose |
|------|---------|
| `tests/dashboard/missions-live-helpers.test.ts` | Unit tests for `resolveOperative()` and `linkifyMissionIds()` if extracted as standalone functions |

## Verification

1. `pnpm run typecheck` passes
2. `pnpm test` passes (existing tests should not break)
3. The system prompt no longer contains hardcoded callsigns (Forge, Zeke, Rook, etc.) in routing heuristics
4. The system prompt still has the `{{OPERATIVE_ROSTER}}` placeholder
5. The routing heuristics section references skills/capabilities, not names
