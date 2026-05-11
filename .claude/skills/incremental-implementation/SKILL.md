---
name: incremental-implementation
description: Implement a task slice-by-slice, verifying the build and tests after each slice before moving to the next. Use during implementation of any task with 2+ slices (from /task-slice). Enforces the checkpoint-every-3-slices rule and the "codebase must build after every increment" invariant. Complements task-slice (which plans) — this skill executes the plan.
allowed-tools: Bash, Read, Edit
---

# Incremental implementation

Each slice from `/task-slice` is one vertical increment. Every increment leaves the codebase in a buildable, testable state. Never accumulate more than one slice of unverified changes.

## Core rule

> "After each increment, the project must build and existing tests must pass."

Breaking this rule means the next slice's bugs compound with the current one's. Two slices of compounded failure takes 3x longer to debug than one.

## The cycle for each slice

```
1. Read the slice definition (size, acceptance criteria, verification command)
2. Write the regression test FIRST — it must FAIL before the implementation
3. Implement the minimal code that makes the test pass
4. Run: pnpm typecheck && pnpm vitest run <path>
5. If green: commit ("feat(<scope>): <slice-description>")
6. If red: debug within this slice — do not start the next slice
```

Step 2 is non-negotiable. Rule #3 (test-first) applies to every slice.

## Checkpoint after every 3 slices

After completing slices 3, 6, 9, ...:

```bash
# Full build check
pnpm install && pnpm typecheck

# Full test suite (not just the slice's test)
pnpm vitest run

# Biome lint
pnpm exec biome check .

# Rule-enforcement scripts for any rules the task touches
node scripts/check-<relevant-rule>.mjs
```

If any checkpoint fails, stop. Do not proceed to the next slice. Fix the regression in the slice that introduced it (use `git bisect` if unclear which slice broke the invariant).

## Scope discipline during implementation

Do not clean up adjacent code, add unspecified features, or modify files not listed in the slice's touch list. If you notice a problem outside the slice's scope:

1. Note it in the worktree-handoff doc or a comment.
2. Do not fix it.
3. File a TASKS.md entry if it's non-trivial.

This is Karpathy's surgical-change discipline applied at the slice level.

## Simplest thing that could work

Before writing any implementation code, ask: "What is the simplest thing that could satisfy the slice's acceptance criteria?" Reject the first idea that involves abstraction or generalisation unless the acceptance criteria explicitly require it.

## Commit message format

```
feat(<scope>): <one-line slice description>

Slice S<N> of <task-id>. Acceptance criteria:
- <criterion 1>
- <criterion 2>

Verification: pnpm vitest run <path>
```

For XS slices a one-liner subject with no body is acceptable.

## Slicing approaches when the plan is incomplete

If `/task-slice` hasn't been run yet, use the risk-first ordering: tackle the most uncertain slice first. Fail fast on the hard part; don't spend three slices on scaffolding only to discover the hard part is infeasible.

For Minsky-specific work, the standard vertical order is:
1. Pure logic (no I/O, no adapter calls) + unit test
2. Adapter integration (I/O, subprocess, HTTP) + integration test
3. CLI / daemon wiring + smoke test
4. CI gate / rule script + the `scripts/check-*.mjs` test

## When to stop and escalate

Stop the increment loop and escalate to the operator if:
- A slice is estimated M or larger after starting (the task-slice estimate was wrong — reslice)
- The checkpoint after slice 3 reveals a regression in code not touched by any slice (external breakage — open a diagnose session)
- The measurement command from `experiments/<task-id>.yaml` cannot run (the metric infrastructure is missing — file a preparation PR first)

## Anti-patterns

| Pattern | Counter |
|---|---|
| Writing 200+ lines without running a test | Hard ceiling: if `git diff --stat HEAD` shows >150 lines changed since the last green test run, stop and test now. |
| "I'll fix tests in the last slice" | Tests are written before implementation in every slice. This is the rule, not a guideline. |
| Mixing unrelated changes in one slice | Each commit should be reviewable in isolation. Unrelated changes contaminate the git bisect surface and the PR review. |
| Skipping the checkpoint | The checkpoint is the only guarantee that accumulated slices are still coherent. |
| Marking a task Done with a red test | A task is Done only when: all slice tests pass, the measurement command produces a value that meets the success threshold, and the PR passes CI. |

## Red flags

- Build breaks between slices
- Test count decreasing between slices (deleted tests)
- `pnpm typecheck` errors accumulating
- The verification command from task-slice failing while individual unit tests pass
