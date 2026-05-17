## What

Slice 2 of `runany-dynamic-model-or-local-fallback`: the pre-registered
**measurement harness** for the unified pin > dynamic > local decider,
plus the `@minsky/tick-loop` export that makes slice 1's pure function
reachable by package consumers.

- `novel/tick-loop/src/index.ts` — export `decideRunAnyProvider` +
  `RunAnyProviderInput` / `RunAnyProviderDecision` / `RemoteBackendLiveness`
  so the run-anywhere wiring layer and the measurement harness consume
  the **same** shipped slice-1 decider rather than re-deriving the
  decision table (rule #1 — compose, don't reinvent).
- `scripts/runany-model-audit.mjs` — the exact `Measurement` command
  from the task block: `node scripts/runany-model-audit.mjs
  --scenario=<pin|dynamic|all-down> --json`. Pure scenario runner +
  injected decider seam + thin CLI (same shape as
  `cto-audit-metrics.mjs`). Exit 0 only when every requested scenario
  meets its pre-registered threshold.
- `scripts/runany-model-audit.test.mjs` — paired test: real shipped
  decider passes all 3 scenarios; **mutant deciders** (ignore-pin,
  never-local, wedged-kind, inverted-tier) each flip the verdict to
  `ok:false` (rule #10 — fails-closed; a regression is an exit-1 break,
  not a green run).
- `docs/run-anywhere.md` — operator-facing reference: decision table,
  recovery contract, measurement commands + threshold table.
- `package.json` — `runany:audit` script for operator-surface uniformity
  (mirrors `cto-audit:metrics`, `chaos:budget-exhaust`).

## Why needed

The task's Acceptance criterion 5 is "3-scenario measurement passes" and
the `Measurement` line names an exact command — but that command did not
exist, so the pre-registered hypothesis was unfalsifiable (rule #9 /
Munafò et al. 2017: the prediction must be evaluable by a runnable
command committed before the result is observed). Slice 1 shipped the
pure decider but left it unexported, so nothing outside the test file
could reach it. This slice closes both gaps: the decider is now a public
`@minsky/tick-loop` export, and the audit harness turns the task's
Success thresholds into a deterministic exit-1 gate. A future regression
in the decider now breaks CI instead of silently mis-degrading the
run-anywhere model choice (Beyer SRE 2016 — visible, not silent).

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
```

## Hypothesis self-grade

- **Predicted**: with the harness wired to the shipped decider — pin scenario 100% pinned dispatch; dynamic scenario model tier monotone-correlates with remaining-budget bands; all-down scenario ≤1 iteration to switch to local then ≥95% local dispatch and 0 wedged iterations.
- **Observed**: pin pinnedRate=1.0 wedged=0 (8/8); dynamic tiers=[1,1,2,3] monotone=true topIsTier1=true bottomIsLocal=true; all-down switchIters=0 localRate=1.0 wedged=0; `--scenario=all` exits 0; mutant deciders each flip to ok:false; 40/40 tests pass.
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
