---
name: brief-engineering
description: Curate the context block (brief) that the tick-loop will pass to the next worker for a given task. Use when building a worker brief manually, auditing a stale brief, or diagnosing worker quality regressions caused by over-full or under-specified context. Maps to the MAPE-K Analyse phase — the brief is the primary context-engineering surface in Minsky.
allowed-tools: Read, Bash
---

# Brief engineering

The brief is "the single biggest lever for worker output quality" — too little causes hallucination, too much causes loss of focus. The tick-loop builds briefs automatically, but their quality determines whether the worker iteration makes progress or spins.

Adapted from *addyosmani/agent-skills*, context-engineering.

## When to use

- A worker returned low-quality output and you suspect the brief was under-specified or over-full
- You are manually building a worker brief for a complex task outside the normal tick-loop
- The brief includes stale content from a previous iteration (the worker references superseded decisions)
- A task's `.minsky/worker-handoff-<task-id>.md` exists and should be folded into the brief
- You are reviewing why a worker's `ANALYSE` step misidentified the problem

## The five-level brief hierarchy

Structure brief content from most to least persistent. Earlier levels survive context compaction; later levels don't:

```
Level 1 — Always present (project-wide)
  vision.md § Glossary             (domain vocabulary)
  ARCHITECTURE.md § Pattern index  (adapter pattern, MAPE-K wiring)
  relevant user-stories/*.md       (acceptance criteria)

Level 2 — Per-task (session-scoped)
  TASKS.md task block              (hypothesis, success threshold, touches)
  experiments/<task-id>.yaml       (measurement command, success threshold)
  .minsky/specs/<task-id>.md       (spec, if it exists)

Level 3 — Per-iteration (source files)
  Files listed in task **Touches** (read-only — context, not instructions)
  novel/adapters/<relevant>.ts     (interface contracts)

Level 4 — Prior iteration feedback
  .minsky/worker-handoff-<task-id>.md  (session summary from last worker)
  Last 3 commits on the branch         (git log --oneline -3)

Level 5 — Accumulated (prune aggressively)
  Conversation history             (compact when >5 turns; keep only findings)
```

**Ceiling: ~2,000 lines of source content maximum.** Above this, focus degrades faster than information density improves.

## Brief audit — read-only analysis

Before modifying a brief, audit what the tick-loop is currently including:

```bash
# Check what the tick-loop will include for a claimed task
grep -A 40 "## Task:" .minsky/tick-loop.out.log | tail -80

# Check the handoff doc
cat .minsky/worker-handoff-<task-id>.md 2>/dev/null

# Check the spec
cat .minsky/specs/<task-id>.md 2>/dev/null

# Check the experiment
cat experiments/<task-id>.yaml 2>/dev/null
```

## The brain dump — when to include everything at once

For a new task with no prior iteration, use a structured brain dump at the start of the worker session. Format:

```
## Worker context for <task-id>

**Stack**: TypeScript 5.4, Node 20, vitest, biome, pnpm
**MAPE-K phase**: [Monitor | Analyse | Plan | Execute]
**Task hypothesis**: [from TASKS.md]
**Success threshold**: [numeric, from experiments yaml or TASKS.md]
**Measurement command**: [exact bash command]

**Relevant files** (read these first):
- novel/adapters/<name>.ts — the interface contract
- <file2>                  — reason for inclusion

**Constraints** (non-negotiable):
- Rule #3: write regression test before fix
- Rule #9: measurement command must pass before marking Done
- Rule #12: do not touch files outside **Touches**

**Prior iteration findings** (from handoff doc):
- [bullet 1]
- [bullet 2]

**Known traps**:
- [trap 1 — e.g., "BudgetGuard.decide() reads from an LRU cache; direct field access returns stale state"]
```

## The selective include — what NOT to put in the brief

Remove from the brief if present:
- Files not in the task's `**Touches**` list
- Full file contents when only a function signature is needed — include the type signature and the file path
- Vision.md sections unrelated to the task's rule domain
- Test files (include the test path, not the content, unless debugging a test failure)
- Prior iteration handoff docs older than 2 iterations (they've been superseded)
- Entire `TASKS.md` (include only the task block, not the full file)

## Context starvation vs context flooding

| Symptom | Likely cause | Fix |
|---|---|---|
| Worker invents non-existent adapter methods | Missing `novel/adapters/<name>.ts` in brief | Add Level 3 content |
| Worker ignores the success threshold | Missing `experiments/<id>.yaml` or TASKS.md task block | Add Level 2 content |
| Worker refactors code outside the **Touches** list | Brief omits the **Constraints** block | Add explicit boundary statement |
| Worker repeats work from the prior iteration | Missing Level 4 handoff doc | Run `/worktree-handoff` before eviction |
| Worker output is unfocused / does too many things | Brief exceeds ~2,000 lines | Prune Level 3 to just the touched files' function signatures |
| Worker uses wrong terminology | Missing Level 1 Glossary snippet | Add the relevant Glossary entries |

## Brief update after architectural decisions

When a `/doubt-driven-development` session produces an ACTIONABLE finding that changes an adapter contract:

1. Update `.minsky/specs/<task-id>.md` (Level 2) immediately.
2. Append the DOUBT-RECONCILE block to the spec's "Open questions" section.
3. Do NOT carry the full doubt-session transcript into the brief — only the resolved outcome.

## When to compact

When the conversation history exceeds ~20 turns without a commit:

1. Write the session summary to `.minsky/worker-handoff-<task-id>.md` via `/worktree-handoff`.
2. Start a new worker session with only the handoff doc as Level 4 context.
3. The old conversation history is not included — the handoff doc is the only bridge.

**Never rely on conversation history to carry findings across daemon restarts.** The tick-loop restarts workers in fresh context. Only the handoff doc and the git log survive.

## Confusion management rule

When the brief contains contradictory information (e.g., the spec says "use adapter X" but the handoff says "adapter X is broken"):

Do not let the worker silently pick one. Add an explicit conflict note to the brief:

```
CONFLICT: spec says use AdapterX, but handoff-<id>.md reports it fails.
Worker must resolve this before implementing: read novel/adapters/X.ts
and run pnpm vitest run novel/adapters/X.test.ts to confirm current state.
```

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Including all of `TASKS.md` in the brief | The full file is ~800 lines. Only the task block is needed — ~30 lines. |
| Including test files as context | Tests are executable, not context. Include the path, not the content. |
| Using the brief to give step-by-step instructions | The brief is context, not a procedure. Instructions belong in the skill description or TASKS.md acceptance criteria. |
| Stale handoff doc from 5 iterations ago | Superseded findings pollute the current brief with wrong state. Keep only the latest handoff. |
| No brief at all (cold-start worker) | A cold-start worker on a complex task will hallucinate adapter signatures and violate scope discipline on the first iteration. |
