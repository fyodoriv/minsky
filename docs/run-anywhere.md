# Run-Anywhere Model Decision

<!-- scope: human-approved slice 1 of `runany-dynamic-model-or-local-fallback` (P0 task in TASKS.md). This file is the operator-facing contract for the unified "pin > dynamic > local" decision the run-anywhere entrypoint applies every iteration. -->

Operator-facing reference for how the zero-arg run picks its model and
when it falls fully to the local stack.

## TL;DR

```text
operator pinned a model?            → that model, verbatim, every iteration
else every remote backend down?     → local, this iteration (≤1 to switch)
else                                → strategic router picks by budget
                                      (opus → sonnet → local; see below)
remote backend reachable again?     → back to the budget-driven pick
```

The decision is a single pure function,
`resolveRunAnyModel` (`novel/tick-loop/src/runany-model-resolver.ts`).
It composes the shipped strategic picker
([Strategic Model Router](./strategic-model-router.md)) under a
multi-backend liveness gate.

## The three rules, in order

1. **Pin wins, absolutely.** Set `MINSKY_STRATEGIC_PIN_MODEL` (or pass
   the explicit flag) to a catalog model id and that model is used in
   100% of iterations — budget and backend liveness are never consulted.
   A pin that names no catalog row is ignored (typo guard), not honored.

2. **All remotes down → local, now.** Every configured remote backend
   (claude *and any others*) is probed each iteration. When **every**
   one is unreachable, the run switches fully to the local stack in the
   *same* iteration — regardless of how much budget remains. This is the
   gap the older `decideProvider` left open: a transient `ENETUNREACH`
   is deliberately *not* a quota signal there, so a fully-offline remote
   would otherwise wedge the daemon on claude forever. If the local
   probe is also down, the daemon still routes local and bootstraps the
   local stack (see `minsky-cli-auto-bootstrap-local-llm`) rather than
   halting. An **empty** backend list (local-only operator) is *not*
   "all down" — it falls through to rule 3.

3. **Otherwise, dynamic by budget.** Delegates to the strategic router:
   the highest-quality model whose per-window remaining-budget floors
   fit. The router returns the local tier itself when the budget is
   exhausted, so "budget exhausted → local" needs no separate branch.

**Recovery** is automatic and needs no sticky state: the function is
pure, so the next iteration with any remote backend reachable skips
rule 2 and returns the budget-driven pick again.

## Verifying the contract

The three acceptance scenarios are pre-registered (rule #9) and checked
deterministically:

```bash
node scripts/runany-model-audit.mjs --scenario=pin      --json
node scripts/runany-model-audit.mjs --scenario=dynamic  --json
node scripts/runany-model-audit.mjs --scenario=all-down  --json
node scripts/runany-model-audit.mjs                       # all three
```

Exit code is `0` when every scenario meets its threshold, `1` otherwise.
Thresholds (transcribed verbatim from the task's Success line):

| Scenario  | Threshold |
|-----------|-----------|
| `pin`      | 100% pinned-model dispatch across the budget × liveness grid |
| `dynamic`  | 100% of budget-banded iterations land on the band's tier (opus@high / sonnet@mid / local@low) |
| `all-down` | ≤1 iteration to switch to local, then ≥95% local dispatch, 0 wedged iterations, recovers to the remote pick when a backend returns |

## Status

Slices 1+2: the pure `resolveRunAnyModel` decider, its tests, and the
`runany-model-audit.mjs` measurement harness.

Slice 3: the **pin-path wire-in** into the run-anywhere
entrypoint. `pickAndLogStrategicModel()` in
`novel/tick-loop/bin/tick-loop.mjs` now consults `resolveRunAnyModel`
*first*: when `MINSKY_STRATEGIC_PIN_MODEL` names a catalog model, the
decision short-circuits **before** the budget-snapshot read, the
usage-history ring-buffer append, and the exhaustion prediction —
honoring the pin verbatim every iteration (Acceptance #1) and emitting a
compact `[span] tick-loop.runany-resolve` line instead of the ~400-byte
`tick-loop.strategic-pick` span (rule #9 skip-earlier gate: a pinned run
pays zero dynamic-machinery cost). A pin that names no catalog row stays
on the unchanged budget-aware dynamic path (typo guard) — that path is
byte-for-byte identical to before this slice, so the dynamic and
all-down behaviour is unaffected.

Slice 4 (this slice): the **all-remote-down wire-in** into the
run-anywhere entrypoint (Acceptance #3). When the budget guard has
circuit-broken claude — the only configured remote is inaccessible
(budget exhausted) — `pickAndLogStrategicModel()` now routes the
decision through `resolveRunAnyModel` and returns **before** the
remaining-fractions snapshot math, the usage-history ring-buffer
append, and the exhaustion regression (rule #9 skip-earlier gate: a
down-remote iteration pays zero dynamic-machinery cost, same
optimization class as slice 3's pin path). The switch to local happens
in *that very iteration* (≤1-iteration switch) and emits a compact
`[span] tick-loop.runany-resolve` line with `"source":"all-remote-down"`
and a visible reason (Beyer SRE 2016 visible-not-silent) instead of the
~400-byte `tick-loop.strategic-pick` span. Recovery is implicit: the
next iteration where the guard is no longer circuit-broken falls through
to the unchanged dynamic path (Acceptance #4). The actual local
liveness/bootstrap is owned by the wrapper's TTL-cached probe
(`minsky-cli-auto-bootstrap-local-llm`); this layer routes + logs only.
The budget-band dynamic path (no pin, remote reachable) is still
byte-for-byte identical to before this slice.

Follow-up slices (tracked under the same task): routing the *dynamic*
path through the resolver too, and the live multi-backend probe builder
that populates `remoteBackends` from a real per-backend network probe
(not just the budget-circuit-break proxy) so the all-remote-down branch
also fires on a network-level outage of a multi-remote fleet.
