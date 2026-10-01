---
name: task-slice
description: Decompose a large TASKS.md task into vertically-sliced sub-tasks before any implementation begins. Use when a task touches 5+ files, estimates ≥1d, or has multiple distinct behaviors. Outputs an ordered sub-task list with dependency graph, sizing labels, and [P] markers for parallelizable slices. Must be run before coding begins on any L or XL task.
allowed-tools: Read, Bash
---

# Task-slice

Decompose an L/XL task into independently testable vertical slices before any worker writes code. The output replaces the monolithic task entry with sub-tasks that each satisfy rule #3 (test-first) and rule #9 (pre-registered hypothesis) independently.

## Args

Takes one required argument: the task ID from TASKS.md.

`/task-slice minsky-cli-auto-bootstrap-local-llm`

## Phase 1 — Read-only analysis (no code changes)

1. Read the task block from `TASKS.md` fully.
2. Read all files listed in the task's `**Touches**` field.
3. Read the relevant `user-stories/*.md` file.
4. Note the acceptance criteria and success threshold.

Do not write any code. The output of this phase is a plan document.

## Phase 2 — Dependency graph

List every artifact the task will create or modify. Draw the dependency edges: what must exist before what can be built. Format as:

```
A (pure logic) → B (I/O wrapper) → C (CLI integration) → D (test coverage)
```

## Phase 3 — Slice the work

Apply vertical slicing: each slice delivers end-to-end functionality for one behavior, not all-of-one-layer.

**Anti-pattern (horizontal):**
- Slice 1: all TypeScript types
- Slice 2: all pure logic
- Slice 3: all I/O
- Slice 4: all tests

**Correct (vertical):**
- Slice 1: detect + report one failure mode end-to-end (types + logic + I/O + test)
- Slice 2: detect + report second failure mode
- Slice 3: install step for first missing component

Each slice:
- Leaves the codebase in a buildable, testable state
- Has 1-3 acceptance criteria (testable, not vague)
- Has a size label: XS (1 file) / S (1-2 files) / M (3-5 files) / L (5-8 files)
- Has an explicit dependency on prior slices (or none — mark `[P]`)
- Has a verification command (`pnpm vitest run <path>` or equivalent)

**Hard rule**: No slice may be labeled L or larger. If a natural slice is L, cut it again.

## Phase 4 — Output format

Produce the sub-task list as a Markdown table:

| Slice | Description | Size | Dep | [P]? | Verification |
|---|---|---|---|---|---|
| S1 | detect pipx absent → report | XS | none | [P] | `pnpm vitest run local-llm-bootstrap` |
| S2 | detect mlx-lm absent → report | XS | none | [P] | same |
| S3 | install-pipx step | S | S1 | | `pnpm vitest run local-llm-bootstrap -t install` |
| ... | | | | | |

## Phase 5 — Checkpoint every 3 slices

After every 3 slices: verify the codebase builds, all prior tests pass, and the running system behaves as the slice claimed.

## When NOT to use

- Task is already XS/S (1-2 files, single behavior) — just implement it
- Task is a doc-only change — no slicing needed
- Slicing would produce more overhead than the implementation itself (judgment call; if in doubt, slice)
