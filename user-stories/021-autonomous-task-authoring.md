# Story 021 — The daemon authors tasks between ticks, not just inside them

**Milestone(s)**: M2

> **Why this story exists.** Rule #17 (proactive heal) makes agents author tasks WHILE they run an iteration — scout discipline files P1–P3 tasks for bugs, gaps, and stale docs as a side effect of doing the work. But when the queue empties, the daemon used to idle, waiting for the operator to hand-author the next batch. That is the missing half of the operator's "comes up with tasks" vision pillar: the factory should also author tasks BETWEEN iterations. This story closes the loop. When the picker returns null (the host queue is empty), the daemon runs an audit pass that produces the next batch of tasks and seeds the following ticks, so a healthy host never sits idle waiting for a human.

## Story

As the operator I want the daemon to keep itself fed: when it runs out of claimable tasks, it should run an audit pass (sweep / project-audit) that authors new actionable tasks — instead of going idle until I notice and write more. I want this to be measurable, so "the factory comes up with its own work" is a number I can confirm or refute, not a claim.

The mechanism is a pure decision at the per-tick seam:

1. **Pick attempt** — each tick the daemon calls the picker (`scripts/pick_task.py`, the Python successor to the deleted `task-finder.ts` `pickHostTask`). It prints a task id on stdout, or an empty line when the queue is empty.
2. **Decision** — the daemon maps an empty pick to `pickedTaskId: null` and asks `shouldTriggerAuditPass(ctx)` (`novel/tick-loop/src/audit-pass-trigger.ts`). On a `null` pick the audit pass triggers on the first empty tick (idle→audit latency is one tick) and re-triggers every Nth empty tick thereafter (`DEFAULT_EMPTY_QUEUE_CADENCE`).
3. **Scope (rule #12-aware)** — `chooseAuditScope` narrows the audit to `stability-only` when recent ticks show stability-debt verdicts (`spawn-failed`, `scope-leak`, `watchdog-kill`, …), so the audit never proposes feature work that rule #12 (ship stability when the queue empties) would reject. Otherwise the audit is `broad`.
4. **Record** — the daemon appends one `AuditPassTickEvent` per tick to `.minsky/experiment-store/audit-pass/*.jsonl`. The coverage script reads those events and computes the pre-registered Measurement.

The decision is pure and language-agnostic: it depends only on the observable pick result, not the picker's internals — which matters because the picker is now Python, not the TypeScript module the original task block named.

## Acceptance criteria

1. `shouldTriggerAuditPass({ pickedTaskId: null, consecutiveEmptyTicks: 1 })` triggers an audit pass; with a non-null `pickedTaskId` it never triggers.
2. At the default cadence (1), every consecutive empty-queue tick triggers an audit pass; with a larger cadence the audit re-triggers on tick 1 then every Nth empty tick.
3. `chooseAuditScope` returns `"stability-only"` whenever any recent verdict is in `STABILITY_DEBT_VERDICTS`, and `"broad"` otherwise (or when no verdicts are supplied).
4. A non-finite / non-positive cadence never crashes the decision — `normalizeCadence` clamps it to the default (rule #6, stay alive).
5. `node scripts/audit-pass-empty-queue-coverage.mjs --json` emits `{ empty_queue_ticks, audit_pass_invocations, new_tasks_produced, idle_to_next_task_p50_minutes, success }`; `success` is true iff `empty_queue_ticks == audit_pass_invocations` (> 0) AND the idle p50 is under 5 minutes (or there is not yet an idle measurement).
6. A corrupt / blank JSONL line is dropped, never thrown — one bad append must not poison the coverage read.
7. `--window=Nticks` keeps only the most-recent N events; `--strict` exits 1 when the Success thresholds are not met.

## Metric

- **Name**: `audit_pass_empty_queue_coverage`
- **Definition**: over a window of tick events, the fraction of empty-queue ticks that invoked an audit pass (`audit_pass_invocations / empty_queue_ticks`), plus the idle→next-task p50 in minutes. The pre-registered Success threshold (task `autonomous-task-authoring-between-ticks`): `empty_queue_ticks == audit_pass_invocations` (every empty tick authors work) AND `idle_to_next_task_p50_minutes < 5` (the daemon never idles long on a non-trivially-empty repo).
- **Threshold**: Ship gate (this story): the coverage script produces a well-typed Measurement object whose `success` correctly reflects the two thresholds, and the decision is deterministic over a `TickContext`. Pillar gate (the task Hypothesis): on 5 consecutive `pickHostTask → null` events, ≥4 of 5 audit passes produce ≥1 actionable task and the idle p50 drops from ∞ (operator-waits) to < 5 min.
- **Source**: `.minsky/experiment-store/audit-pass/*.jsonl` tick events written by the daemon; computed by `scripts/audit-pass-empty-queue-coverage.mjs`.

## Integration test

The pure decision (`shouldTriggerAuditPass`, `chooseAuditScope`, `normalizeCadence`, `buildAuditPassTickEvent`) is unit-tested in `novel/tick-loop/src/audit-pass-trigger.test.ts`. The coverage aggregator (`parseTickEvents`, `selectWindow`, `percentile`, `computeCoverage`, `parseWindow`, `parseArgs`, `formatCoverageSummary`) is unit-tested in `scripts/audit-pass-empty-queue-coverage.test.mjs`. Both run under the repo's vitest suite (the full `pnpm pre-pr-lint --stage=full` gate).

## Proof

```bash
node scripts/audit-pass-empty-queue-coverage.mjs --window=10ticks --json
# → {"empty_queue_ticks": N, "audit_pass_invocations": N,
#    "new_tasks_produced": M, "idle_to_next_task_p50_minutes": X, "success": true}
```

## Failure modes

| Failure mode | Expected behavior | Chaos test |
|---|---|---|
| Picker prints empty (queue exhausted) | `graceful-degrade` — `shouldTriggerAuditPass` triggers an audit pass instead of idling | `novel/tick-loop/src/audit-pass-trigger.test.ts` ("triggers on the first empty tick") |
| Recent ticks show stability debt while the queue is empty | `graceful-degrade` — `chooseAuditScope` narrows to `stability-only` so the audit obeys rule #12 (no feature proposals) | `novel/tick-loop/src/audit-pass-trigger.test.ts` ("narrows to stability-only") |
| A misconfigured (non-finite / non-positive) cadence reaches the decision | `graceful-degrade` — `normalizeCadence` clamps to the default; the daemon never crashes on a bad knob | `novel/tick-loop/src/audit-pass-trigger.test.ts` ("clamps non-positive / non-finite to the default") |
| A corrupt / partially-written JSONL tick line in the store | `graceful-degrade` — `parseTickEvents` drops the bad line, never throws; coverage is computed from the good lines | `scripts/audit-pass-empty-queue-coverage.test.mjs` ("drops blank and unparseable lines") |
| Degenerate idle sample (no idle measurements yet) | `graceful-degrade` — `percentile` returns `null`, never `NaN`/`Infinity`; `success` is not failed for insufficient data | `scripts/audit-pass-empty-queue-coverage.test.mjs` ("idle p50 is null is vacuously under-threshold") |

**Blast radius**: a decision misfire affects only a single tick's audit-pass choice on one host; an audit pass produces TASKS.md entries (never code mutations, never pushes), which the next picker vets through the normal rule-9 / touches gates. A coverage misread affects only the operator's terminal / a CI report — no host repo is mutated. **Operator escape hatch**: a larger `cadence` spaces re-audits out (or, in the daemon config, set the cadence high to effectively disable between-tick audits); the coverage script's `--strict` flag is opt-in, so a BELOW verdict never blocks a push unless the operator wires it into a gate.
