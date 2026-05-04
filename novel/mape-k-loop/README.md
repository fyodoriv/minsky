<!-- rule-1: existing autonomic-manager / MAPE-K runtimes (e.g., IBM Tivoli Autonomic Computing Toolkit, OpenStack Heat, Kubernetes operator-sdk) rejected because: their decision modules are coupled to a specific cluster substrate (JMX, OpenStack Heat templates, Kubernetes CRDs); Minsky's input shape is `TASKS.md` markdown + `EXPERIMENT.yaml` records + GH Actions JSON — none of which fit the existing runtimes' control planes. The MAPE-K reference architecture (Kephart-Chess 2003) is the pattern; the runtime is novel-by-design. -->

# `@minsky/mape-k-loop`

MAPE-K reference architecture (Kephart & Chess, "The Vision of Autonomic
Computing", *IEEE Computer* 2003) for Minsky's autonomic manager. v0 ships
all four MAPE phases (**Monitor**, **Analyze**, **Plan**, **Execute**) as
pure decision functions, the Knowledge phase as an append-only log writer
over `constraints.md` (Helland 2007 — immutable log), the two guards
(sustained-gain per Kohavi-Tang-Xu 2020, oscillation per Ries 2011), and a
`tick(...)` assembly that runs one full cycle. The integration test under
[`user-stories/003-mape-k-improves-prompts.test.ts`](../../user-stories/003-mape-k-improves-prompts.test.ts)
exercises the full loop end-to-end against a synthetic fixture.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index) row 54:

- **`monitor(...)`** — MAPE-K Monitor phase per Kephart-Chess 2003;
  pure decision function (Martin, *Clean Architecture*, 2017). Takes
  already-parsed inputs (CI runs, advisories, experiment records) and
  emits a `HealthSnapshot`. **Conformance: full** for the parsed-input
  contract; the I/O boundary (the CLI wrapper that runs `gh run list`,
  reads `spec-advisories/*.md`, tails `experiment-store/*.jsonl`) is
  the user-supplied wrapper around `tick(...)`.
- **`analyze(...)`** — MAPE-K Analyze phase + Theory of Constraints
  (Goldratt, *The Goal*, 1984): top constraint = the rule whose
  `violationCount × costEstimate(ruleId)` is highest, tie broken
  alphabetically. **Conformance: full.**
- **`costEstimate(...)`** — per-rule weight schedule. **Conformance: partial**
  — v0 default is the identity (every rule = 1); the configurable
  schedule sourced from `vision.md` arrives in a follow-up tracked as
  `mape-k-cost-schedule-from-vision`.
- **`HealthSnapshot` aggregate-counter shape** — USE method (Gregg,
  *Systems Performance*, 2014) applied to the constraint-detection
  substrate. **Conformance: partial** — counts only; the saturation +
  errors columns of USE are out of scope for v0.
- **`plan(...)`** — MAPE-K Plan phase per Kephart-Chess 2003;
  pure decision function that proposes ≤3 prompt {@link Variant}s
  per top constraint from a fixed v0 catalogue. **Conformance: full**
  for the variant-proposal contract; the catalogue is a v0 fixed
  triple (`enumerate-failure-modes`, `direct-answer`, `tighten-scope`).
