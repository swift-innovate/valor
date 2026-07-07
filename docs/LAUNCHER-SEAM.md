# Launcher Seam — Delegating Execution to External Agentic CLIs

**Status:** Draft for review — not yet scheduled
**Date:** 2026-07-06
**Relates to:** `docs/MVP-SCOPE.md` (folder-as-agent), `src/execution/` (operative loop),
`src/providers/adapters/*-cli-adapter.ts` (subscription inference), the substrate
conductor (`tools/dispatch.sh`), valor-v5 (`src/launcher/*`, `agents/*.toml`)

---

## 1. Problem

VALOR has two ways to use an installed agentic CLI (claude, codex, grok) and only
one of them exists:

| Seam | What the CLI does | Status |
|---|---|---|
| **Provider adapter** | One-shot inference. Tool use suppressed (`--max-turns 1`, read-only sandbox); VALOR's own Act loop does the file work through built-in tools. | ✅ Shipped (`codex_cli`, `grok_cli` adapters) |
| **Launcher** | Full agentic execution. The CLI gets a whole task and a workspace, uses its **own** tool loop, and VALOR validates the result. | ❌ This design |

The provider seam deliberately underuses these CLIs — they are coding harnesses,
and their value is their own tool loop. For code-heavy missions, delegating the
task wholesale (the substrate pattern) will beat VALOR's five-tool ReAct loop
doing file surgery through `read_file`/`write_file`.

The launcher seam makes VALOR what its name claims: an **orchestration engine**
that plans, dispatches, validates, and remembers — while the strongest available
executor does the hands-on work.

## 2. Design principles

1. **VALOR keeps the loop.** Observe→Plan→Act→Validate→Reflect→Evolve still runs.
   The launcher replaces the *Act phase* — not the mission. Planning, validation,
   memory, sitreps, and budgets stay VALOR's.
