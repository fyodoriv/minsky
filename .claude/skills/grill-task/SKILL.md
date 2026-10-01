---
name: grill-task
description: Clarify ambiguities in a TASKS.md task before implementation begins. Asks one question at a time with a recommended answer, explores the codebase before asking the operator, and outputs a resolved-assumptions list. Use when a task description has unstated constraints, interface ambiguities, or multiple plausible approaches. Run before /task-slice or before claiming a task.
allowed-tools: Read, Bash
---

# Grill-task

Surface hidden assumptions in a TASKS.md task before any code is written. One question at a time. Recommended answer included. Codebase explored before asking the operator.

## Args

Takes one required argument: the task ID.

`/grill-task minsky-cli-auto-bootstrap-local-llm`

## Protocol

1. Read the full task block from `TASKS.md`.
2. Read the files listed in `**Touches**` and `**Files**`.
3. Read the relevant `user-stories/*.md` and any cited adapter interfaces.
4. Build a decision tree: for each branch point in the implementation, identify whether (a) the codebase already answers it, (b) the task block answers it, or (c) it is genuinely unresolved.

For each unresolved branch, ask **one question at a time** in this format:

---
**Q**: [Precise question about the branch]

**Recommended answer**: [What you would do based on existing patterns and rules]

**Reasoning**: [One sentence — why this answer fits rule #N or an existing interface]

**Codebase evidence**: [File path + line, or "no precedent found"]

---

Wait for the operator's response before asking the next question.

## Resolution output

After all questions are resolved (or the operator says "proceed with recommendations"), produce:

```
## Resolved assumptions for <task-id>

1. [Question] → [Answer] [source: operator-confirmed / inferred-from-codebase / rule-#N]
2. ...

## [NEEDS CLARIFICATION] items (cannot proceed without these)

- [Item]: [why it blocks implementation]
```

Append the "Resolved assumptions" block to the task entry in `TASKS.md` under a `**Assumptions**:` field.

## Rules

- Never ask about something `grep` or `Read` can answer. Explore the codebase first.
- Never ask more than one question per turn.
- Stop after 8 questions maximum. If resolution requires more, the task is underspecified — recommend a preparation PR that defines the interface first.
- For `[NEEDS CLARIFICATION]` items, the operator must resolve them before the task is claimed. File them as inline notes; do not block on them indefinitely.

## When NOT to use

- Task block already has a `**Assumptions**:` field with all branches covered
- Task is XS/S with a single obvious implementation path
- The operator has explicitly said "just implement it, use your judgment"
