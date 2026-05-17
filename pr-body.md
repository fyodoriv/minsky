## What

`runany-dynamic-model-or-local-fallback` — the unified **pin > dynamic >
local** provider decision for the zero-arg run-anywhere entrypoint, plus
its pre-registered measurement harness. This branch is two stacked
slices:

**Slice 1 — pure decision table** (`80c575f`):

- `novel/tick-loop/src/runany-provider-decision.ts` — pure
  `decideRunAnyProvider` (no I/O, no clock, no env). Pollack decision
  table: (1) operator pin honored verbatim → (2) all remote backends
  down → `local` → (3) delegate to the shipped `pickStrategicModel` by
  remaining budget. Composes the two shipped deciders rather than
  reinventing them (rule #1). New surface vs. what it composes: a
  liveness signal across **all** configured remote backends (not just
  claude); switches fully to `local` in ≤1 iteration and never returns a
  wedged/`hold` state; recovery to remote is automatic (pure + recomputed
  each tick).
- `novel/tick-loop/src/runany-provider-decision.test.ts` — the 5-row
  chaos table + the 3-clause steady-state hypothesis (17 tests).

**Slice 2 — pre-registered measurement harness** (`17fdd5e`):

- `novel/tick-loop/src/index.ts` — export `decideRunAnyProvider` + its
  types from `@minsky/tick-loop` so the wiring layer and the harness
  consume the **same** decider, not a re-derived table.
- `scripts/runany-model-audit.mjs` — the exact `Measurement` command
  from the task block: `--scenario=<pin|dynamic|all-down> --json`. Pure
  scenario runner + injected decider seam + thin CLI (same shape as
  `cto-audit-metrics.mjs`). Exit 0 only when every requested scenario
  meets its pre-registered threshold.
- `scripts/runany-model-audit.test.mjs` — paired test: the real decider
  passes all 3 scenarios; **mutant deciders** (ignore-pin, never-local,
  wedged-kind, inverted-tier) each flip the verdict to `ok:false`
  (rule #10 — fails-closed).
- `docs/run-anywhere.md` — operator-facing decision table, recovery
  contract, measurement commands + threshold table.
- `package.json` — `runany:audit` script (operator-surface uniformity,
  mirrors `cto-audit:metrics`).

## Why needed

Today provider selection requires env wrangling and silently
mis-degrades on a bad budget estimate or a dead backend. Slice 1 makes
the pin > dynamic > local contract a single pure, testable decision.
Slice 2 closes the falsifiability gap: the task's `Measurement` line
names an exact command and Acceptance criterion 5 is "3-scenario
measurement passes" — but that command did not exist and slice 1's
decider was unexported, so the pre-registered hypothesis (rule #9 /
Munafò et al. 2017) could not be evaluated. A future regression in the
decider now breaks CI instead of silently mis-degrading the run-anywhere
model choice (Beyer SRE 2016 — visible, not silent).

## Measurement

```text
node scripts/runany-model-audit.mjs --scenario=pin --json
  → ok:true  pinnedRate:1  wedged:0  (8/8 iterations across budget×liveness)
node scripts/runany-model-audit.mjs --scenario=dynamic --json
  → ok:true  tiers:[1,1,2,3]  monotone:true  topIsTier1:true  bottomIsLocal:true
node scripts/runany-model-audit.mjs --scenario=all-down --json
  → ok:true  switchIters:0  localRate:1  wedged:0  (≤1 switch, ≥95% local)
node scripts/runany-model-audit.mjs --scenario=all  → exit 0
npx vitest run scripts/runany-model-audit.test.mjs \
  novel/tick-loop/src/runany-provider-decision.test.ts  → 40 passed
pnpm pre-pr-lint  → all 12 steps [ok], EXIT=0
```

## Hypothesis self-grade

- **Predicted**: with the harness wired to the shipped decider — pin scenario 100% pinned dispatch; dynamic scenario model tier monotone-correlates with remaining-budget bands; all-down scenario ≤1 iteration to switch to local then ≥95% local dispatch and 0 wedged iterations.
- **Observed**: pin pinnedRate=1.0 wedged=0 (8/8); dynamic tiers=[1,1,2,3] monotone=true topIsTier1=true bottomIsLocal=true; all-down switchIters=0 localRate=1.0 wedged=0; `--scenario=all` exits 0; mutant deciders each flip to ok:false; 40/40 tests pass; pre-pr-lint 12/12 green.
- **Match**: yes
- **Lesson**: the slice-1 decider already satisfies all three pre-registered thresholds; the next experiment moves to live-fire — wiring the decider + a real multi-backend liveness probe into the run-anywhere entrypoint, where the open question is probe cost per iteration (task Pivot: cache with TTL ≥60s).

## Optimization

`optimization: none-this-iteration` — slice-2 is a pure measurement
harness plus an index export; no hot path is touched (the audit script
runs offline, and the decider already avoids a double `pickStrategicModel`
call in the no-pin path). The eligible round-trip dedup — caching the
multi-backend liveness probe (TTL ≥60s) — is the dedicated next slice per
the task Pivot, not bundleable before the probe exists.

<!-- security: not-applicable — measurement script + type export only; no auth/secrets/sandbox/PII/network surface (the audit runs the pure decider offline; § 13 reviewed) -->
