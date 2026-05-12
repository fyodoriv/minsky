---
name: karpathy-disciplines
description: Prime a worker session with the four Karpathy engineering disciplines before the task brief is read. Invoke at the START of every worktree session to calibrate working memory before reading TASKS.md. The four disciplines are (1) Think Before Coding, (2) Simplicity First, (3) Surgical Changes, (4) Goal-Driven Execution — adapted for Minsky workers that ship PRs autonomously against a task block.
allowed-tools: Read, Bash
---

# Karpathy disciplines — Minsky worker primer

Read this before reading the task block. These disciplines govern HOW you work, not WHAT you work on. The task block governs the what.

Source: Karpathy (2024) — "LLMs as junior devs: the failure modes I've seen most."

## Why this skill exists

Workers (opencode/aider sub-agents) exhibit four failure modes in practice, ranked by Minsky dogfood data:

1. **Silent assumption** — picks an interpretation and codes against it; first the operator finds out when the PR diff shows unintended scope.
2. **Scope creep** — ships a working slice plus "while I was in there" cleanups that widen the diff and add merge-conflict surface.
3. **Vague completion criterion** — considers the task done when the code "looks right" rather than when a verifiable signal passes.
4. **Over-engineering** — adds abstraction layers for hypothetical future use cases that the task block never asked for.

Disciplines 1–4 below are the countermeasures, one-to-one.

---

## Discipline 1 — Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs. Read the task block before touching a file.**

### In the Minsky worktree

Before writing a single line:

1. Read the full task block from `TASKS.md` (your task ID is in the brief).
2. Read every path listed in `**Files**:` and `**Touches**:`.
3. Read the `**Hypothesis**:` and `**Acceptance**:` fields. If you cannot restate them in your own words without re-reading, you don't understand the task yet.
4. If the `**Progress**:` / `## Current slice` field is present, that is the ONLY scope for this iteration. Everything else in the task block is archaeology.

### Checklist before first edit

- [ ] I can state the `**Hypothesis**:` in one sentence without re-reading it.
- [ ] I know which files I will touch and why each one is necessary.
- [ ] I have no unresolved interpretation forks (if I do, run `/grill-task <id>` or state the assumption explicitly in the PR body).
- [ ] The `## Current slice` directive narrows my scope to N≤3 files; if I think I need more, I'm probably wrong.

### When confused

Stop before touching code. Name the confusion precisely. Check whether `vision.md`, `ARCHITECTURE.md`, or `research.md` resolves it. If not, invoke `/grill-task <id>` or add a `**Pushback**:` block to the task.

---

## Discipline 2 — Simplicity First

**Minimum code that satisfies the acceptance criterion. Nothing speculative.**

### In the Minsky worktree

- No features beyond what `**Acceptance**:` explicitly requires.
- No new abstractions for code that is used in exactly one place.
- No "flexibility" or "configurability" that the task block doesn't mention.
- No dead-code removal beyond what your change creates (that's Discipline 3's domain).
- If a function is 200 lines and could be 50, rewrite it — but only if that function is what you're changing.

### The senior-engineer test

Before opening a PR, read your diff cold. Ask: "Would the senior engineer who wrote `novel/tick-loop/src/daemon.ts` say this is overcomplicated?" If yes, simplify. The brief's `**Details**:` field often constrains the implementation shape — when it does, match it.

### Minsky-specific traps