- **`execute(...)`** — MAPE-K Execute phase per Kephart-Chess 2003;
  hands variants to a `PromptOptimizer` (sub-task 1's adapter), picks
  the winner, then applies the two guards before deciding `rollout`
  or `abstain`. **Conformance: full**.
- **`sustainedGain(...)`** — sustained-gain window guard per
  Kohavi-Tang-Xu 2020 Ch. 3; default window 7 d. **Conformance: full**.
- **`oscillation(...)`** — oscillation guard per Ries 2011 (build–
  measure–learn — don't re-pivot to a previously-rejected variant);
  default lookback 10 iterations. **Conformance: full**.
- **`knowledge(...)`** — MAPE-K Knowledge phase per Kephart-Chess 2003
  over an append-only log (Helland, "Life beyond Distributed
  Transactions", *CIDR* 2007). Emits a markdown block to append to
  `constraints.md` and (when calibration drift exceeds threshold) a
  proposed amendment to `research.md` § "DSPy fit" per Munafò et al.
  2017 pre-registration manifesto. **Conformance: full**.
- **`tick(...)`** — Assembly of M → A → P → E → K into one tick of the
  loop. Pure: every input is data, every output is data; the optional
  `emit` seam carries OTEL events when wired to `@minsky/observability`.
  **Conformance: full**.

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: for every well-formed `MonitorInput`,
  `monitor(input)` emits a `HealthSnapshot` whose `violations` aggregate
  is sorted by `ruleId` and whose `warnings` array is empty;
  `analyze({ snapshot })` emits the rule with the highest
  `violationCount × costEstimate` product, tie broken alphabetically;
  `tick(...)` runs to completion and writes a non-empty
  `constraintsAppend` regardless of whether a constraint was detected.
- **Blast radius**: a single function call. `monitor`, `analyze`, `plan`,
  `knowledge` are pure — no shared state across calls, no I/O. `execute`
  is pure relative to its `optimizer` argument; `tick` composes them.
- **Operator escape hatch**: corrupt input rows are dropped with a
  `warnings` entry instead of throwing — the caller decides whether to
  surface the warning, retry, or continue. Every tick writes a
  `constraintsAppend` entry (even no-ops) so the audit trail records the
  loop's full history per Helland 2007.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Upstream-malformed CI JSON (missing `conclusion` field; `gh run list` schema drift) | upstream-malformed | `graceful-degrade` — the row is dropped with a `monitor: skipping malformed ci-run …` warning; valid rows still aggregate | covered by `monitor.test.ts` "gracefully skips corrupt rows with a warning instead of crashing" assertion |
| 2 | Missing `experiment-store/` directory at I/O boundary | missing-input (resource) | `graceful-degrade` — Monitor consumes `experimentRecords: []`; the snapshot has `experiments: { validated: 0, regressed: 0, inconclusive: 0 }` and zero violations | covered by `novel/mape-k-loop/src/index.test.ts` "degrades gracefully when there is no constraint" assertion (the empty-inputs path passes through `tick(...)` without throwing) |
| 3 | Constraint-evidence ties (two rules with equal `violationCount × cost`) | edge case (analyze) | `graceful-degrade` — alphabetical tie-break by `ruleId` produces a deterministic `topConstraint` | covered by `analyze.test.ts` "breaks ties alphabetically by ruleId" assertion |
| 4 | Misconfigured cost weight (NaN / Infinity / 0 / negative) | upstream-malformed (cost-schedule) | `graceful-degrade` — `costEstimate` falls back to `DEFAULT_RULE_COST = 1` so a real constraint cannot be silently zeroed out | covered by `analyze.test.ts` "falls back to DEFAULT_RULE_COST for non-finite or non-positive weights" assertion |
| 5 | Empty snapshot fed to Analyze (no violations recorded yet) | edge case (cold start) | `graceful-degrade` — `topConstraint` / `evidence` / `severity` all `null`; downstream Plan must check before consuming | covered by `analyze.test.ts` "returns null constraint for an empty snapshot" assertion |
| 6 | Empty `topConstraint.ruleId` fed to Plan (caller skipped the null-check on `analyze`'s output) | upstream-malformed (caller contract) | `let-it-crash` — `plan` throws with a named error so the loop driver surfaces a programmer error instead of producing nonsense variants | covered by `novel/mape-k-loop/src/plan.test.ts` "throws when topConstraint.ruleId is empty (programming error — Plan needs a target)" assertion |
| 7 | Optimizer returns a `winnerId` not in the supplied variant list (e.g., a stale cached result) | upstream-malformed (adapter contract) | `graceful-degrade` — `execute` returns `decision: 'abstain'` with `reason: optimizer returned unknown winnerId="…"`; no rollout occurs | covered by `novel/mape-k-loop/src/execute.ts` `pickWinner` returning `null`; lenient prose assertion in `execute.test.ts` "abstains when sustained-gain fails" exercises the abstain path |
| 8 | Empty rollout history fed to sustained-gain (cold start; no prior iterations to count from) | edge case (cold start) | `graceful-degrade` — `sustainedGain` returns `{ ok: false, reason: 'no rollout history within last 7d' }`; Execute downgrades the decision to `abstain` (no division by zero, no crash) | covered by `novel/mape-k-loop/src/sustained-gain.test.ts` "returns false when there is no history within the window (cold start)" assertion |
| 9 | Optimizer rejects all variants by scoring every one to 0 (synthetic eval-set degeneracy) | upstream-malformed (adapter contract) | `graceful-degrade` — `execute` still resolves a winner via the deterministic tie-break in `pickWinner` (Variant order); the sustained-gain guard then refuses unless prior history exists, so the loop abstains rather than ships a zero-score rollout | covered by `novel/mape-k-loop/src/execute.test.ts` "abstains when sustained-gain fails (insufficient history)" assertion (zero-score path triggers the same abstain branch) |
| 10 | Empty variants list fed to Execute (Plan exhausted the catalogue) | edge case (variant-pool exhaustion) | `graceful-degrade` — `execute` returns `{ winner: null, decision: 'abstain', reason: 'execute: variants is empty …' }` so the loop driver logs a no-op and continues | covered by `novel/mape-k-loop/src/execute.test.ts` "returns null winner gracefully when variants is empty" assertion |
| 11 | Verdict log entries with non-finite `predicted` or `value` fed to Knowledge (upstream-malformed calibration data) | upstream-malformed | `graceful-degrade` — `knowledge` skips the bad rows; calibration MAE is computed only over the well-formed remainder; the per-tick `constraintsAppend` is still written | covered by `novel/mape-k-loop/src/knowledge.test.ts` "ignores entries with non-finite predicted or value (rule #7)" assertion |
| 12 | Calibration drift exceeds the configured threshold (predicted Δ vs observed Δ MAE >50 % default) | observable signal (rule-#9 quarterly layer) | `circuit-break-and-notify` — `knowledge` emits a `researchMdAmendmentProposal` text the operator pastes into a preparation PR; the live log keeps the audit trail | covered by `novel/mape-k-loop/src/knowledge.test.ts` "emits an amendment proposal text when calibration drift exceeds threshold" assertion + `user-stories/003-mape-k-improves-prompts.test.ts` "fires the calibration-drift amendment only when drift exceeds threshold" assertion |

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

### Sub-task 4 (Knowledge phase + assembly + integration test)

- **Hypothesis**: a pure `knowledge(...)` function that emits a markdown
  append for `constraints.md` (Helland 2007 immutable log) plus a
  conditional `research.md` amendment proposal when calibration drift
  exceeds 50 % MAE (Munafò et al. 2017 pre-registration manifesto)
  closes the MAPE-K loop with the rule-#9 quarterly automation layer.
  The `tick(...)` assembly runs M → A → P → E → K against a synthetic
  fixture in <60 s of compressed-simulation time, validating that the
  four phases compose correctly without an orchestration runtime.
- **Success threshold**: `pnpm typecheck && pnpm vitest run user-stories/003-mape-k-improves-prompts.test.ts novel/mape-k-loop/src/knowledge.test.ts novel/mape-k-loop/src/index.test.ts`
  exits 0; the parent `mape-k-loop-v0` tracker block is removed from
  `TASKS.md` in this same PR
  (`grep -c '^  - \*\*ID\*\*: mape-k-loop-v0$' TASKS.md` returns 0).
- **Pivot threshold**: if `constraints.md` grows past 200 entries
  before the first calibration-drift amendment fires, the drift
  threshold is too tight; raise it and document in `research.md` §
  "DSPy fit". If the integration test cannot reach a green run within
  60 s of compressed-simulation time on a GH-hosted runner, pivot to a
  self-hosted runner per `supervisor-integration-self-hosted-runner`'s
  precedent.
- **Measurement**: `pnpm typecheck && pnpm vitest run user-stories/003-mape-k-improves-prompts.test.ts novel/mape-k-loop/src/knowledge.test.ts novel/mape-k-loop/src/index.test.ts`.
- **Literature anchor**: Helland, "Life beyond Distributed Transactions",
  *CIDR* 2007 (immutable log as the Knowledge substrate); Kephart & Chess,
  "The Vision of Autonomic Computing", *IEEE Computer* 36(1) 2003
  (Knowledge phase of MAPE-K); Munafò et al., "A Manifesto for
  Reproducible Science", *Nature Human Behaviour* 1, 0021, 2017
  (rule-#9 calibration as a pre-registered audit).

## Usage

```ts
import { tick } from "@minsky/mape-k-loop";
import { StubPromptOptimizer } from "@minsky/prompt-optimizer";

// Inputs: CLI wrapper has already parsed `gh run list --json …`,
// `spec-advisories/*.md`, and `experiment-store/*.jsonl` into the shapes
// declared in `monitor.ts`.
const result = await tick({
  monitorInput: { ciRuns, advisories, experimentRecords },
  verdictLog,
  history,
  evalSet,
  optimizer: new StubPromptOptimizer(),
  metric: async (output) => (output.includes("good") ? 1.0 : 0.5),
  basePrompt: "you are a helpful assistant",
  now: new Date(),
});

if (result.rolloutDecision?.decision === "rollout") {
  console.log(`Rolled out ${result.rolloutDecision.winner?.id}`);
}

// Append the audit trail (CLI wrapper does the I/O):
await appendFile("novel/mape-k-loop/constraints.md", result.knowledgeWrites.constraintsAppend);

// Optional: open a preparation PR draft if the calibration drifted.
if (result.knowledgeWrites.researchMdAmendmentProposal !== null) {
  await draftPreparationPr(result.knowledgeWrites.researchMdAmendmentProposal);
}
```

The `costs` argument is the seam where a per-rule severity-weighted
schedule sourced from `vision.md` plugs in:

```ts
const result = await tick({
  // …
  costs: { "rule-9": 100, "rule-7": 50 }, // rule-9 misses are >1 OOM more expensive than typos
});
```

## Follow-up tasks

- **`mape-k-cost-schedule-from-vision`** — wire the per-rule cost weight
  schedule from `vision.md` into the `costs` argument of `analyze` so the
  Goldratt ranking reflects the human-supplied severity ordering.
- **`mape-k-constraints-md-size-cap`** — add a CI lint that fires when
  `novel/mape-k-loop/constraints.md` grows past 200 entries without an
  archive split.
