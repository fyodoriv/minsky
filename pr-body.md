# feat(tick-loop): machine-budget pure controller + rule-#10 deterministic gate (operator-machine-budget-autoscale slices 1–2/N)

## Why needed

Operator directive 2026-05-17 / vision.md **rule #15**: minsky must *match*
a single operator-defined machine-utilisation budget (default 70 %, ≤80 %
under the weekly-gated swarm switch) — neither idle the box nor gridlock
it. The live evidence in the task block: on a 10-core box the worker plist
shipped `ProcessType=Background` (macOS QoS throttles CPU/IO, making the
budget *physically unreachable*) **and** a hand-tuned
`--spawn-additional-workers` constant (4≈ok, 10 saturates, 20 gridlocks to
zero). A constant cannot track the saturation knee, and the QoS flag made
any budget moot.

This PR lands the first two slices of the cluster:

- **Slice 1 — pure controller** (`novel/tick-loop/src/machine-budget-autoscaler.ts`):
  `resolveMachineBudgetPct` (env → clamped budget; swarm ceiling 80) and
  `computeWorkerTarget` (effective-throughput controller with cold-start,
  ramp-up, knee step-back, knee-hold, and gridlock-backoff rules). No I/O;
  21 paired tests for every pre-registered behaviour (rule #9). Originated
  on a sibling daemon worktree (`b61d972`); carried forward rebased onto
  current `main` rather than re-derived, so slice 2 builds on it without
  duplicating the controller (rule #1 — compose, don't reinvent;
  duplicate-work-detection).
- **Slice 2 — rule-#10 gate** (`scripts/check-machine-budget.mjs`, wired
  into the `pre-pr-lint` `full` stage): asserts three otherwise prose-only
  invariants on every PR — (1) the budget contract is present and
  `defaultBudgetPct=70` / `swarmMaxBudgetPct=80` are pinned; (2) no minsky
  worker/tick-loop launchd template sets `ProcessType=Background` while the
  budget is non-trivial (the empirically-confirmed unreachable-budget
  regression — hard fail); (3) the controller test file keeps the three
  rule-#9 pre-registered behaviour suites. Dormant (exit 0 + advisory)
  until the controller artefact lands — same precedent as
  `check-mape-k-budget-cap`.

This is the smallest meaningful increment toward the task's Acceptance
line "`check-machine-budget.mjs` hard-fails on a `Background` QoS +
non-trivial budget". Remaining slices (bin wire-in replacing the fixed
spawn constant, OS-throttle auto-corrector, cross-repo dotfiles/agentbrew
propagation) compose on this substrate.

## Optimization (per-iteration discipline)

`optimization: none-this-iteration: this slice adds a new deterministic
gate + pure controller on no existing hot path; touching the pre-pr-lint
runner's execution model or the daemon spawn loop would be rule-#12 scope
sprawl. The gate's own dormant short-circuit (exit early when the
controller file is absent) is inherent to the rule-#7 graceful-degrade
pattern, not a new optimization.`

## Hypothesis self-grade

- **Predicted**: a deterministic rule-#10 gate over the machine-budget contract hard-fails when a minsky worker/tick-loop launchd template carries `ProcessType=Background` with a non-trivial (≥default-70) budget, and passes green on the current repo (no such throttle present), with the controller exports intact and the three pre-registered behaviour suites present.
- **Observed**: `node scripts/check-machine-budget.mjs` exits 0 on the repo ("budget contract pinned, no contradicting ProcessType=Background throttle, controller behaviour suites present"); the paired test "ProcessType=Background on a tick-loop plist → hard fail" asserts `ok:false` with a reason naming the file + `launchd.plist`/`unreachable`; 34/34 tests pass (21 controller + 13 gate); tsc + biome clean.
- **Match**: yes
- **Lesson**: the throttle-regression invariant is now a CI tripwire, so the next slice (bin wire-in of `computeWorkerTarget`) can change the spawn path without silently re-introducing the QoS clamp that made the budget unreachable.

## Security & privacy

No new auth/secrets/sandbox/PII surface; vision.md § 13 reviewed. The new
`check-machine-budget.mjs` is a read-only deterministic lint: it reads
repo-tracked files only (`novel/tick-loop/src/machine-budget-autoscaler*`,
`distribution/launchd/*.plist`), spawns no child process, makes no network
call, and runs no LLM. Threat: a crafted plist string evading the
`ProcessType` regex would let a throttled template pass — mitigation: the
regex is whitespace-anchored and case-insensitive, the contract checks are
fail-closed (a missing export *fails*, never silently passes), and the
gate scopes hard-fails to repo-tracked templates so an attacker would have
to land the evasive plist through normal review first.

## Test plan

- `node scripts/check-machine-budget.mjs` → exit 0 on this branch.
- `npx vitest run scripts/check-machine-budget.test.mjs novel/tick-loop/src/machine-budget-autoscaler.test.ts` → 34/34 green.
- Injected-regression: the test "ProcessType=Background on a tick-loop plist → hard fail naming launchd" proves the Acceptance criterion deterministically.
- `pnpm pre-pr-lint` (full stage) green, including the newly-wired `machine-budget` step.
