<!-- milestone: M1.8 -->

# 017 — Remote task submission

> Findings from any machine can be submitted as tasks to Minsky itself, with user approval + anonymized data preview.

## Who, what, when, why

**Who**: the operator running Minsky on machine A discovers a problem class — a missing test, a stale doc, a worth-investigating competitor finding, a regression observed in production — and wants to ENQUEUE it into Minsky's task pipeline without:

- driving to the Minsky repo themselves
- writing the full rule-#9 TASKS.md block by hand
- coordinating with whoever owns the repo

**What**: `bin/minsky submit-finding` (or equivalent) takes a one-line finding + machine context + (optional) anonymized snippet, opens a PR against `TASKS.md` with the right shape, and the operator approves the PR.

**When**: every iteration that produces a meta-finding (e.g. `daemon-task-id-staleness` fires → "this is a pattern; let's track it" → submit-finding).

**Why**: closes the discovery loop. Without this, findings die in the operator's head between sessions. M1.8 is the structural surface that turns observed-but-unfiled into queued-for-the-daemon.

## Acceptance criteria

1. `bin/minsky submit-finding --message "X" --context Y` opens a PR against TASKS.md adding a new task block with all rule-#9 fields populated (Hypothesis / Success / Pivot / Measurement / Anchor — derived from the message + context heuristically; operator edits in the PR).
2. The opened PR carries a `submit-finding` label so it's distinguishable from normal daemon-authored task additions.
3. PII redaction: the submitter's homedir, git config name/email, and `$USER` are auto-scrubbed from the message before the PR.
4. Idempotence: submitting the same `--message` twice within 24h is a no-op (the second invocation references the first PR rather than opening a duplicate).
5. The submit operation never modifies a checked-out worktree on the submitter's machine — it goes straight through `gh pr create`.

## Metric

- **Name**: `remote-task-submission-substrate`
- **Threshold**: substrate present (binary 1 / 0).
- **Source**: probe whether `scripts/submit-finding.mjs` (or the equivalent dispatcher call inside `bin/minsky`) exists. Today's probe is partial-substrate (the dispatcher and `bin/minsky` exist; the dedicated `submit-finding` subcommand is still to ship).
- **Rationale**: Without the substrate, no operator can hand findings to the daemon's queue. The metric tracks the existence of the surface, not the per-week submission count (that's M2-stage metric — too sparse to gate M1 on it).

## Integration test

- **File**: `user-stories/017-remote-task-submission.test.ts` (this PR — ships the substrate-level invariant).
- **Setup**: read `bin/minsky` content from disk; no spawn.
- **Action**: assert that the future-ready dispatch surfaces exist (CLI binary present, current self-diagnose has matching invariants for "stale task IDs" / "stuck PRs" which are the upstream sources of would-be submissions).
- **Assert**: substrate-level invariants — `bin/minsky` exists; `scripts/self-diagnose.mjs` has the source invariants; `gh` CLI is on PATH (downstream dependency).

## Failure modes

- Submitter's machine offline: `submit-finding` queues locally, retries on next supervisor cycle.
- Receiving repo's `TASKS.md` linter rejects the PR's task shape: the submitter gets a per-rule error message and is offered an interactive edit-and-retry path.
- Concurrent submissions colliding on the same task ID: the second submission's task ID is auto-suffixed with `-v2`.

## Out of scope

- Real-time fleet-wide aggregation across hundreds of machines (M4 fleet scale).
- Authentication / trust between submitter machines and the receiving daemon (M3 federation).

## Pivot

If the substrate-level probe stays green but the operator-actually-submits rate is <1/month per machine for >2 months, the surface isn't being adopted — pivot to push-not-pull: have the daemon's self-diagnose findings auto-open submission PRs.
