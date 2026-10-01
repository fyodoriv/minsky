---
name: spec-driven-development
description: Write a spec document before touching any code. Use when a task touches 3+ files, introduces a new adapter interface, spans multiple MAPE-K phases, or has ambiguous acceptance criteria. Outputs a `.minsky/specs/<task-id>.md` that the tick-loop can include in the worker's brief. Run before /task-slice and before /grill-task.
allowed-tools: Read, Bash, Write
---

# Spec-driven development

"Code without a spec is guessing." — *addyosmani/agent-skills*, spec-driven-development

Produce a `.minsky/specs/<task-id>.md` spec document before any implementation begins. The spec is the source of truth the tick-loop worker brief, task-slice decomposition, and PR description all reference. It is committed alongside the code it governs.

## Args

Takes one required argument: the task ID from TASKS.md.

`/spec-driven-development minsky-cli-auto-bootstrap-local-llm`

## When to use

**Always spec first when:**
- Task touches 5+ files or introduces a new adapter interface in `novel/adapters/`
- Task spans multiple MAPE-K phases (Analyse + Plan + Execute)
- Requirements in the TASKS.md block are ambiguous or the acceptance criteria are vague
- The change introduces a new rule enforcement mechanism (a new `scripts/check-*.mjs` or CI job)
- Work exceeds an estimated 30 minutes

**Skip the spec for:**
- Single-file typo or formatting fixes
- XS/S tasks with a single obvious code path (judgment: if you'd answer yes to all of /grill-task's questions from memory, spec is overkill)
- Doc-only changes

## Phase 1 — Read before writing

1. Read the full task block from `TASKS.md`.
2. Read the files listed in `**Touches**` and `**Files**`.
3. Read the relevant `user-stories/*.md`.
4. Read the adapter interface the task is modifying (if any) in `novel/adapters/`.
5. Check `experiments/` for an existing pre-registration — if one exists, the spec must honour its hypothesis, success threshold, and measurement command.

Do not write any code. The output of this phase is an understanding, not a file.

## Phase 2 — Write the spec

Write `.minsky/specs/<task-id>.md` with these six sections:

### 1. Objective

One paragraph. What observable behaviour changes and why. Quote the task's hypothesis from TASKS.md verbatim. State the success threshold.

### 2. Commands

The exact runnable commands that prove the spec is satisfied:

```bash
# Build
pnpm install && pnpm typecheck

# Test (the measurement command from experiments/<task-id>.yaml or TASKS.md)
pnpm vitest run <path>

# Lint gates this change must pass
node scripts/check-<rule>.mjs
pnpm exec biome check .
```

No English descriptions — executable commands only.

### 3. Architecture boundaries

Which adapter interface(s) (`novel/adapters/<name>.ts`) this task touches, and which side of each boundary the task is on. If the task introduces a new interface, sketch the TypeScript signature here (not a full implementation).

Diagram the MAPE-K phase(s) involved:

```
Monitor → Analyse → Plan → Execute
             ↑ this task lives here
```

### 4. Domain vocabulary

List every vision.md Glossary term used in the implementation (tick-loop, brief, span, claim, circuit-breaker, chaos-gate, MAPE-K, budget-guard, MTTR, opencode, aider). If a new term is introduced, propose a Glossary entry here.

### 5. Boundaries

**Always do:**
- One vertical slice at a time (see task-slice)
- Regression test at the architectural seam before fixing

**Ask the operator first:**
- Any change to a `novel/adapters/` interface (adapter changes affect all implementations)
- Any new CI job or rule enforcement script
- Any change to `TASKS.md` schema or the `experiments/*.yaml` schema

**Forbidden:**
- Touching files not listed in `**Touches**`
- Committing without a passing measurement command
- Marking a task Done without the rule #9 self-grade block in the PR

### 6. Open questions

List unresolved decisions as "Q: [question] → Recommended: [answer]". These feed directly into /grill-task. If none, write "None — ready to slice."

## Output path

```
.minsky/specs/<task-id>.md
```

Read the file before writing (create if absent). Overwrite on each invocation.

## After writing

1. Print the spec path.
2. Print the "Commands" section so the operator can see the measurement command.
3. Recommend the next skill: `/grill-task <task-id>` if open questions exist, otherwise `/task-slice <task-id>`.

## Spec as living document

Update the spec when decisions change. Commit the updated spec in the same PR as the code that reflects the decision. Never let the spec drift from the implementation — the tick-loop brief will include the spec, and a stale spec produces hallucinated context in the next worker.

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Writing the spec after the code | The spec becomes documentation, not a constraint. Open questions are answered by "whatever the code does." |
| Vague objective ("improve X") | Rule #9 requires a numeric movement. "Improve latency" is not a spec; "reduce p99 tick-loop latency from 4.2 s to ≤ 3.0 s" is. |
| Skipping the Commands section | A spec without a runnable measurement command is a wish, not an experiment. |
| Over-specifying implementation details | The spec defines the interface and the measurement. The implementation is the worker's job. |
