# Operating notes — when stuck, operator vocabulary, Touches, and worktrees

This file exists to hold the operating guidance that `AGENTS.md` summarizes: what to do when stuck, how to read operator directives, the `**Touches**:` field, and the dedicated-worktree pattern for multi-PR batches.

## What to do when stuck

If you're an agent and you're stuck:

1. Re-read `vision.md` and check for a constitutional answer
2. Check `research.md` for a tool that solves your sub-problem
3. Check `competitors/` for how others handled it
4. Add `**Status**: blocked` to the task with a clear `**Reason**:` and move on to the next task
5. Add a new task to `TASKS.md` describing the blocker for the human or a different agent to address

Do not loop. Do not try the same approach repeatedly. Per the constitution, "let it crash" — escalate visibly and continue.

## Operator directive vocabulary (load-bearing translations)

Some operator phrases carry MORE intent than their literal reading suggests. Misreading them produces a passive agent when an active one was wanted. The 2026-05-27 session pinned this set:

- **"Monitor it" / "watch this for Nh"** — does **NOT** mean "sit passively and report at the end". It means: **actively continue the self-heal work in the background.** Snapshot state at intervals (recorder script under `.minsky/monitor-<date>/`), AND keep finding gaps, AND keep fixing them as PRs, AND keep updating skills/rules from observed lessons. A 9h "monitor" window should produce ≥3 PRs of incremental fixes, not zero. (Source: 2026-05-27 operator clarification after a 9h window produced only state observations — operator quote: *"when I said keep monitoring I meant also keep fixing gaps in background, update skills/rules and do that"*).
- **"Implement all those gaps"** — every gap surfaced in the findings doc gets a PR, not just the top one. Investigative gaps (e.g. "qwen3-coder engagement") still get an action: capture more diagnostic data, file a P0 task with concrete fix-paths, or ship a targeted intervention. Never "filed as P2 follow-up" without a PR that closes the discoverable surface.
- **"How is it?"** — quick honest status. Not "give me a full report". 3–5 sentences naming the green / yellow / red state per surface, with the most-load-bearing finding called out.
- **"Fix all those issues"** — same shape as "implement all those gaps": cascade of PRs, each catching a more specific failure class than the previous (see #897 → #898 → #899 → #900 → #901 → #902 chain on 2026-05-27).
- **"Easy & fast to detect"** — invariant + verdict + capture, in `scripts/self-diagnose.mjs` + `bin/minsky-run.sh` + `scripts/capture-failure.sh`. The pattern is now codified — every new failure class follows it.

The translation rule: if the literal reading of an operator phrase would have the agent stop short of shipping a PR, the active reading is correct. When in doubt, **ship the PR, update the rule, then summarize**.

## `**Touches**:` field on task blocks (parallel-launch coordination)

When the daemon runs in parallel mode (`pnpm minsky:setup --worker-id=N --workers-total=M`), each task block in `TASKS.md` may declare a `**Touches**: <glob>[, <glob>…]` field listing the file globs the task is expected to modify. The daemon's pre-spawn collision check (slice 3 of `daemon-parallel-worktree-launch`, see `novel/tick-loop/src/touches-glob.ts`) refuses to start a worker on a task whose globs overlap any open daemon PR's changed-file list — the second line of defense after `acquireTaskClaim` (slice 1).

Format:

```markdown
- **Touches**: `novel/tick-loop/**`, `scripts/foo.mjs`
```

Multiple comma-separated globs allowed; backticks optional but encouraged for markdown rendering. Supported glob syntax (per `globMatchesPath`): `*` matches any chars including `/`, `?` matches a single char, exact text matches literally — no brace expansion, no character classes. The matcher is intentionally minimal to avoid a `micromatch` / `minimatch` dependency.

Single-process daemon (no `--worker-id`) ignores the field entirely. **Strict by default** for P0/P1 task blocks (PR #924, det-touches-field-strict-mode): every P0/P1 task block MUST declare `**Touches**:` — either a comma-separated list of globs the task is expected to edit, OR `**Touches**: <none>` to explicitly opt out (cross-cutting work that doesn't fit a glob). The `check-touches-field` lint enforces this at pre-PR and CI time with a grandfathered allowlist of 92 pre-existing violators; new tasks must declare the field or fail the gate. The daemon-side collision-check substrate (`novel/tick-loop/src/touches-glob.ts`) was deleted in phase-11b — the field's value today is task-author discipline (declaring blast radius forces thinking about file-set disjointness) plus future-proofing for the M2 parallel-daemon work.

Declare `**Touches**:` on tasks the daemon is likely to pick. Broad meta-tasks (e.g. `security-privacy-priority-substrate`) that span many directories should be decomposed into narrower sub-tasks rather than declaring `novel/**` as a glob — the latter would over-collide.

## Pipeline-managed repos — dedicated worktree pattern

When you (the agent) are doing a multi-PR batch on this repo (e.g. a backlog drain, a CI stabilization sweep, a rule rollout), do NOT work in the main checkout. Other agents (the minsky supervisor launchd, parallel agent sessions, the daemon itself) `git checkout` the main repo dir at unpredictable times and wipe your uncommitted edits.

The discipline is:

```bash
git worktree add /tmp/minsky-<short-task-name> -b <branch> origin/main
cd /tmp/minsky-<short-task-name>
pnpm install --frozen-lockfile
# do all your work here
# when done: git worktree remove /tmp/minsky-<short-task-name> --force
```

The `/tmp/` path is unique per task and parallel agents have no business touching it. The branch lives on the same git object store as the main checkout but the working tree is yours alone. Operator's `bin/minsky` cleanup commands (e.g. `pnpm minsky:gc` once filed) leave `/tmp/` worktrees alone — they only clean `.worktrees/<id>` under the repo.

When the merge lands, remove the worktree:

```bash
git worktree remove /tmp/minsky-<short-task-name> --force
git branch -D <branch>  # if not already deleted by gh pr merge --delete-branch
```

See [`.claude/skills/pr-merge-no-shortcuts/SKILL.md` § Operational discipline](../../.claude/skills/pr-merge-no-shortcuts/SKILL.md) for the 8 tactical patterns observed during the 2026-05-21 PR drain — including the orphan-test trap, the diff-scoped vs whole-tree biome divergence, and the lefthook-bypass for bot commits.

## Size note on vision.md

**Size note**: `vision.md` is intentionally long (~717 lines, ~1.2 MB) — it's the constitution, not a quickstart. Agents loading it should treat it as system-prompt-level context, not a tutorial. The size anomaly (89 lines exceed 1000 chars each — single-paragraph constitutional clauses) is tracked as a P2 in `TASKS.md` for potential chunking; until then, agents read it whole and treat it as load-bearing.
