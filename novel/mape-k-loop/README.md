<!-- rule-1: existing autonomic-manager / MAPE-K runtimes (e.g., IBM Tivoli Autonomic Computing Toolkit, OpenStack Heat, Kubernetes operator-sdk) rejected because: their decision modules are coupled to a specific cluster substrate (JMX, OpenStack Heat templates, Kubernetes CRDs); Minsky's input shape is `TASKS.md` markdown + `EXPERIMENT.yaml` records + GH Actions JSON — none of which fit the existing runtimes' control planes. The MAPE-K reference architecture (Kephart-Chess 2003) is the pattern; the runtime is novel-by-design. -->

# `@minsky/mape-k-loop`

MAPE-K reference architecture (Kephart & Chess, "The Vision of Autonomic
Computing", *IEEE Computer* 2003) for Minsky's autonomic manager. Sub-tasks
2 + 3 of 4 of the [`mape-k-loop-v0`](../../TASKS.md) decomposition — ships
the **Monitor**, **Analyze**, **Plan**, and **Execute** phases as pure
decision functions, plus the two guards (sustained-gain per Kohavi-Tang-Xu
2020, oscillation per Ries 2011); the Knowledge phase + integration
assembly (sub-task 4) follows.

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
- **`plan(...)`** — MAPE-K Plan phase per Kephart-Chess 2003;
  pure decision function that proposes ≤3 prompt {@link Variant}s
  per top constraint from a fixed v0 catalogue. **Conformance: full**
  for the variant-proposal contract; the catalogue is a v0 fixed
  triple (`enumerate-failure-modes`, `direct-answer`, `tighten-scope`)
  until sub-task 4 sources mutation templates from `vision.md`.
- **`execute(...)`** — MAPE-K Execute phase per Kephart-Chess 2003;
  hands variants to a `PromptOptimizer` (sub-task 1's adapter), picks
  the winner, then applies the two guards before deciding `rollout`
  or `abstain`. **Conformance: full**.
- **`sustainedGain(...)`** — sustained-gain window guard per
  Kohavi-Tang-Xu 2020 Ch. 3; default window 7 d. **Conformance: full**.
- **`oscillation(...)`** — oscillation guard per Ries 2011 (build–
  measure–learn — don't re-pivot to a previously-rejected variant);
  default lookback 10 iterations. **Conformance: full**.

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
| 6 | Empty `topConstraint.ruleId` fed to Plan (caller skipped the null-check on `analyze`'s output) | upstream-malformed (caller contract) | `let-it-crash` — `plan` throws with a named error so the loop driver surfaces a programmer error instead of producing nonsense variants | covered by `novel/mape-k-loop/src/plan.test.ts` "throws when topConstraint.ruleId is empty (programming error — Plan needs a target)" assertion |
| 7 | Optimizer returns a `winnerId` not in the supplied variant list (e.g., a stale cached result) | upstream-malformed (adapter contract) | `graceful-degrade` — `execute` returns `decision: 'abstain'` with `reason: optimizer returned unknown winnerId="…"`; no rollout occurs | covered by `novel/mape-k-loop/src/execute.ts` `pickWinner` returning `null`; lenient prose assertion in `execute.test.ts` "abstains when sustained-gain fails" exercises the abstain path |
| 8 | Empty rollout history fed to sustained-gain (cold start; no prior iterations to count from) | edge case (cold start) | `graceful-degrade` — `sustainedGain` returns `{ ok: false, reason: 'no rollout history within last 7d' }`; Execute downgrades the decision to `abstain` (no division by zero, no crash) | covered by `novel/mape-k-loop/src/sustained-gain.test.ts` "returns false when there is no history within the window (cold start)" assertion |
| 9 | Optimizer rejects all variants by scoring every one to 0 (synthetic eval-set degeneracy) | upstream-malformed (adapter contract) | `graceful-degrade` — `execute` still resolves a winner via the deterministic tie-break in `pickWinner` (Variant order); the sustained-gain guard then refuses unless prior history exists, so the loop abstains rather than ships a zero-score rollout | covered by `novel/mape-k-loop/src/execute.test.ts` "abstains when sustained-gain fails (insufficient history)" assertion (zero-score path triggers the same abstain branch) |
| 10 | Empty variants list fed to Execute (Plan exhausted the catalogue) | edge case (variant-pool exhaustion) | `graceful-degrade` — `execute` returns `{ winner: null, decision: 'abstain', reason: 'execute: variants is empty …' }` so the loop driver logs a no-op and continues | covered by `novel/mape-k-loop/src/execute.test.ts` "returns null winner gracefully when variants is empty" assertion |

## Hypothesis-driven development (rule #9)

### Sub-task 2 (Monitor + Analyze)

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

### Sub-task 3 (Plan + Execute + 2 guards)

- **Hypothesis**: pure Plan + Execute phase functions plus two
  independently-testable guards (sustained-gain per Kohavi-Tang-Xu 2020;
  oscillation per Ries 2011) drive prompt rollouts deterministically
  through the `@minsky/prompt-optimizer` adapter — without an
  orchestration runtime — and refuse rollout under either guard's
  failure mode.
- **Success threshold**: `pnpm typecheck && pnpm vitest run novel/mape-k-loop/src/plan.test.ts novel/mape-k-loop/src/execute.test.ts novel/mape-k-loop/src/oscillation.test.ts novel/mape-k-loop/src/sustained-gain.test.ts`
  exits 0 with ≥10 tests passing collectively; the parent `mape-k-loop-v0`
  tracker's `Blocked by` count drops by 1 (the `mape-k-plan-execute-phases`
  block is removed from `TASKS.md` in this same PR).
- **Pivot threshold**: if oscillation-guard refusal rate exceeds 50 %
  over 30 iterations on synthetic histories (the variant pool of 3 is
  too small for a 10-iteration lookback), raise the variant-pool cap
  or shorten the lookback window; declare the deviation in
  `research.md` § "DSPy fit".
- **Measurement**: `pnpm typecheck && pnpm vitest run novel/mape-k-loop/src/plan.test.ts novel/mape-k-loop/src/execute.test.ts novel/mape-k-loop/src/oscillation.test.ts novel/mape-k-loop/src/sustained-gain.test.ts`.
- **Literature anchor**: Kohavi, Tang, Xu, *Trustworthy Online Controlled
  Experiments*, Cambridge UP 2020, Ch. 3 (sustained-gain window);
  Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer*
  36(1) 2003 (Plan / Execute phases); Ries, *The Lean Startup*, 2011
  (build-measure-learn — the oscillation guard is the "don't re-pivot
  to a previously-rejected variant" guardrail).

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

- **`mape-k-knowledge-and-integration`** (sub-task 4) — Knowledge phase,
  CLI wrapper (the I/O boundary), and the user-story-003 integration test.
