---
name: pr-merge-no-shortcuts
description: Primes an agent against the close-with-preservation anti-pattern when running PR backlog drains. When the operator says "merge", "drain the queue", "ship the backlog", "merge all open PRs", or any equivalent, the agent MUST either land each PR's commit on `main` OR close it with mechanical empty-diff proof. Closing PRs as "preserved via GitHub retention" or "tracked via umbrella task" is FORBIDDEN by vision.md rule #18 and is the failure mode this skill is designed to interrupt. Use whenever the upcoming work involves closing more than one open PR.
allowed-tools: Bash, Read, Grep
---

# PR merge — no shortcuts (rule #18 enforcement primer)

## The one-line rule

A "merge" directive has succeeded only when the PR's commit is on `main`, OR you have written an empty-diff proof comment on the closed PR. Anything else is the rule-#18 anti-pattern.

## Why this skill exists

The 2026-05-21 backlog drain produced the same regression **twice in the same day**:

1. **Morning pass**: 32 PRs closed with "the diff is preserved via GitHub closed-PR retention" rationale → operator caught it ("Why tf did you close prs if they contain anything useful?") → all 32 reopened, only 3 verified subsumed.
2. **Evening pass** (PR #695): 16 PRs closed again, this time with "umbrella task tracks the recovery patches" rationale → same anti-pattern, different wrapper.

Both passes happened because the agent ran out of session budget mid-drain and rationalised a fast close-rate as progress. The PRs stay off `main`, off anyone's radar, and the work effectively disappears.

This skill is the primer that interrupts that pattern **before** the rationalisation crystallises.

## When you are about to drain a queue

Before closing **any** PR that you did not personally rebase-merge in the same session, run the verifier:

```bash
node scripts/verify-pr-closure-is-lossless.mjs <PR-NUMBER>
```

The script:
1. Fetches the PR's branch
2. Runs `git rebase --strategy-option=ours origin/main` against the PR's branch
3. Checks `git diff origin/main..HEAD` is empty
4. If empty → writes a one-line proof comment on the PR with the rebase SHA → green light to close
5. If non-empty → exits non-zero with the surviving diff path → **do not close** (the work is not on main)

## Decision table

| Situation                                            | Allowed action                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| PR is MERGEABLE and gate-green                       | `gh pr merge <N> --squash --admin --delete-branch`                            |
| PR is CONFLICTING                                    | Rebase first (`git rebase -X theirs origin/main`); if still conflicting, fix the conflict; merge. Closing without rebase is forbidden. |
| PR is "superseded" by another PR or main commit      | Run the lossless verifier. ONLY close if it writes the empty-diff proof.       |
| PR is stale / WIP / experimental and operator says "close" | OK to close, but only after the operator explicitly says so per-PR (not via blanket directive).  |
| Out of session budget, queue still has open PRs       | **STOP**. File a TASKS.md entry naming each remaining PR by number. Do not close them as "preserved".  |

## Forbidden phrasings (each is a rule-#18 violation)

Any PR closure comment, commit message, or session log containing one of these is the anti-pattern:

- "preserved via GitHub closed-PR retention"
- "recoverable via `gh pr diff`"
- "tracked by umbrella task"
- "CONFLICTING — closing for cleanup"
- "superseded by parallel implementation" (without lossless-verifier proof)
- "patch file in `.minsky/preserved-diffs/`" (the directory is gitignored — the patch evaporates on clone)

## Pivot check (run at every hour boundary while draining)

```bash
gh pr list --state=open --json number,closedAt --jq 'length' # currently open
gh pr list --state=closed --search "closed:>=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) -is:merged" --json number --jq 'length' # closed in last hour, NOT merged
gh pr list --state=merged --search "merged:>=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" --json number --jq 'length' # merged in last hour
```

If `closed-not-merged > merged` for two consecutive hours, STOP. The session is doing the wrong thing. Escalate to the operator with the queue snapshot.

## Anchor

- `vision.md` § 18 — the iron rule itself
- `scripts/verify-pr-closure-is-lossless.mjs` — the mechanical proof
- `scripts/local-gate-merge.mjs` — the real merge path (never closes)
- 2026-05-21 morning + evening drain regressions — the empirical justification
