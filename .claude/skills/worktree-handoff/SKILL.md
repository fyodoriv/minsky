---
name: worktree-handoff
description: Compact the current worktree session into a handoff document that the tick-loop can include in the next worker's brief. Use when a task iteration is ending, a worker is about to be evicted, or the session context needs to survive a daemon restart. Saves to .minsky/worker-handoff-<task-id>.md at a predictable path the tick-loop reads.
allowed-tools: Bash, Read, Write
---

# Worktree handoff

Pack the current session's discoveries into a persistent handoff document. The tick-loop reads `.minsky/worker-handoff-<task-id>.md` when building the next iteration's brief, so the next worker starts warm rather than cold.

## Args

Takes one optional argument: the task ID (e.g., `/worktree-handoff minsky-cli-arch-detection`).

If no argument is provided, read the claimed task ID from `TASKS.md` (`(@<agent-id>)` marker) or the current git branch name.

## Output path

Always write to:

```
.minsky/worker-handoff-<task-id>.md
```

Read the file before writing (create if absent). Overwrite on each invocation — this is not an append log.

## Required sections

### 1. Task context (one paragraph)

Restate the task ID, hypothesis, and success threshold from TASKS.md. Do NOT copy the full task block — cite it by task ID only.

### 2. Session summary (3-5 bullets)

What was attempted. What worked. What failed. One sentence each.

### 3. Current state

- Branch: `git rev-parse --abbrev-ref HEAD`
- Last commit: `git log --oneline -3`
- Open changes: `git status --short`
- Hot files (edited this session): list with the reason each was touched

### 4. Regression tests

List every regression test written this session (path + description). Note pass/fail state. If tests were written but not yet passing, say so explicitly.

### 5. Next step

One concrete next action with the exact command or skill invocation. If blocked, state the blocker and the exact condition needed to unblock.

### 6. Recommended skills

List 1-3 skills the next worker should invoke, in order.

## Anti-patterns

- Do NOT duplicate content already in TASKS.md, commits, or open PRs — reference by ID/URL
- Do NOT summarize code that can be read directly — link the file path
- Do NOT include speculative context ("I was thinking maybe...") — only confirmed findings

## After writing

Print the output path and the "Next step" line so the operator can see what the daemon will hand to the next worker.
