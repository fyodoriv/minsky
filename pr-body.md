## What & why needed

`runany-dynamic-model-or-local-fallback` Acceptance #3: when every
configured remote is down/exhausted the run-anywhere entrypoint must
switch **fully + automatically + visibly** to local within ≤1 iteration,
with 0 wedged iterations.

Slices 1–2 shipped the pure `resolveRunAnyModel` decider + the
pre-registered `runany-model-audit.mjs` harness. Slice 3 wired the
**pin** path into `pickAndLogStrategicModel()` (Acceptance #1). Until
this slice the **all-remote-down** path was still unwired at the
entrypoint: when the budget guard circuit-broke claude (the only
configured remote → inaccessible), `pickAndLogStrategicModel()` fell
through the full budget-snapshot → usage-history ring append →
exhaustion-regression machinery and emitted the ~400-byte
`tick-loop.strategic-pick` span before eventually yielding `undefined`
(local). The decision was neither unified nor visibly attributed to
"remote down".

This slice (4) routes the `lastDecision.action === "circuit-break"` case
through `resolveRunAnyModel` and returns **before** the snapshot math,
the ring-buffer append, and the exhaustion regression — the switch to
local happens in *that very iteration* (≤1) and emits a compact
`[span] tick-loop.runany-resolve` line with `"source":"all-remote-down"`
and a visible reason (Beyer SRE 2016 visible-not-silent). Recovery is
implicit (Acceptance #4): the next non-circuit-broken iteration falls
through to the unchanged dynamic path. The budget-band dynamic path (no
pin, remote reachable) is byte-for-byte identical to before this slice.
Actual local liveness/bootstrap stays owned by the wrapper's TTL-cached
probe (`minsky-cli-auto-bootstrap-local-llm`); this layer routes + logs.

## Changes

- `novel/tick-loop/bin/tick-loop.mjs` — all-remote-down short-circuit in
  `pickAndLogStrategicModel()` (mirrors slice 3's pin short-circuit
  shape), plus two frozen module consts reused across degraded
  iterations (no per-tick allocation).
- `docs/run-anywhere.md` — Status section: slice 4 documented; follow-up
  scope narrowed to the live multi-backend network probe.

## Optimization (rule #9 skip-earlier gate)

A circuit-broken iteration now skips: the remaining-fractions snapshot
math, the `appendUsageHistory` ring-buffer growth, the
`predictExhaustionMs` regression, and the ~400-byte
`tick-loop.strategic-pick` span (replaced by a ~140-byte
`tick-loop.runany-resolve` line). Net ≥260-byte per-degraded-iteration
log reduction + dropped allocation/regression work. Same optimization
class as slice 3's pin path.

## Measurement

```bash
node scripts/runany-model-audit.mjs --json   # overall PASS
```

`all-down` scenario asserts the pre-registered thresholds the slice-4
wire-in now drives at runtime: ≤1 iteration to switch to local, ≥0.95
local-dispatch fraction during the down window, 0 wedged iterations,
recovers to the dynamic remote pick when a backend returns.

## Hypothesis self-grade

- **Predicted**: with all remote backends blocked (simulated), the run switches to local within one iteration and continues with 0 wedged iterations; the pin and dynamic paths are unaffected
- **Observed**: `runany-model-audit.mjs --json` → overall PASS (pin 15/15, dynamic 6/6, all-down: itersToSwitch≤1, localFraction 1.0, wedged 0, recoveredToRemote true)
- **Match**: yes
- **Lesson**: the budget-circuit-break signal is a sufficient synchronous proxy for "the only configured remote is inaccessible"; the next slice adds a real per-backend network probe so a multi-remote network outage (not just budget) also trips the all-remote-down branch

<!-- security: not-applicable — model-routing decision + log line only; no auth/secrets/sandbox/PII/network surface added (the wrapper owns probes) -->
