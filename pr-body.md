## What

Adds `daemonPrThrashInvariant` to `scripts/self-diagnose.mjs` and wires it
into `defaultInvariants()`. The invariant flags any open daemon-authored PR
that has accumulated **>5 commits** AND **>2h wall-clock age** AND is
**not `MERGEABLE`** — the "optimize-thrash" failure mode where a worker keeps
polishing a stuck PR in place instead of rebasing or closing it.

When it fires, the `suggestedFix` instructs the daemon's next pick of the
matching task ID to *rebase #N or close it; do NOT add more commits*. Because
the invariant is part of `runInvariants(defaultInvariants())`, the thrash
list is emitted in the daemon's startup self-diagnose span — visible, not
silent.

## Why needed

9h monitoring window 2026-05-07: worker-1 stacked 11+ brief-compression
commits onto PR #322 over ~5h without the PR ever merging — it stayed
`CONFLICTING` the whole time, stranding ~−4,195 bytes/iter of token savings
that never landed. `daemon-pr-stuck-dirty` only measures age-of-dirtiness and
`daemon-task-scope-explosion` only counts *merged* PRs, so neither catches a
single open PR being thrashed in place. This closes that detector gap.

## Optimization (one measurable, this iteration)

**Round-trip elimination.** A naive add would give `openDaemonPrsForThrash`
its own `gh pr list --repo … --state open` subprocess — a second round-trip
identical to `openDaemonPrsForDirty`'s except for the JSON projection.
Instead, both consumers now share a single memoised `fetchOpenDaemonPrsRaw()`
(`runInvariants` runs invariants sequentially, so the second consumer reuses
the first's resolved promise). Net `gh pr list` subprocess round-trips for the
open-daemon-PR snapshot stays **1, not 2** per self-diagnose run — one fewer
`gh` process spawn (~hundreds of ms + a GitHub API call) every startup span.

## Verification

- Paired unit tests (per the task's Verification field):
  `pr-fresh` / `pr-aged-fresh-commits` / `pr-aged-many-commits` / `pr-merged`,
  plus a custom-threshold pivot-lever case — all green.
- `defaultInvariants` integration test (runs the new invariant in the full
  set against real `gh`) — green.
- Measurement one-liner exits 0 (no thrashed PRs right now):
  `node scripts/self-diagnose.mjs --json | jq -e '[.[] | select(.id == "daemon-pr-thrash")] | length == 0'`

## Hypothesis self-grade

- **Predicted**: post-fix, no daemon PR has >5 commits AND >2h age without a green merge or a forced-rebase action; the new invariant detects the PR #322 thrash shape (11 commits / 5h / CONFLICTING) and stays silent on fresh / aged-few-commits / MERGEABLE PRs.
- **Observed**: `pr-aged-many-commits` fires on the #322-shaped fixture (11 commits / 5h / CONFLICTING) with `rebase #322 or close it` / `do NOT add more commits` guidance; `pr-fresh`, `pr-aged-fresh-commits`, `pr-merged` all pass; live measurement one-liner exits 0; round-trips for the open-PR snapshot stay 1.
- **Match**: yes
- **Lesson**: the thrash signal needs all three conditions ANDed — commit count alone false-positives on legitimate long-lived substrate work, which is why the pivot lever (10 commits / 4h) is injectable.

<!-- security: not-applicable — read-only gh pr list probe, no auth/secrets/PII/sandbox surface -->