- Adding an `options?: {}` parameter "for future use" — the adapter interface rule (#2) doesn't require it; don't.
- Importing a new npm package to replace 3 lines of logic — rule #1 (don't reinvent the wheel) applies both ways.
- Generalising an existing function because it's "almost the same" — write a second function; generalise when the third use case appears.

---

## Discipline 3 — Surgical Changes

**Touch only what the `## Current slice` directive requires. Clean up only your own mess.**

This rule is already in `AGENTS.md` (rule #3) and the global CLAUDE.md. It is repeated here because it is the most commonly violated discipline in autonomous worker iterations.

### In the Minsky worktree

When editing existing code:
- Don't improve adjacent code, comments, or formatting unless the current slice explicitly names it.
- Don't refactor things that aren't broken — even obviously.
- Match existing style (`biome check` passes; style beyond that is not your concern this iteration).
- If you notice unrelated dead code, file it as a task or add a `**Pushback**:` note — don't fix it.

When your changes create orphans:
- Remove imports, variables, and functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless the current slice says to.

### The line-trace test

Every changed line in your diff must trace directly to: (a) the `## Current slice` directive, or (b) cleaning up an orphan your changes created. If a line can't be traced, revert it.

### Why this matters here

Minsky uses `**Touches**:` globs for collision detection. A worker that touches files outside its declared `**Touches**:` scope invalidates the collision check and can corrupt another parallel worker's worktree state.

---

## Discipline 4 — Goal-Driven Execution

**Transform the `## Current slice` directive into a concrete, verifiable success criterion before writing any code. Then loop until the criterion passes.**

This is the hardest discipline for autonomous workers because the brief gives an imperative ("ship X") rather than a declarative ("X is done when test Y passes"). Workers that skip this step drift — they produce plausible-looking output that doesn't satisfy the acceptance criterion.

### Transformation protocol (mandatory before first edit)

Given a `## Current slice` directive, produce this block in your working memory (not necessarily written down, but explicitly reasoned):

```
Slice directive:   <copy the ## Current slice text verbatim>
Success signal:    <the exact runnable command that proves this slice is done>
                   Must be: pnpm vitest run <path>, pnpm pre-pr-lint, or equivalent.
                   NOT: "it compiles" or "it looks right".
Pivot signal:      <the exact condition under which the approach changes>
                   Example: "if pnpm vitest run <path> still fails after 3 different approaches"
Scope boundary:    <the files I will touch and ONLY those files>
```

### Concrete transformation examples

| Slice directive | Transforms to |
|---|---|
| "Add `checkTickLoopBinExists` helper" | `pnpm vitest run tick-loop-bin-existence-check` passes for present/absent/ENOENT cases |
| "Wire `buildLocalBrief` for provider=local" | `pnpm vitest run daemon.test --grep "buildLocalBrief"` passes; brief ≤2 KB snapshot test passes |
| "Detect CONFLICTING daemon PRs in self-diagnose" | `node scripts/self-diagnose.mjs` exits 0; `grep -c CONFLICTING` in fixture returns expected count |
| "Fix EACCES crash in log-path" | `pnpm vitest run log-path-fallback` passes for EACCES/EROFS/ENOSPC cases; `grep -c "Error: EACCES" actual-run.log` returns 0 |

Notice the pattern: the verification command always inspects real output, never just compiles or runs without assertion.

### Relation to rule #9

Discipline 4 is the per-slice operationalisation of rule #9's pre-registered HDD. Rule #9 governs the PR-level hypothesis; Discipline 4 governs the iteration-level success criterion. They compose:

- **Rule #9** (PR level): "This PR ships hypothesis X; measurement is Y; success threshold is Z."
- **Discipline 4** (slice level): "This slice is done when `pnpm vitest run <path>` passes for these N test cases."

A worker that satisfies Discipline 4 per slice automatically satisfies rule #9 at the PR level, because every slice has a passing test before the PR is opened.

### Loop until verified

Karpathy's insight: "LLMs are exceptionally good at looping until they meet specific goals. Give them success criteria and watch them go."

For Minsky workers this means: run the verification command. If it fails, fix and re-run. If it still fails after 3 attempts with different approaches, that IS the pivot signal — file a `**Pushback**:` block or output `noop, exiting — pivot: <reason>`.

Never open a PR whose verification command fails. The pre-PR lint gate (`pnpm pre-pr-lint`) is the final check; it is not a substitute for having passed the slice's own verification command first.

---

## Sequence at session start

Invoke this skill first. Then follow this sequence:

1. `/karpathy-disciplines` — you are reading this now; prime working memory.
2. Read the brief (the daemon already injected it; it contains the task ID and `## Current slice`).
3. Apply Discipline 1: read all `**Files**:` and `**Touches**:` paths; check the checklist.
4. Apply Discipline 4: transform the slice directive into a concrete success criterion before touching code.
5. Implement: touch only declared files; write the test first (rule #3 in `AGENTS.md`).
6. Verify: run the success criterion command. Loop until it passes.
7. Run `pnpm pre-pr-lint`; fix any failures (max 3 attempts).
8. Open PR with `## Hypothesis self-grade` block per the template in the brief.
9. Run `/worktree-handoff <task-id>` to pack the session for the next worker.

---

## Anti-patterns (observed in Minsky dogfood runs)

| Anti-pattern | Discipline violated | Countermeasure |
|---|---|---|
| Worker picks task, reads brief, immediately opens files and starts editing | 1 (Think Before Coding) | Read the full task block; complete the Discipline 1 checklist first |
| PR diff includes `vision.md` updates the task didn't request | 3 (Surgical Changes) | `vision.md` is modified only by the MAPE-K loop's spec-monitor; never in a worker PR |
| Worker considers task done because "tests pass" without running the slice's own verification | 4 (Goal-Driven Execution) | Explicit verification command must be stated and run before `gh pr create` |
| New `novel/adapters/<name>.ts` file added speculatively "for future tasks" | 2 (Simplicity First) | Write adapters only for dependencies the current slice actually uses |
| Worker touches 8 files when `**Touches**:` declares 3 | 3 (Surgical Changes) | Scope boundary is declared; every file outside it requires an explicit justification in the PR body |
| PR opened with `noop` diff to "document progress" | 1 + 4 | If no code change, output `noop, exiting — <reason>` to stdout; never open a PR for a TASKS.md-only append |

---

## Sources

- Karpathy, A. (2024). Tweet thread on LLM coding failure modes. https://x.com/karpathy/status/2015883857489522876
- AGENTS.md rule #3 (test-first, metric-first) and rule #9 (pre-registered HDD) — this skill operationalises both at the per-slice level.
- Basili, Caldiera, Rombach, "The Goal-Question-Metric Approach", *Encyclopedia of Software Engineering*, 1994 — the GQM structure behind Discipline 4's transformation protocol.
- Ries, *The Lean Startup*, 2011 — pivot-or-persevere framing behind the "3 attempts then pivot" rule in Discipline 4.
