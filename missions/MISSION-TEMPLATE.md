# Mission Template

Copy this template when creating new missions for the VALOR mission board.

---

```markdown
### VM-XXX: <Title>
- **Assigned:** <Operative name>
- **Priority:** P0 | P1 | P2 | P3
- **Branch:** mission/VM-XXX
- **Depends on:** <VM-XXX, VM-YYY> or None
- **Description:** <What needs to be done. Be specific enough that the assigned operative can execute without additional clarification. Include file paths, module names, and technical context.>
- **Acceptance:** <How we know this is done. Measurable, verifiable criteria.>
- **Status:** Queued | In Progress | Blocked | Review | Done
- **Updated:** <ISO date>
- **Notes:** <Optional. Progress notes, blockers, context.>
```

---

## Priority Levels

| Level | Meaning | Response Time |
|-------|---------|---------------|
| **P0** | Critical blocker — nothing else progresses without this | Next available tick |
| **P1** | High priority — core path work | Within 24 hours |
| **P2** | Standard priority — important but not blocking | Within 48 hours |
| **P3** | Low priority — nice to have, do when idle | When queue is empty |

## Mission ID Convention

- Prefix: `VM-` (VALOR Mission)
- Numbers: Sequential, zero-padded to 3 digits (VM-001, VM-002, ...)
- Phase 0 missions: VM-001 through VM-009
- Phase 1 missions: VM-010 through VM-019
- Phase 2+: VM-020+

## Branch Convention

- Branch name: `mission/VM-XXX`
- Branch from: `main`
- Merge to: `main` (via PR or Director approval)
- Delete after merge

## Commit Convention

```
[<Operative>] <Short description>

Mission: VM-XXX
Operative: <Name>
Status: WIP | COMPLETE | REVIEW
```
