<!-- rule-1: existing autonomic-manager / MAPE-K runtimes (e.g., IBM Tivoli Autonomic Computing Toolkit, OpenStack Heat, Kubernetes operator-sdk) rejected because: their decision modules are coupled to a specific cluster substrate (JMX, OpenStack Heat templates, Kubernetes CRDs); Minsky's input shape is `TASKS.md` markdown + `EXPERIMENT.yaml` records + GH Actions JSON — none of which fit the existing runtimes' control planes. The MAPE-K reference architecture (Kephart-Chess 2003) is the pattern; the runtime is novel-by-design. -->

# `@minsky/mape-k-loop`

MAPE-K reference architecture (Kephart & Chess, "The Vision of Autonomic
Computing", *IEEE Computer* 2003) for Minsky's autonomic manager. Sub-task
2 of 4 of the [`mape-k-loop-v0`](../../TASKS.md) decomposition — ships the
**Monitor** + **Analyze** phases as pure decision functions; the Plan +
Execute phases (sub-task 3) and Knowledge phase + integration (sub-task 4)
follow.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 54:

- **`monitor(...)`** — MAPE-K Monitor phase per Kephart-Chess 2003;
  pure decision function (Martin, *Clean Architecture*, 2017). Takes
  already-parsed inputs (CI runs, advisories, experiment records) and
  emits a `HealthSnapshot`. **Conformance: full** for the parsed-input
  contract; the I/O boundary (the CLI wrapper that runs `gh run list`,
  reads `spec-advisories/*.md`, tails `experiment-store/*.jsonl`) ships
  in sub-task 4.
- **`analyze(...)`** — MAPE-K Analyze phase + Theory of Constraints
  (Goldratt, *The Goal*, 1984): top constraint = the rule whose
  `violationCount × costEstimate(ruleId)` is highest, tie broken
  alphabetically. **Conformance: full.**
- **`costEstimate(...)`** — per-rule weight schedule. **Conformance: partial**
  — v0 default is the identity (every rule = 1); the configurable
  schedule sourced from `vision.md` arrives in sub-task 3 (Plan).
- **`HealthSnapshot` aggregate-counter shape** — USE method (Gregg,
  *Systems Performance*, 2014) applied to the constraint-detection
  substrate. **Conformance: partial** — counts only; the saturation +
  errors columns of USE are out of scope for v0.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: for every well-formed `MonitorInput`,
  `monitor(input)` emits a `HealthSnapshot` whose `violations` aggregate
  is sorted by `ruleId` and whose `warnings` array is empty;
  `analyze({ snapshot })` emits the rule with the highest
  `violationCount × costEstimate` product, tie broken alphabetically.
- **Blast radius**: a single function call. Both `monitor` and `analyze`
  are pure — no shared state across calls, no I/O.
- **Operator escape hatch**: corrupt input rows are dropped with a
  `warnings` entry instead of throwing — the caller decides whether to
  surface the warning, retry, or continue.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Upstream-malformed CI JSON (missing `conclusion` field; `gh run list` schema drift) | upstream-malformed | `graceful-degrade` — the row is dropped with a `monitor: skipping malformed ci-run …` warning; valid rows still aggregate | covered by `monitor.test.ts` "gracefully skips corrupt rows with a warning instead of crashing" assertion |
| 2 | Missing `experiment-store/` directory at I/O boundary | missing-input (resource) | `graceful-degrade` — Monitor consumes `experimentRecords: []`; the snapshot has `experiments: { validated: 0, regressed: 0, inconclusive: 0 }` and zero violations | (deferred — covered when `mape-k-knowledge-and-integration` ships the I/O wrapper test) |
| 3 | Constraint-evidence ties (two rules with equal `violationCount × cost`) | edge case (analyze) | `graceful-degrade` — alphabetical tie-break by `ruleId` produces a deterministic `topConstraint` | covered by `analyze.test.ts` "breaks ties alphabetically by ruleId" assertion |
| 4 | Misconfigured cost weight (NaN / Infinity / 0 / negative) | upstream-malformed (cost-schedule) | `graceful-degrade` — `costEstimate` falls back to `DEFAULT_RULE_COST = 1` so a real constraint cannot be silently zeroed out | covered by `analyze.test.ts` "falls back to DEFAULT_RULE_COST for non-finite or non-positive weights" assertion |
| 5 | Empty snapshot fed to Analyze (no violations recorded yet) | edge case (cold start) | `graceful-degrade` — `topConstraint` / `evidence` / `severity` all `null`; downstream Plan must check before consuming | covered by `analyze.test.ts` "returns null constraint for an empty snapshot" assertion |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: pure Monitor + Analyze phase functions over already-parsed
  inputs (CI runs, advisories, experiment records) provide a deterministic
  substrate the rest of the MAPE-K loop (sub-tasks 3-4) can plan against,
  with Goldratt's Theory of Constraints (highest `violationCount × cost`)
  as the constraint-ranking primitive.
- **Success threshold**: `pnpm typecheck` exits 0 and
  `pnpm vitest run novel/mape-k-loop/src/monitor.test.ts novel/mape-k-loop/src/analyze.test.ts`
  exits 0 with ≥6 tests passing; the parent `mape-k-loop-v0` tracker's
  `Blocked by` count drops by 1 (the `mape-k-monitor-analyze-phases`
  block is removed from `TASKS.md` in this same PR).
- **Pivot threshold**: if Goldratt's frequency × cost framing
  over-collapses distinct violations (e.g., a high-frequency typo lint
  dominates the constraint over rare but expensive rule-#9 misses) on
  the first non-test snapshot fed in sub-task 3, pivot to per-rule
  severity-weighted cost (the `costs` argument to `analyze` is already
  the seam for this pivot — no API change required) and document the
  weight schedule in `vision.md`.
- **Measurement**: `pnpm typecheck && pnpm vitest run novel/mape-k-loop/src/monitor.test.ts novel/mape-k-loop/src/analyze.test.ts`.
- **Literature anchor**: Kephart & Chess, "The Vision of Autonomic
  Computing", *IEEE Computer* 36(1) 2003 (the MAPE-K reference architecture);
  Goldratt, *The Goal*, 1984 (Theory of Constraints — the constraint is
  whatever currently bottlenecks throughput); Martin, *Clean Architecture*,
  2017 (pure decision module + thin I/O boundary).

## Usage

```ts
import { monitor, analyze } from "@minsky/mape-k-loop";

// Inputs: CLI wrapper has already parsed `gh run list --json …`,
// `spec-advisories/*.md`, and `experiment-store/*.jsonl` into the shapes
// declared in `monitor.ts`.
const snapshot = monitor({ ciRuns, advisories, experimentRecords });
const analysis = analyze({ snapshot });

if (analysis.topConstraint !== null) {
  console.log(
    `Top constraint: ${analysis.topConstraint.ruleId} ` +
      `(severity=${analysis.severity}, ` +
      `violations=${analysis.evidence?.violationCount}, ` +
      `cost=${analysis.evidence?.costEstimate})`,
  );
}
```

The `costs` argument is the seam where sub-task 3 (Plan) plugs in a
per-rule severity-weighted schedule sourced from `vision.md`:

```ts
const analysis = analyze({
  snapshot,
  costs: { "rule-9": 100, "rule-7": 50 }, // rule-9 misses are >1 OOM more expensive than typos
});
```

## Follow-up tasks

- **`mape-k-plan-execute-phases`** (sub-task 3) — Plan + Execute phases
  with sustained-gain (Kohavi-Tang-Xu 2020) + oscillation guards.
- **`mape-k-knowledge-and-integration`** (sub-task 4) — Knowledge phase,
  CLI wrapper (the I/O boundary), and the user-story-003 integration test.