2. **The launcher — not the model — records results.** (valor-v5's rule.) The CLI
   writes files in the workspace; VALOR writes `progress.md`, `decisions.md`,
   status transitions, and memory. Never trust the model to self-report state.
3. **The workspace is the isolation boundary.** (substrate's rule.) Every launch
   is confined to a per-mission directory or a git worktree of a target repo.
   CLI-internal sandboxes are a second layer, configured per tier, not the
   primary defense.
4. **Same single model avenue.** Launcher selection and launcher model both come
   from `agent.md` / config — no new configuration surface.
5. **Mission branches live in the target repo, never in valor-engine**
   (per the 2026-07-06 branch-convention decision).

## 3. Interface

Mirrors valor-v5's `AgentLauncher`, adapted to folder-mission inputs:

```ts
// src/execution/launchers/launcher.ts
export interface LaunchInput {
  /** Absolute path the CLI is confined to (its cwd). */
  workspacePath: string;
  /** Path to task.md inside the workspace — the full task brief. */
  taskPath: string;
  timeoutMs: number;
  /** Resume a prior session for iterative refinement. */
  resumeSessionId?: string;
  /** Bare model name; omitted → the CLI's configured default. */
  model?: string;
}

export interface LaunchResult {
  state: 'completed' | 'failed' | 'timeout';
  /** The CLI's final report text (parsed from its output format). */
  report: string;
  sessionId: string | null;
  exitCode: number | null;
  durationMs: number;
  /** Real token usage when the CLI reports it (codex, claude); zeros otherwise. */
  usage: { input_tokens: number; output_tokens: number };
}

export interface OperativeLauncher {
  readonly name: 'claude-code' | 'codex' | 'grok';
  launch(input: LaunchInput): Promise<LaunchResult>;
  /** Binary present and answering --version. */
  detect(): Promise<boolean>;
}
```

A registry (`src/execution/launchers/registry.ts`) maps name → launcher,
populated at startup with the same auto-detection pattern as the CLI provider
adapters (`CODEX_CLI`, `GROK_CLI`, new `CLAUDE_CLI` — `auto|on|off`).

### CLI invocations (field-tested flags)

| Launcher | Invocation | Source of truth |
|---|---|---|
| claude-code | `claude -p "<kickoff>" --permission-mode acceptEdits --add-dir <ws> --output-format json` | substrate `dispatch.sh`; JSON output carries usage + session id |
| codex | `codex exec -C <ws> --skip-git-repo-check --json [-m model] [resume <id>]` — sandbox tier per §6 | substrate + shipped adapter's verified JSONL contract |
| grok | `grok --cwd <ws> --model <m> --permission-mode acceptEdits --output-format json -p "<kickoff>" [-r <id>]` | substrate (pin `grok-build`; `--prompt-file` no-ops; keep the kickoff prompt short) |

Kickoff prompt is constant (valor-v5 pattern): *"Read task.md in this directory
and execute the task it describes. Place produced files under output/ (or edit
the repo in place for code missions). Do not write status files — the conductor
records your result."* All task content lives in `task.md`, avoiding grok's
inline-prompt fragility and win32 argv limits.

## 4. Selection — who runs with a launcher

`agents/<id>/agent.md` gains an optional section:

```markdown
## Launcher
- **Launcher:** codex            # claude-code | codex | grok — omit for internal loop
- **Launcher Model:** gpt-5.2-codex   # optional; bare name passed to the CLI
- **Sandbox:** workspace         # workspace | workspace-net | full (see §6)
```

`AgentLoader` parses this into `OperativeConfig.launcher?: LauncherConfig`.
A mission `brief.md` may override with `- **Executor:** grok` for one-off
routing (mission-level wins over agent-level). No launcher configured →
today's behavior, unchanged.

## 5. Execution flow (the Act swap)

In `executeFolderMission`, when the resolved config has a launcher:

```
Observe   → unchanged (agent's own model, cheap)
Plan      → unchanged; the plan's actions become the task body
Act       → LAUNCHER:
            1. Provision workspace:
               - file missions: agents/workspaces/<agent>/<mission>/
               - code missions: git worktree of the TARGET repo at a
                 lead-resolved SHA, branch in the target repo
            2. Write task.md: brief objectives + success criteria + the plan
               + relevant working-memory extract + prior-iteration feedback
            3. launcher.launch(...) with per-tier timeout
            4. ActResult = { output: result.report, success: state==='completed',
                 toolCalls: [{ tool: 'launcher:<name>', ... }] }
Validate  → unchanged model call, but the prompt gains ground truth:
            launcher report + `git status --short` / `git diff --stat` of the
            workspace + output/ artifact listing
Reflect   → unchanged (writes reflections.md as today)
Evolve    → unchanged
```

Iteration works naturally: validation failure → next loop iteration appends the
validation feedback to `task.md` and re-launches with `resumeSessionId`, so the
CLI continues its session instead of starting cold. `sessionId` is persisted in
`progress.md` entries.

Budget: one launch consumes one act cycle (existing `autonomy.budget` applies).
Launcher-reported usage flows into the same token accounting as provider calls.

## 6. Safety model

Tiered sandbox, declared in `agent.md` and enforced by the launcher args:

| Tier | codex | claude-code | grok | Meaning |
|---|---|---|---|---|
| `workspace` (default) | `-s workspace-write` | `acceptEdits` + `--add-dir <ws>` only | `--permission-mode acceptEdits` | Write inside the workspace; no network beyond the CLI's own API |
| `workspace-net` | `--dangerously-bypass-approvals-and-sandbox` (worktree is the boundary) | same as workspace | same | Needed when the task must build/fetch deps (substrate's cargo lesson) |
| `full` | reserved | reserved | reserved | Requires Director approval event before launch — wired to the existing `requiresCheckpoint` config, which this finally enforces for Act |

Additional rules:
- Launcher grants live in `tools.md` like any capability (`- **Launcher: codex** — …`);
  deny-list wins. No grant → configuration error at load, not silent fallback.
- Workspace paths are jailed with the same `resolve`+`relative` check as
  `src/execution/tools.ts`; mission/agent ids validated by `src/store/ids.ts`.
- `task.md` content is treated as untrusted-adjacent: VALOR composes it; agent
  memory extracts are clipped, never raw-concatenated secrets/env.

## 7. What this is not

- **Not a replacement for the internal loop.** Agents without a launcher run
  exactly as today. Non-code missions (analysis, drafting) usually shouldn't
  use one.
- **Not the provider seam.** Same binaries, different contract. Providers do
  suppressed-tool inference; launchers do full agentic execution. Both may be
  registered simultaneously.
- **Not NATS/Path-A/Path-B work.** This lives entirely in the folder-mission
  path (`executeFolderMission`), consistent with the Deck-Spec direction.

## 8. Build phases

1. **Phase L1 — seam + claude-code:** `OperativeLauncher` interface, registry
   with auto-detect, `agent.md`/`brief.md` parsing, workspace provisioning
   (file-mission flavor only), Act swap, Validate ground-truth injection,
   mocked-spawn tests. Claude Code launcher first (richest headless contract).
2. **Phase L2 — codex + grok launchers:** port substrate flags, JSONL/JSON
   parsing (reuse `cli-common.ts`), session resume, usage capture.
3. **Phase L3 — code missions + gating:** target-repo worktree provisioning at
   a resolved SHA, branch-in-target-repo, `workspace-net` tier, Director
   approval event for `full`, dashboard surfacing of launcher runs.

## 9. Open questions (decide before L1)

1. **Default sandbox tier** — `workspace` is proposed; is `workspace-net` needed
   as default for practical builds (substrate found codex's workspace tier
   blocks cargo/npm network)?
2. **Target-repo registry** — where do code missions declare their repo?
   Proposed: `brief.md` gains `- **Target repo:** <path-or-url>` (the field the
   2026-07-06 template change already introduced).
3. **Evolve for launcher missions** — keep (VALOR reflects on delegation
   quality) or skip (the CLI did the work)? Proposed: keep.
