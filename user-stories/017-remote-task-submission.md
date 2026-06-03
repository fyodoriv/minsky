<!-- milestone: M1.8 -->

# 017 — Remote task submission

> File a to-do for Minsky from any machine: one command opens a draft pull request against the project's task list, with your private data scrubbed first.

## What this is

Minsky is a background program that does coding work for you while you are away. It reads a plain-text to-do list — a `TASKS.md` file at the root of a project — picks the most important unfinished item, and asks a coding assistant to do it. (`TASKS.md` is the Markdown list Minsky reads to pick work.)

This story covers how you put a new item on that list **without being in the project yourself**. You run one command, `bin/minsky submit-finding`. It turns your one-line note into a properly-shaped task and opens a draft pull request against `TASKS.md`. You review and approve the pull request. Nothing lands until you say so.

## Why it matters

Findings are easy to lose. You are working in one project, you spot a problem that belongs in another — a missing test, a stale doc, a regression you saw in production — and the right move is to file it where Minsky will pick it up. Without a one-command path, that finding dies in your head between sessions.

This command closes the loop. It turns "I noticed this" into "it is queued for Minsky", with three frictions removed: you do not switch to the Minsky project, you do not hand-write the full task block, and you do not coordinate with whoever owns the project.

## Story

As the operator — the human who runs Minsky — I am working on machine A and discover a problem class worth tracking: a missing test, a stale doc, a competitor finding, a regression seen in production. I want to add it to Minsky's to-do list right now.

I run one command:

```bash
bin/minsky submit-finding --message "X" --context Y
```

The command turns my one-line note plus machine context into a task block, scrubs my private data out of it, and opens a draft pull request against `TASKS.md`. I open that pull request, edit the auto-filled fields if needed, and approve it. The task is now queued for the next run.

Every run that produces a meta-finding feeds this command. For example: Minsky's self-check fires `daemon-task-id-staleness`, I recognize it as a recurring pattern, and I submit it as a finding to track.

## Acceptance criteria

The task block carries the five fields required by **pre-registered hypothesis-driven development (rule #9)** — the rule that every change must state its Hypothesis, Success threshold, Pivot threshold, Measurement command, and literature Anchor before code is written.

1. `bin/minsky submit-finding --message "X" --context Y` opens a pull request against `TASKS.md` that adds one task block with all rule #9 fields filled in (Hypothesis / Success / Pivot / Measurement / Anchor — derived from the message and context by heuristic; the operator edits them in the pull request).
2. The opened pull request carries a `submit-finding` label, so it is distinguishable from normal task additions that Minsky authored itself.
3. Private-data redaction: the submitter's home directory, git config name and email, and `$USER` are auto-scrubbed from the message before the pull request opens.
4. Idempotence: submitting the same `--message` twice within 24 hours is a no-op. The second call references the first pull request instead of opening a duplicate.
5. The submit operation never modifies a checked-out worktree on the submitter's machine. It goes straight through `gh pr create`.

## Metric

- **Name**: `remote-task-submission-substrate`
- **Definition**: probe whether `scripts/submit-finding.mjs` (or the equivalent dispatcher call inside `bin/minsky`) exists.
- **Threshold**: substrate present (binary 1 / 0).
- **Source**: the probe above. Today's probe is partial-substrate — the dispatcher and `bin/minsky` exist; the dedicated `submit-finding` subcommand is still to ship.
- **Rationale**: without the substrate, no operator can hand findings to Minsky's queue. The metric tracks whether the surface exists, not the per-week submission count. Submission count is an M2-stage metric — too sparse to gate M1 on.

## Integration test

- **File**: `user-stories/017-remote-task-submission.test.ts` (this pull request — ships the substrate-level invariant).
- **Setup**: read `bin/minsky` content from disk; no spawn.
- **Action**: assert that the future-ready dispatch surfaces exist. The current self-check already carries matching invariants for "stale task IDs" and "stuck PRs", which are the upstream sources of would-be submissions.
- **Assert**: substrate-level invariants — `bin/minsky` exists; `scripts/self-diagnose.mjs` has the source invariants; the `gh` CLI is on `PATH` (a downstream dependency).

## Proof

The integration test above is the proof: it reads `bin/minsky` and `scripts/self-diagnose.mjs` from disk and confirms the substrate surfaces are present, without spawning any process.

## Failure modes

- **Submitter's machine is offline**: `submit-finding` queues the finding locally and retries on the next supervisor cycle. (The supervisor is the outer watchdog that restarts Minsky if it dies and survives reboots.)
- **The project's `TASKS.md` linter rejects the task shape**: the submitter gets a per-rule error message and an interactive edit-and-retry path.
- **Two submissions collide on the same task ID**: the second submission's task ID is auto-suffixed with `-v2`.

## Out of scope

- Real-time aggregation across hundreds of machines (M4 fleet scale).
- Authentication and trust between submitter machines and the receiving Minsky (M3 federation).

## Pivot

If the substrate probe stays green but the actual submission rate is under 1 per month per machine for more than 2 months, the surface is not being adopted. Pivot to push-not-pull: have the self-check findings auto-open submission pull requests instead of waiting for the operator to run the command.
