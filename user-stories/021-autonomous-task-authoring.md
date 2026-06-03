# Story 021 — Minsky authors its own next tasks when the to-do list empties

**Milestone(s)**: M2

> When a project's to-do list runs dry, Minsky writes the next batch of work itself instead of sitting idle until you notice.

## What this is

Minsky is a background program that does coding work for you while you are away. It reads a project's plain-text to-do list (`TASKS.md`, the Markdown file at the project root), picks the most important unfinished item, asks a coding assistant to do it, and prepares a draft for you to review.

This story covers what happens when that to-do list is empty. Before this story, the daemon — the background program that keeps running after you start it — would idle once it ran out of claimable tasks, waiting for you to hand-write more. This story makes the daemon run an audit pass instead: a sweep that reads the project and writes new, actionable tasks. A healthy project never sits idle waiting for a human.

## What this is not

- Not a way for the daemon to write code unattended. An audit pass produces `TASKS.md` entries only — never code changes, never pushes.
- Not a replacement for scout discipline. Rule #17 (proactive healing) already makes the agent — the coding assistant Minsky drives — file tasks for bugs and gaps *while* it works a task. This story adds the missing half: authoring tasks *between* tasks, when the queue is empty.
- Not unbounded. Every task an audit pass writes is vetted by the normal picker gates (rule #9, the scope checks) before any agent acts on it.

## Story

As the operator — the human who runs Minsky — I want the daemon to keep itself fed. When it runs out of claimable tasks, it should run an audit pass that authors new actionable tasks, instead of going idle until I notice and write more. I want this to be measurable, so "the factory comes up with its own work" is a number I can confirm or refute, not a claim.

The mechanism is a single decision made at the seam between two scheduler iterations — each wake-up of the loop on its timer, the control-loop period (Liu, *Real-Time Systems*, 2000), called a tick for short. On every tick:

1. **Pick attempt** — the daemon calls the picker (`scripts/pick_task.py`, the Python successor to the deleted `task-finder.ts` `pickHostTask`). The picker prints a task id on stdout, or an empty line when the queue is empty.
2. **Decision** — the daemon maps an empty pick to `pickedTaskId: null` and asks `shouldTriggerAuditPass(ctx)` (`novel/tick-loop/src/audit-pass-trigger.ts`). On a `null` pick the audit pass triggers on the first empty tick, so the delay from idle to audit is one tick. It re-triggers every Nth empty tick after that (`DEFAULT_EMPTY_QUEUE_CADENCE`).
3. **Scope** — `chooseAuditScope` narrows the audit to `stability-only` when recent ticks carry stability-debt verdicts (`spawn-failed`, where the agent process could not start or produced no output; `scope-leak`, where the agent changed files outside the ones the task declared; `watchdog-kill`; and similar). This keeps the audit from proposing feature work that rule #12 (scope discipline — ship stability when the queue empties) would reject. Otherwise the audit is `broad`.
4. **Record** — the daemon appends one `AuditPassTickEvent` per tick to `.minsky/experiment-store/audit-pass/*.jsonl`. The coverage script reads those events and computes the pre-registered Measurement.

The decision is pure and language-agnostic. It depends only on the observable pick result, not on the picker's internals. That matters because the picker is now Python, not the TypeScript module the original task block named.

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

- **Files**: the pure decision (`shouldTriggerAuditPass`, `chooseAuditScope`, `normalizeCadence`, `buildAuditPassTickEvent`) is unit-tested in `novel/tick-loop/src/audit-pass-trigger.test.ts`. The coverage aggregator (`parseTickEvents`, `selectWindow`, `percentile`, `computeCoverage`, `parseWindow`, `parseArgs`, `formatCoverageSummary`) is unit-tested in `scripts/audit-pass-empty-queue-coverage.test.mjs`.
- **Run**: both run under the repo's vitest suite (the full `pnpm pre-pr-lint --stage=full` gate).

## Proof

```bash
node scripts/audit-pass-empty-queue-coverage.mjs --window=10ticks --json
# → {"empty_queue_ticks": N, "audit_pass_invocations": N,
#    "new_tasks_produced": M, "idle_to_next_task_p50_minutes": X, "success": true}
```

## Failure modes & chaos verification

**Steady-state hypothesis**: on an empty queue, every empty tick triggers exactly one audit pass, the audit scope obeys rule #12, and the coverage read survives bad data.

**Blast radius**: a decision misfire affects only a single tick's audit-pass choice on one host (one code project Minsky works on). An audit pass produces `TASKS.md` entries — never code changes, never pushes — which the next picker vets through the normal rule-9 and scope gates. A coverage misread affects only the operator's terminal or a CI report; no host repo is mutated.

**Operator escape hatch**: a larger `cadence` spaces re-audits out, and setting the cadence high in the daemon config effectively disables between-tick audits. The coverage script's `--strict` flag is opt-in, so a BELOW verdict never blocks a push unless you wire it into a gate.

| Failure mode | Expected behavior | Chaos test |
|---|---|---|
| Picker prints empty (queue exhausted) | `graceful-degrade` — `shouldTriggerAuditPass` triggers an audit pass instead of idling | `novel/tick-loop/src/audit-pass-trigger.test.ts` ("triggers on the first empty tick") |
| Recent ticks show stability debt while the queue is empty | `graceful-degrade` — `chooseAuditScope` narrows to `stability-only` so the audit obeys rule #12 (no feature proposals) | `novel/tick-loop/src/audit-pass-trigger.test.ts` ("narrows to stability-only") |
| A misconfigured (non-finite / non-positive) cadence reaches the decision | `graceful-degrade` — `normalizeCadence` clamps to the default; the daemon never crashes on a bad knob | `novel/tick-loop/src/audit-pass-trigger.test.ts` ("clamps non-positive / non-finite to the default") |
| A corrupt / partially-written JSONL tick line in the store | `graceful-degrade` — `parseTickEvents` drops the bad line, never throws; coverage is computed from the good lines | `scripts/audit-pass-empty-queue-coverage.test.mjs` ("drops blank and unparseable lines") |
| Degenerate idle sample (no idle measurements yet) | `graceful-degrade` — `percentile` returns `null`, never `NaN`/`Infinity`; `success` is not failed for insufficient data | `scripts/audit-pass-empty-queue-coverage.test.mjs` ("idle p50 is null is vacuously under-threshold") |

## Status

Why this story exists: rule #17 (proactive healing) already makes the agent author tasks *while* it runs a task — scout discipline files P1–P3 tasks for bugs, gaps, and stale docs as a side effect of doing the work. But when the queue emptied, the daemon used to idle, waiting for the operator to hand-author the next batch. That is the missing half of the operator's "comes up with tasks" vision pillar: the factory should also author tasks *between* iterations. This story closes the loop — when the picker returns null, the daemon runs an audit pass that produces the next batch of tasks and seeds the following ticks.

## Security & privacy

This section ties the story to rule #13 ("Security & privacy — second priority after performance"). Use industry-standard primitives only; rule #1 (don't reinvent) applies.

- **Trust boundary**: the untrusted inputs are the host repo's `TASKS.md` content and the audit pass's `claude --print` stdout (LLM output, treated as untrusted by default). Trusted: the local filesystem and the daemon's own environment. Anything that crosses the boundary (an authored task line, an OTEL span — OpenTelemetry, the open standard Minsky emits for traces, metrics, and logs) passes through the secret-leak scanner and the no-PII span lint before it lands.
- **Secrets**: no API keys, tokens, or `.env` content in authored `TASKS.md` entries, OTEL spans, or `.minsky/experiment-store/audit-pass/*.jsonl` tick events. Floor: the `scan-secrets` pre-commit gate.
- **PII**: no email, IP, or full-paths-with-username in OTEL span attributes or tick-event records. Floor: the OTEL no-PII span lint.
- **Sandbox**: an audit pass writes only to the host repo's `TASKS.md` and the local experiment store. It never mutates code, never pushes, and never reaches the network beyond the agent it drives.
- **Performance carve-out**: when a security restriction would cost more than 10% on this story's load-bearing latency metric (idle→next-task p50), the trade-off is documented here as a declared deviation with a numeric cost figure. Silent trade-offs are forbidden (rule #13's "performance-first carve-out" clause).
