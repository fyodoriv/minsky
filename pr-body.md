## Why needed

`runany-dynamic-model-or-local-fallback` (P0, operator 2026-05-16) needs a
single decision for the zero-arg run: pin wins verbatim; else model tracks
remaining budget; else — when **every** configured remote backend is
down/inaccessible — switch fully to local and keep running. The two shipped
pure deciders don't cover the last part: `pickStrategicModel` switches to
local only on *budget* exhaustion, and `decideProvider`'s chaos-table row 1
**deliberately keeps the daemon on claude** when the network is down (a
transient `ENETUNREACH` is not a quota signal). So a fully-offline remote
wedges the run on claude forever — the exact failure this task targets.

Slices 1+2 (already on this branch) shipped the pure unified
`resolveRunAnyModel` decider (`pin > all-remote-down > dynamic`) and its
3-scenario measurement harness. **This iteration ships slice 3: the
pin-path wire-in** — `resolveRunAnyModel` is now the run-anywhere
entrypoint's decision function for the pinned case, not just a tested-but-
unused module. Acceptance #1 ("pin overrides everything") is now enforced
at runtime, not only in the audit harness.

## What changed (slice 3 — this iteration)

- `novel/tick-loop/bin/tick-loop.mjs` — `pickAndLogStrategicModel()` now
  consults `resolveRunAnyModel` **first**: when `MINSKY_STRATEGIC_PIN_MODEL`
  names a catalog model, the decision short-circuits *before* the
  budget-snapshot read, the usage-history ring-buffer append, and the
  exhaustion prediction, returning the pin verbatim and emitting a compact
  `[span] tick-loop.runany-resolve` line. A pin that names no catalog row
  stays on the **unchanged** budget-aware dynamic path (typo guard, chaos
  row 3) — that path is byte-for-byte identical to before, so dynamic /
  all-down behaviour is unaffected (surgical: only the pinned branch moves).
- Frozen module-level placeholders (`PIN_PATH_UNUSED_*`) satisfy the
  resolver's input type without a per-iteration allocation — the pin path
  (step 1) short-circuits before it reads `remaining` / `remoteBackends` /
  `localProbeResult`.
- `docs/run-anywhere.md` — Status section updated: slice 3 documented;
  remaining follow-ups (dynamic-path routing + live multi-backend probe)
  re-scoped.

Slices 1+2 (already committed on this branch — `resolveRunAnyModel`,
its 15 tests, the audit harness + 14 tests, the `index.ts` export, and
two isolated pre-existing gate-unblock commits) are unchanged.

## Measurement

Pre-registered (rule #9), transcribed verbatim into
`scripts/runany-model-audit.mjs` threshold constants. The entrypoint now
calls the **exact** decider the `pin` scenario validates, so the harness is
the pre-registered measurement for the wire-in:

```text
node scripts/runany-model-audit.mjs --json
# pin:      pinnedFraction == 1.0   ← the path slice 3 wires into the entrypoint
# dynamic:  bandedCorrect  == 1.0   (opus@high / sonnet@mid / local@low)
# all-down: itersToSwitch <= 1, localFraction >= 0.95, wedged == 0, recovered
```

Observed this iteration:

```text
[PASS] pin: {"total":15,"pinned":15,"pinnedFraction":1}
[PASS] dynamic: {"total":6,"correct":6,"bandedCorrect":1}
[PASS] all-down: {"downIters":20,"itersToSwitch":0,"localFraction":1,"wedged":0,"recoveredToRemote":true}
overall: PASS
```

The bin closure `pickAndLogStrategicModel` is not unit-addressable (it is a
closure in the entrypoint script); the decider it now calls is covered by
`runany-model-resolver.test.ts` (15) + `runany-model-audit.test.mjs` (14),
matching the existing strategic-router wire-in's verification pattern.

## optimization

Skip-earlier gate (rule #9): for a pinned operator, slice 3 eliminates —
*every iteration* — the `realGuard.lastDecision()` snapshot read, the
`appendUsageHistory` ring-buffer growth, the `predictExhaustionMs` linear
regression, and the ~400-byte `tick-loop.strategic-pick` span, replacing
the whole sequence with one ~90-byte `tick-loop.runany-resolve` line. Net
≈300+ bytes of log per pinned tick removed plus the eliminated compute —
well over the 10-byte minimum, on the hot per-iteration decision path.

## Hypothesis self-grade

- **Predicted**: wiring `resolveRunAnyModel` into the entrypoint's pin path
  makes Acceptance #1 hold at runtime (pinned model dispatched 100% of
  iterations, the dynamic machinery skipped) while the dynamic / all-down
  paths stay behaviourally identical; the `pin` audit scenario stays 1.0
- **Observed**: audit `overall: PASS` — pin 15/15 (pinnedFraction 1.0),
  dynamic 6/6, all-down ≤1 iter / 1.0 local / 0 wedge / recovered; dynamic
  path code unchanged (only the pinned branch added)
- **Match**: yes
- **Lesson**: the resolver is now load-bearing for the pinned case; next
  slice routes the dynamic path through it too and adds the live
  multi-backend probe builder so the all-remote-down branch fires at runtime

<!-- security: not-applicable — slice 3 is a pure-decider wire-in into an existing entrypoint closure; no auth/secrets/sandbox/PII/supply-chain surface (the pin value is an existing operator-set env var, already read here pre-slice). -->
